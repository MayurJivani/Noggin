import { useCallback, useEffect, useRef, useState } from "react"
import { useRoom } from "../../lib/useRoom"
import { playForEffect, unlock, isUnlocked, music } from "../../lib/sfx"
import { broadcast } from "../../lib/knock/knock"
import { nameOf, rows as sideRows } from "../../lib/sides"
import { useWakeLock } from "../../lib/useWakeLock"
import { Backdrop } from "../ui/Backdrop"
import { Brand, BrandMark } from "../ui/Brand"
import { JoinCard } from "../ui/JoinCard"
import { VeinLine } from "../ui/Vein"
import { BoardGrid } from "./BoardGrid"
import { FinalStage, SurveyBoard } from "./FinalStage"
import { ClueCard } from "./ClueCard"
import { ScoreBar } from "./ScoreBar"
import { BuzzerBanner, BuzzOverlay, NitroSplash, LifelineOverlay, TimerRing } from "./Overlays"

/**
 * How often the screen asks for a new payload. Shorter than the nonce's life,
 * so there is always an overlap rather than a gap. The relay is the authority
 * on both numbers; this is the fallback for the first request, before the
 * relay's `rotateMs` has arrived.
 */
const KNOCK_ROTATE_MS = 6_000

/**
 * The big screen. Read-only by design: it holds no game state of its own and
 * takes no input, so it can be reloaded at any point in the night and land
 * exactly where the room is.
 */
export function DisplayStage({ code: initialCode }) {
  const [code] = useState(() => initialCode || new URLSearchParams(location.search).get("code")?.toUpperCase() || "")
  const [error, setError] = useState(null)
  const [audioOn, setAudioOn] = useState(false)

  // Transient reactions. State says "who holds the buzzer"; this says "someone
  // *just* buzzed", which is what an animation actually needs.
  const [flash, setFlash] = useState(null)
  const [splash, setSplash] = useState(false)
  const flashTimer = useRef(0)

  /** Tile rects, so a clue can fly out of the tile it came from. */
  const cells = useRef(new Map())
  const cellRef = useCallback((ci, qi, el) => {
    if (el) cells.current.set(`${ci}:${qi}`, el)
    else cells.current.delete(`${ci}:${qi}`)
  }, [])
  const [origin, setOrigin] = useState(null)

  const txRef = useRef(null)
  /** Whether a tone is actually going out, as opposed to merely intended. */
  const [broadcasting, setBroadcasting] = useState(false)

  const onMessage = useCallback(async (msg) => {
    if (msg?.type !== "knock:nonce") return
    // A null payload means the room is holding its cap of live nonces. Keep
    // playing the one already going rather than falling silent — it is still
    // valid for a few more seconds, and the next rotation will succeed.
    if (!Array.isArray(msg.payload)) return
    try {
      const tx = await broadcast(new Uint8Array(msg.payload), { volume: 0.15 })
      // Swap only once the new one is running. Stopping first leaves a gap on
      // every rotation, and a phone that starts listening in that gap waits
      // another six seconds for something to hear.
      txRef.current?.stop()
      txRef.current = tx
      setBroadcasting(true)
    } catch (err) {
      console.warn("[knock] broadcast failed:", err)
      setBroadcasting(false)
    }
  }, [])

  const onEffects = useCallback((effects, next) => {
    for (const fx of effects) {
      playForEffect(fx)

      if (fx.kind === "clue-open" || fx.kind === "nitro") {
        const el = cells.current.get(`${fx.catIndex}:${fx.clueIndex}`)
        setOrigin(el ? el.getBoundingClientRect() : null)
      }
      if (fx.kind === "nitro") {
        setSplash(true)
        setTimeout(() => setSplash(false), 2000)
      }
      if (fx.kind === "buzz-in" || fx.kind === "correct" || fx.kind === "wrong") {
        // On team night the id may be a team's — a nitro is ruled on the side,
        // not on whoever picked the tile — so resolve either kind.
        const name = nameOf(next, fx.playerId ?? fx.unitId)
        if (!name) continue
        clearTimeout(flashTimer.current)
        const verdict = fx.kind === "buzz-in" ? null : fx.kind
        setFlash({ name, verdict })
        flashTimer.current = setTimeout(() => setFlash(null), verdict ? 1400 : 1100)
      }
      if (fx.kind === "clue-close" || fx.kind === "round-start") setOrigin(null)
    }
  }, [])

  const { state, connected, send } = useRoom({ role: "display", code, onEffects, onError: setError, onMessage })

  // Broadcast room + nonce over sound while in lobby phase (requires user gesture)
  useEffect(() => {
    const isLobby = state?.phase === "lobby"
    if (!connected || !audioOn || !isLobby) {
      if (txRef.current) {
        txRef.current.stop()
        txRef.current = null
      }
      setBroadcasting(false)
      return
    }

    // `send` is send(type, payload) — passing an object as the type produced a
    // message shaped { type: { type: "knock:issue" } }, which matched nothing
    // and was silently dropped. Nothing errored; the screen simply never made
    // a sound.
    send("knock:issue")
    const interval = setInterval(() => send("knock:issue"), KNOCK_ROTATE_MS)

    return () => {
      clearInterval(interval)
      if (txRef.current) {
        txRef.current.stop()
        txRef.current = null
      }
      setBroadcasting(false)
    }
  }, [connected, audioOn, state?.phase, send])

  // A projector that sleeps mid-round is the worst failure mode there is.
  useWakeLock()

  // Nothing on this page is clickable, so the audio gesture has to be caught
  // wherever it lands — one tap anywhere arms the cues for the night.
  useEffect(() => {
    const arm = () => {
      unlock()
      setAudioOn(isUnlocked())
    }
    window.addEventListener("pointerdown", arm)
    window.addEventListener("keydown", arm)
    return () => {
      window.removeEventListener("pointerdown", arm)
      window.removeEventListener("keydown", arm)
    }
  }, [])

  return (
    <Stage
      code={code}
      state={state}
      connected={connected}
      error={error}
      audioOn={audioOn}
      broadcasting={broadcasting}
      flash={flash}
      splash={splash}
      origin={origin}
      cellRef={cellRef}
    />
  )
}

/**
 * Split out so the music effect below can hang off `state` without the early
 * returns above making it a conditional hook.
 */
function Stage({ code, state, connected, error, audioOn, broadcasting, flash, splash, origin, cellRef }) {
  /*
    The bed follows the room rather than this screen.

    Music is state on the relay, not a local toggle, so a projector that gets
    unplugged and reconnected mid-round comes back with the same thing playing —
    and the host can start and stop it from a desk on the other side of the room.
  */
  const wantsMusic = !!state?.music && !state?.paused
  useEffect(() => {
    if (wantsMusic) music.start()
    else music.stop()
  }, [wantsMusic])

  // Under a clue the bed drops out of the way rather than stopping, so the room
  // can hear itself think without the loop restarting on every tile.
  const busy = state?.phase === "clue" || state?.phase === "wager" || state?.phase === "final"
  useEffect(() => {
    music.duck(busy)
  }, [busy])

  useEffect(() => () => music.stop(), [])

  if (!code) return <CodePrompt />
  if (error) return <Fullscreen>{error.message}</Fullscreen>
  if (!state) return <Fullscreen>{connected ? "Joining…" : "Looking for the room…"}</Fullscreen>

  const { phase, board, clue, players, buzzer, timer, lifeline } = state
  const rows = sideRows(state)
  const wagerName = nameOf(state, state.wager?.teamId ?? state.wager?.playerId)

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <Backdrop veins={9} glow={4} />

      <header className="relative z-10 flex shrink-0 items-center gap-[2vmin] px-[2.5vmin] pt-[2vmin] pb-[1vmin]">
        <BrandMark className="text-[max(14px, calc(var(--stage) * 2))]" />
        <VeinLine className="hidden min-w-0 flex-1 sm:block" height={14} />
        <div className="font-display uppercase tracking-[0.2em] text-gold/80" style={{ fontSize: "max(10px, calc(var(--stage) * 1.4))" }}>
          {board.round?.name}
        </div>
        <VeinLine className="hidden min-w-0 flex-1 sm:block" height={14} />
        <div className="text-right">
          <div className="label leading-none">Room</div>
          <div className="font-display brass-sm leading-none tracking-[0.2em]" style={{ fontSize: "max(14px, calc(var(--stage) * 2))" }}>
            {/* Dots rather than nothing: the header keeps its shape, and the
                room can see the code is being withheld on purpose rather than
                wonder whether the screen has lost the connection. */}
            {state.codeHidden ? "••••" : state.code}
          </div>
        </div>
        {!connected && <span className="ml-2 h-2 w-2 rounded-full bg-bad animate-glow" title="reconnecting" />}
      </header>
      <div className="bulbs relative z-10 mx-[2.5vmin] shrink-0" />

      <main className="relative z-10 min-h-0 flex-1">
        {/*
          A bar of light across the stage whenever the round changes.

          Keyed on the round's name, so it remounts and replays exactly once per
          round and never on a re-render. It passes over the board rather than
          replacing it, which matters — the grid is what half the room is
          reading, and a full-screen transition would take it away from them to
          announce something they can already see in the header.
        */}
        <span
          key={board.round?.name ?? "no-round"}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[28%] bg-gradient-to-r from-transparent via-gold/25 to-transparent opacity-0 animate-streak"
        />

        {phase === "lobby" && (
          <Lobby
            code={state.code}
            codeHidden={state.codeHidden}
            broadcasting={broadcasting}
            players={players}
            teams={state.teams}
            title={board.title}
            check={state.check}
          />
        )}
        {phase === "final" && <FinalStage state={state} now={() => Date.now()} />}
        {phase === "intermission" && <Interlude title="Round cleared" rows={rows} sub={board.round?.name} />}
        {phase === "ended" && (
          <Interlude
            title="Final scores"
            rows={rows}
            final
            champion={state.champion}
            tied={state.tied}
            survey={state.played?.survey ? state.survey : null}
          />
        )}
        {phase === "tiebreak" && <Tiebreak state={state} rows={rows} />}
        {phase === "survey" && <SurveyBoard state={state} rows={rows} />}

        {(phase === "board" || phase === "clue" || phase === "wager" || phase === "reveal") && (
          <div className="relative h-full w-full">
            <BoardGrid round={board.round} cellRef={cellRef} />
            {/*
              A nitro holds the room while the host works out who found it and
              what they are risking, and the clue is deliberately not sent yet —
              so the card that normally covers the board had nothing in it. The
              splash plays for two seconds and then the room watched a blank
              panel over a grid. This is what belongs there instead.
            */}
            {clue && phase === "wager" && <NitroWait clue={clue} name={wagerName} stake={state.stake} />}
            {clue && phase !== "board" && phase !== "wager" && (
              <ClueCard
                clue={clue}
                revealed={state.revealed}
                stake={state.stake}
                origin={origin}
                wagerName={wagerName}
                timer={timer}
                now={() => Date.now()}
              />
            )}
          </div>
        )}

        <NitroSplash show={splash} />
        <LifelineOverlay lifeline={lifeline} playerName={nameOf(state, lifeline?.playerId)} now={() => Date.now()} />
        <BuzzOverlay name={flash?.name} verdict={flash?.verdict} />
        {!clue && <TimerRing timer={timer} now={() => Date.now()} />}
        <BuzzerBanner armed={buzzer.armed} />
        {state.paused && <PausedCard />}
      </main>

      {phase !== "lobby" && <ScoreBar rows={rows} buzzer={buzzer} lifeline={lifeline} />}

      {!audioOn && (
        <div className="pointer-events-none absolute bottom-[1vmin] left-1/2 z-40 -translate-x-1/2 rounded-full border border-edge bg-void/80 px-4 py-1.5 text-[11px] text-muted">
          click anywhere for sound
        </div>
      )}
    </div>
  )
}

/**
 * The room, held.
 *
 * Covers the board rather than sitting beside it, on purpose: the point of a
 * pause is that nobody should be reading the clue or eyeing the grid while the
 * host is away from the desk.
 */
function PausedCard() {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[2vmin] bg-void/85 backdrop-blur-sm animate-rise">
      <div className="flex items-center gap-[2.5vmin]">
        <span className="rounded-[0.6vmin] bg-gold" style={{ width: "2.6vmin", height: "9vmin" }} />
        <span className="rounded-[0.6vmin] bg-gold" style={{ width: "2.6vmin", height: "9vmin" }} />
      </div>
      <div className="font-display uppercase tracking-[0.35em] text-gold brass" style={{ fontSize: "max(24px, calc(var(--stage) * 5))" }}>
        Paused
      </div>
      <VeinLine className="w-[34vmin]" height={16} />
      <div className="text-muted" style={{ fontSize: "max(11px, calc(var(--stage) * 1.6))" }}>
        Back in a moment. Buzzers are off.
      </div>
    </div>
  )
}

/**
 * What the lobby says instead of the code, in streamer mode.
 *
 * The QR goes too, and that is the part worth being explicit about: a QR on a
 * stream is *easier* to use than one in the room, because a viewer can pause
 * the video and take as long as they like over it. Hiding four characters while
 * leaving a scannable square beside them would be a costume rather than a
 * change.
 *
 * So this has to leave the room a way in, and it names the two that survive a
 * camera: the sound, if it is actually playing, and the host's own mouth.
 */
function HiddenJoin({ broadcasting }) {
  return (
    <div className="rounded-[1.4vmin] border-[0.3vmin] border-gold-dim/60 bg-royal/25 px-[4vmin] py-[2.4vmin] text-center">
      <div className="label" style={{ letterSpacing: "0.3em" }}>
        Room code
      </div>
      <div className="font-display brass leading-none tracking-[0.3em]" style={{ fontSize: "max(28px, calc(var(--stage) * 5))" }}>
        ••••
      </div>
      <div className="mt-[1.2vmin] max-w-[46ch] text-muted" style={{ fontSize: "max(11px, calc(var(--stage) * 1.5))" }}>
        {broadcasting ? (
          <>
            Hidden for the stream. Open the player page and tap <b className="text-ink">Join by sound</b> — this screen is
            playing the code as a tone.
          </>
        ) : (
          <>Hidden for the stream. Ask the host for the code.</>
        )}
      </div>
    </div>
  )
}

function Lobby({ code, codeHidden, broadcasting, players, teams, title, check }) {
  const heard = check ? players.filter((p) => check.hits?.[p.id]).length : 0
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin] px-[4vmin]">
      <Brand size={Math.min(120, Math.max(48, window.innerWidth / 12))} />
      <VeinLine className="w-[46vmin]" height={18} />
      <div className="text-center font-display text-gold/85" style={{ fontSize: "max(16px, calc(var(--stage) * 2.6))" }}>
        {title}
      </div>

      {/* The host is asking the room to do something, so the room should be
          told what — and be able to see it landing. */}
      {check && (
        <div
          className={`rounded-[1.2vmin] border-[0.3vmin] px-[3vmin] py-[1.4vmin] text-center ${
            check.complete ? "border-good bg-good/10" : "border-live bg-live/10 animate-glow"
          }`}
        >
          <div className="font-display uppercase tracking-[0.2em] text-ink" style={{ fontSize: "max(14px, calc(var(--stage) * 2.4))" }}>
            {check.complete ? "All buzzers working" : "Press your buzzer"}
          </div>
          <div className="font-value tabular-nums text-gold" style={{ fontSize: "max(18px, calc(var(--stage) * 3.2))" }}>
            {heard} / {players.length}
          </div>

          {/*
            Who got there first, on the screen everyone is already looking at.

            A sound check is a room activity — everybody presses at once and
            then looks up — and the answer to "who was quickest?" was only ever
            on the host's laptop. The order is the relay's, computed with the
            same rule that will judge the real race, so the rehearsal predicts
            the game rather than merely proving the buttons work.
          */}
          {check.order?.length > 0 && (
            <div className="mt-[1.2vmin] flex flex-wrap justify-center gap-[1vmin]">
              {check.order.map((r) => {
                const who = players.find((p) => p.id === r.id)
                if (!who) return null
                return (
                  <span
                    key={r.id}
                    className={`rounded-full border px-[1.6vmin] py-[0.5vmin] font-display animate-tile-in ${
                      r.place === 1 ? "border-gold bg-gold/15 text-gold" : "border-edge text-muted"
                    }`}
                    style={{ fontSize: "max(10px, calc(var(--stage) * 1.5))", animationDelay: `${(r.place - 1) * 90}ms` }}
                  >
                    {r.place}. {who.name}
                    <span className="ml-[0.8vmin] tabular-nums text-faint">{r.place === 1 ? "first" : `+${r.behind}ms`}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {codeHidden ? (
        <HiddenJoin broadcasting={broadcasting} />
      ) : (
        <JoinCard code={code} size={Math.round(Math.min(260, Math.max(150, window.innerWidth / 7)))} />
      )}

      {/* On team night the lobby is where people find out who they are with, so
          the sides are the thing on screen rather than one long list of names. */}
      {teams ? (
        <div className="flex max-w-[86vw] flex-wrap justify-center gap-[2vmin]">
          {teams.map((t, i) => (
            <div
              key={t.id}
              className="min-w-[22vmin] rounded-[1.2vmin] border-[0.35vmin] bg-royal/30 px-[2.4vmin] py-[1.4vmin] text-center animate-tile-in"
              style={{ borderColor: t.color, animationDelay: `${i * 90}ms` }}
            >
              <div className="font-display uppercase tracking-[0.12em]" style={{ fontSize: "max(13px, calc(var(--stage) * 2))", color: t.color }}>
                {t.name}
              </div>
              <div className="mt-[0.8vmin] flex flex-wrap justify-center gap-[0.8vmin]">
                {t.memberNames.map((n) => (
                  <span
                    key={n}
                    className="rounded-full border border-gold-deep/40 px-[1.4vmin] py-[0.3vmin] font-display text-ink"
                    style={{ fontSize: "max(10px, calc(var(--stage) * 1.4))" }}
                  >
                    {n}
                  </span>
                ))}
                {t.memberNames.length === 0 && (
                  <span className="text-faint" style={{ fontSize: "max(10px, calc(var(--stage) * 1.3))" }}>
                    nobody yet
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex max-w-[80vw] flex-wrap justify-center gap-[1.2vmin]">
          {players.map((p, i) => (
            <div
              key={p.id}
              className="rounded-full border border-gold-deep/40 bg-royal/40 px-[2.4vmin] py-[0.9vmin] font-display text-ink animate-tile-in"
              style={{ fontSize: "max(12px, calc(var(--stage) * 1.7))", animationDelay: `${i * 60}ms` }}
            >
              {p.name}
            </div>
          ))}
          {players.length === 0 && <div className="text-[13px] text-faint">nobody yet — scan to join</div>}
        </div>
      )}
    </div>
  )
}

/**
 * Sudden death, on the big screen.
 *
 * The room needs to know two things at a glance: that this is happening, and
 * who it is between. Everyone else is out of it and should be able to see that
 * they are — a player still poised over their buzzer during someone else's
 * play-off is the confusion worth spending a whole screen to avoid.
 */
function Tiebreak({ state, rows }) {
  const tb = state.tiebreak
  const name = (id) => rows.find((r) => r.id === id)?.name ?? "?"

  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin] px-[6vmin] text-center">
      <div className="font-display uppercase tracking-[0.3em] text-live animate-glow" style={{ fontSize: "max(18px, calc(var(--stage) * 3))" }}>
        Tie-break{tb.round > 1 ? ` · ${tb.round}` : ""}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-[2vmin]">
        {tb.contenders.map((id) => {
          const out = tb.spent.includes(id)
          return (
            <div
              key={id}
              className={`rounded-[1.2vmin] border-[0.35vmin] px-[3vmin] py-[1.2vmin] font-display uppercase transition-all ${
                out ? "border-edge text-faint opacity-50 line-through" : "border-gold bg-royal/40 text-gold"
              }`}
              style={{ fontSize: "max(14px, calc(var(--stage) * 2.6))" }}
            >
              {name(id)}
            </div>
          )
        })}
      </div>

      <VeinLine className="w-[40vmin]" height={16} />

      {state.clue?.prompt ? (
        <p className="max-w-[42ch] font-display leading-[1.16] text-ink" style={{ fontSize: "max(20px, calc(var(--stage) * 4))" }}>
          {state.clue.prompt}
        </p>
      ) : (
        <p className="text-muted" style={{ fontSize: "max(13px, calc(var(--stage) * 2))" }}>
          First correct answer takes it.
        </p>
      )}

      {state.revealed && state.clue?.answer && (
        <p className="font-display text-gold brass animate-slam" style={{ fontSize: "max(20px, calc(var(--stage) * 3.6))" }}>
          {state.clue.answer}
        </p>
      )}
    </div>
  )
}

/**
 * The board while a nitro bet is being placed.
 *
 * The clue is withheld on purpose — it must not be readable until the bet is
 * locked, or the bet is not blind — so this cannot show the one thing a card
 * normally shows. What it can show is everything the room is entitled to know
 * and is actually waiting on: that a nitro was found, in which category, and
 * who is deciding. That last line is the useful one, because until the host
 * picks a side there is nobody to look at.
 */
function NitroWait({ clue, name, stake }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-[2.5vmin] bg-void/92 px-[6vmin] text-center animate-slam">
      <div className="font-display uppercase tracking-[0.2em] text-live animate-glow" style={{ fontSize: "max(26px, calc(var(--stage) * 5.5))" }}>
        Noggin&rsquo; Nitro
      </div>
      <VeinLine className="w-[44vmin]" height={18} />

      <div className="label" style={{ letterSpacing: "0.4em" }}>
        {clue.category}
      </div>

      {name ? (
        <div className="font-display text-ink" style={{ fontSize: "max(18px, calc(var(--stage) * 3.2))" }}>
          <span className="text-gold brass-sm">{name}</span> is deciding what to risk
        </div>
      ) : (
        <div className="font-display text-muted" style={{ fontSize: "max(16px, calc(var(--stage) * 2.6))" }}>
          Who found it?
        </div>
      )}

      {/* The tile's face value, which is what the bet is measured against and
          the only number on screen until the wager is locked. */}
      <div className="flex items-baseline gap-[1.5vmin]">
        <span className="label">Tile</span>
        <span className="font-value tabular-nums text-gold" style={{ fontSize: "max(20px, calc(var(--stage) * 3.6))" }}>
          {stake}
        </span>
      </div>

      <div className="flex gap-[1.2vmin]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-[1.2vmin] w-[1.2vmin] rounded-full bg-live animate-glow"
            style={{ animationDelay: `${i * 220}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

function Interlude({ title, rows, sub, final = false, champion = null, tied = null, survey = null }) {
  const medal = ["#f2c96b", "#c0c0c8", "#c08a5a"]
  /*
    Everyone, not the top eight.

    The list was capped, which is defensible mid-game and wrong at the end of
    one: a player who came ninth still wants to see their name when the lights
    come up. So it scales instead of truncating — a big field gets smaller type
    rather than losing its tail.
  */
  const n = rows.length
  const size = n <= 6 ? 3.4 : n <= 10 ? 2.6 : n <= 16 ? 2 : 1.6
  const gap = n <= 10 ? 1.4 : 0.7
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin]">
      {sub && <div className="label" style={{ letterSpacing: "0.4em" }}>{sub}</div>}
      <div className="font-display text-gold brass" style={{ fontSize: "max(30px, calc(var(--stage) * 6))" }}>
        {title}
      </div>
      <VeinLine className="w-[40vmin]" height={18} />

      {tied && (
        <div className="font-display uppercase tracking-[0.25em] text-live animate-glow" style={{ fontSize: "max(13px, calc(var(--stage) * 2))" }}>
          Level at the top
        </div>
      )}

      <div className="flex flex-col items-center" style={{ gap: `${gap}vmin` }}>
        {rows.map((row, i) => {
          // Survey points are a separate column and belong beside the score
          // rather than added to it — the round is won on them, and a board
          // that folded them in would be showing a number nobody played for.
          const played = survey?.contenders?.includes(row.id)
          const points = played ? (survey.points?.[row.id] ?? 0) : null
          return (
            <div
              key={row.id}
              className="flex items-baseline gap-[2.5vmin] animate-rise"
              style={{ animationDelay: `${Math.min(i, 12) * 110}ms` }}
            >
              <span className="font-value tabular-nums text-muted" style={{ fontSize: `max(12px, calc(var(--stage) * ${size * 0.6}))` }}>
                {i + 1}
              </span>
              <span
                className="font-display"
                style={{ fontSize: `max(15px, calc(var(--stage) * ${size}))`, color: final && i < 3 ? medal[i] : (row.color ?? "var(--color-ink)") }}
              >
                {row.name}
                {champion === row.id && <span className="ml-[1.5vmin] text-live">♛</span>}
              </span>
              <span className="font-value tabular-nums text-gold" style={{ fontSize: `max(15px, calc(var(--stage) * ${size}))` }}>
                {row.score}
              </span>
              {points != null && (
                <span
                  className="font-value tabular-nums text-good"
                  style={{ fontSize: `max(12px, calc(var(--stage) * ${size * 0.7}))` }}
                  title="Survey points"
                >
                  +{points} survey
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CodePrompt() {
  const [value, setValue] = useState("")
  return (
    <Fullscreen>
      <div className="flex flex-col items-center gap-4">
        <Brand size={64} sub="big screen" />
        <p className="text-[13px] text-muted">Which room is this screen showing?</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) location.search = `?code=${value.trim().toUpperCase()}`
          }}
          className="flex gap-2"
        >
          <input
            className="field w-40 text-center font-display text-2xl uppercase tracking-[0.3em]"
            maxLength={4}
            placeholder="CODE"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
          />
          <button className="btn btn-gold px-5">Go</button>
        </form>
      </div>
    </Fullscreen>
  )
}

function Fullscreen({ children }) {
  return (
    <div className="relative flex h-dvh items-center justify-center text-center text-muted">
      <Backdrop veins={6} glow={3} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
