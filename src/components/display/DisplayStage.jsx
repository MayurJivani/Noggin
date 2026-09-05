import { useCallback, useEffect, useRef, useState } from "react"
import { useRoom } from "../../lib/useRoom"
import { playForEffect, unlock, isUnlocked, music } from "../../lib/sfx"
import { nameOf, rows as sideRows } from "../../lib/sides"
import { useWakeLock } from "../../lib/useWakeLock"
import { Backdrop } from "../ui/Backdrop"
import { Brand, BrandMark } from "../ui/Brand"
import { JoinCard } from "../ui/JoinCard"
import { VeinLine } from "../ui/Vein"
import { BoardGrid } from "./BoardGrid"
import { FinalStage } from "./FinalStage"
import { ClueCard } from "./ClueCard"
import { ScoreBar } from "./ScoreBar"
import { BuzzerBanner, BuzzOverlay, NitroSplash, LifelineOverlay, TimerRing } from "./Overlays"

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

  const { state, connected, send } = useRoom({ role: "display", code, onEffects, onError: setError })
  void send

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
function Stage({ code, state, connected, error, audioOn, flash, splash, origin, cellRef }) {
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
            {state.code}
          </div>
        </div>
        {!connected && <span className="ml-2 h-2 w-2 rounded-full bg-bad animate-glow" title="reconnecting" />}
      </header>
      <div className="bulbs relative z-10 mx-[2.5vmin] shrink-0" />

      <main className="relative z-10 min-h-0 flex-1">
        {phase === "lobby" && <Lobby code={state.code} players={players} teams={state.teams} title={board.title} check={state.check} />}
        {phase === "final" && <FinalStage state={state} now={() => Date.now()} />}
        {phase === "intermission" && <Interlude title="Round cleared" rows={rows} sub={board.round?.name} />}
        {phase === "ended" && <Interlude title="Final scores" rows={rows} final />}

        {(phase === "board" || phase === "clue" || phase === "wager" || phase === "reveal") && (
          <div className="relative h-full w-full">
            <BoardGrid round={board.round} cellRef={cellRef} />
            {clue && phase !== "board" && (
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

function Lobby({ code, players, teams, title, check }) {
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
        </div>
      )}

      <JoinCard code={code} size={Math.round(Math.min(260, Math.max(150, window.innerWidth / 7)))} />

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

function Interlude({ title, rows, sub, final = false }) {
  const medal = ["#f2c96b", "#c0c0c8", "#c08a5a"]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin]">
      {sub && <div className="label" style={{ letterSpacing: "0.4em" }}>{sub}</div>}
      <div className="font-display text-gold brass" style={{ fontSize: "max(30px, calc(var(--stage) * 6))" }}>
        {title}
      </div>
      <VeinLine className="w-[40vmin]" height={18} />
      <div className="flex flex-col items-center gap-[1.4vmin]">
        {rows.slice(0, 8).map((row, i) => (
          <div key={row.id} className="flex items-baseline gap-[2.5vmin] animate-rise" style={{ animationDelay: `${i * 110}ms` }}>
            <span className="font-value tabular-nums text-muted" style={{ fontSize: "max(14px, calc(var(--stage) * 2))" }}>
              {i + 1}
            </span>
            <span
              className="font-display"
              style={{ fontSize: "max(18px, calc(var(--stage) * 3.4))", color: final && i < 3 ? medal[i] : (row.color ?? "var(--color-ink)") }}
            >
              {row.name}
            </span>
            <span className="font-value tabular-nums text-gold" style={{ fontSize: "max(18px, calc(var(--stage) * 3.4))" }}>
              {row.score}
            </span>
          </div>
        ))}
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
