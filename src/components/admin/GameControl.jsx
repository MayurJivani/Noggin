import { useEffect, useState } from "react"
import { useCountdown } from "../../lib/useRoom"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { controllerUrl, lecternUrl } from "../../lib/net"
import { BOARD_CUES, SAMPLES_ENABLED } from "../../lib/sfx"
import { nameOf, rows as sideRows } from "../../lib/sides"
import { QrBlock } from "../ui/QrBlock"
import { PlayerRoster } from "./PlayerRoster"

/**
 * Part two of the host's night: running the game.
 *
 * The layout is deliberately unglamorous — this screen is read at a glance,
 * under pressure, while talking. The one thing it does own is the answer,
 * which nobody else in the building can see.
 */
export function GameControl({ state, send, now, requests, code, savedAt, controllerKey }) {
  const { phase, board, clue, players, buzzer, timer, lifeline } = state
  const round = board.round

  // Space to arm/lock, Y/N to judge, Enter to move on. Hosts end up driving
  // this with one hand while holding a microphone with the other.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return
      if (e.key === " ") {
        e.preventDefault()
        send(buzzer.armed ? "buzzer:lock" : "buzzer:arm")
      } else if (e.key === "y" || e.key === "Y") send("judge", { correct: true })
      else if (e.key === "n" || e.key === "N") send("judge", { correct: false })
      else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        send("judge:undo")
      }
      else if (e.key === "r" || e.key === "R") send("clue:reveal")
      else if (e.key === "p" || e.key === "P") send(state.paused ? "game:resume" : "game:pause")
      else if (e.key === "Enter") send("clue:close")
      else if (e.key === "Escape") send("buzzer:reset")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [send, buzzer.armed, state.paused])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(300px,30%)_minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(380px,32%)_minmax(0,1fr)_minmax(340px,20%)]">
      <MiniBoard state={state} send={send} />

      <div className="flex min-h-0 flex-col gap-3">
        <StagePanel state={state} send={send} now={now} />
        <BuzzerPanel state={state} send={send} now={now} />
        <Soundboard state={state} send={send} />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <PlayerRoster
          players={players}
          teams={state.teams}
          send={send}
          buzzer={buzzer}
          lifeline={lifeline}
          requests={requests}
          stake={state.stake}
          code={code}
        />
        <div className="panel p-3">
          <div className="label mb-2">Room</div>
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>Code</span>
            <span className="font-display brass-sm text-lg tracking-[0.2em]">{code}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[12px] text-muted">
            <span>Round</span>
            <span>
              {round?.name} · {state.roundIndex + 1}/{board.roundCount}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn" disabled={phase !== "intermission" && phase !== "ended"} onClick={() => send("round:next")}>
              Next round
            </button>
            <button className="btn hover:border-bad hover:text-bad" onClick={() => confirm("Reset scores and reopen every clue?") && send("game:reset")}>
              Reset game
            </button>
          </div>
          {/*
            The same setting as the builder's, put where the host actually is on
            the night. It comes up mid-game — a clue with a picture the room
            should be looking at together, or a suspicion that phones are being
            read instead of the screen.
          */}
          <div className="mt-3">
            <div className="label mb-1.5">Players' phones</div>
            <button
              className={`btn w-full py-1.5 text-[11px] ${state.settings.mirrorClue !== false ? "btn-gold" : ""}`}
              onClick={() => send("settings:set", { settings: { mirrorClue: state.settings.mirrorClue === false } })}
              title="Whether the clue is mirrored onto players' phones. Off means it is never sent to them."
            >
              {state.settings.mirrorClue !== false ? "Clue is on phones" : "Clue is hidden"}
            </button>
            <div className="mt-1 text-[10px] leading-snug text-faint">
              {state.settings.mirrorClue !== false
                ? "Anyone who can't see the TV can read along."
                : "Not sent to phones at all — and their buzzer is bigger for it."}
            </div>
          </div>

          <ControllerInvite send={send} controllerKey={controllerKey} code={code} />
          <SaveControls send={send} savedAt={savedAt} code={code} />
          <DeleteRoom send={send} code={code} players={players.length} />
          <TimerControls send={send} timer={timer} now={now} />
        </div>
      </div>
    </div>
  )
}

/** The grid, small. This is how the host picks — the big screen just follows. */
function MiniBoard({ state, send }) {
  const round = state.board.round
  const live = state.phase === "board"
  if (!round) return null

  const cols = round.categories.length
  const rows = round.values.length
  const left = round.categories.reduce((n, c) => n + c.clues.filter((cl) => cl.status !== "played").length, 0)

  return (
    <div className="panel flex min-h-0 flex-col">
      <div className="flex items-baseline gap-2 border-b border-edge px-3 py-2">
        <span className="label">{round.name}</span>
        <span className="ml-auto text-[0.7rem] text-faint">{left} left</span>
      </div>

      {/*
        The grid fills the panel instead of sitting at the top of it in 32px
        rows. This is the control the host actually drives the game with, and
        it was the smallest thing on a 1700px screen while the column beside it
        held an acre of nothing. Rows are `1fr`, so the board grows to whatever
        height it is given and the tiles come with it.
      */}
      <div className="min-h-0 flex-1 p-2">
        <div
          className="grid h-full gap-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `auto repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {round.categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-end justify-center px-0.5 pb-1 text-center uppercase leading-[1.15] text-muted"
              style={{ fontSize: `clamp(9px, ${Math.max(0.5, 1.1 - cols * 0.05)}vw, 13px)` }}
              title={cat.title}
            >
              {/* Two lines rather than an ellipsis: "8TH GRADE T…" is not a
                  category, and the host has to recognise it at a glance. */}
              <span className="line-clamp-2">{cat.title || "—"}</span>
            </div>
          ))}
          {round.values.map((_, qi) =>
            round.categories.map((cat, ci) => {
              const clue = cat.clues[qi]
              if (!clue) return <div key={`${ci}-${qi}`} />
              const played = clue.status === "played"
              const active = state.clue && state.clue.catIndex === ci && state.clue.clueIndex === qi
              return (
                <button
                  key={clue.id}
                  disabled={played || !live}
                  onClick={() => send("clue:select", { catIndex: ci, clueIndex: qi })}
                  title={clue.prompt || ""}
                  style={{ fontSize: `clamp(12px, ${Math.max(0.7, 1.7 - cols * 0.08)}vw, 26px)` }}
                  className={`relative min-h-[2rem] rounded font-value tabular-nums transition-colors ${
                    active
                      ? "bg-gold text-onyx"
                      : played
                        ? "bg-black/30 text-gold-dim/40 line-through decoration-gold-dim/30"
                        : live
                          ? "bg-panel-2 text-gold/85 hover:bg-royal hover:text-gold"
                          : "bg-panel-2 text-gold/40"
                  }`}
                >
                  {clue.value}
                  {clue.nitro && !played && <span className="absolute right-1 top-0.5 text-[0.6rem] text-live">✦</span>}
                </button>
              )
            }),
          )}
        </div>
      </div>
    </div>
  )
}

/** The clue, the answer, and whatever the room is currently waiting on. */
function StagePanel({ state, send, now }) {
  const { phase, clue, players, wager } = state
  // Whoever can take the clue: a person, or a team on team night.
  const contenders = sideRows(state)
  const [wagerAmount, setWagerAmount] = useState("")
  const [wagerPlayer, setWagerPlayer] = useState("")

  useEffect(() => {
    if (phase === "wager") {
      setWagerAmount("")
      setWagerPlayer(contenders[0]?.id ?? "")
    }
  }, [phase, clue?.id])

  if (phase === "lobby") {
    return (
      <Empty>
        <div className="w-full max-w-md text-center">
          <div className="font-display text-xl text-gold">Ready when you are.</div>
          <p className="mx-auto mt-2 max-w-sm text-[12px] text-muted">
            Players join with the room code. Open the board when everyone's in — the big screen follows this desk.
          </p>
          <BuzzerCheck state={state} send={send} />
        </div>
      </Empty>
    )
  }

  if (phase === "final") return <FinalControls state={state} send={send} />

  if (phase === "intermission" || phase === "ended") {
    const winner = players[0]
    return (
      <Empty>
        <div className="text-center">
          <div className="font-display text-xl text-gold">{phase === "ended" ? "That's the game." : "Round cleared."}</div>
          {winner && (
            <div className="mt-2 text-[13px] text-muted">
              {phase === "ended" ? "Winner: " : "Leading: "}
              <span className="text-ink">{winner.name}</span> on <span className="font-value text-gold">{winner.score}</span>
            </div>
          )}
          <div className="mt-4 flex justify-center gap-2">
            {phase === "intermission" && (
              <button className="btn btn-gold px-6 py-2.5" onClick={() => send("round:next")}>
                Start next round
              </button>
            )}
            {state.final?.enabled && (
              <button className="btn btn-gold px-6 py-2.5" onClick={() => send("final:open")}>
                ✦ Play the final
              </button>
            )}
          </div>
        </div>
      </Empty>
    )
  }

  if (phase === "board" || !clue) {
    return (
      <Empty>
        <div className="text-center text-[12px] text-muted">
          Pick a tile from the grid.
          <div className="mt-2 text-[11px] text-faint">
            <Kbd>space</Kbd> buzzer · <Kbd>y</Kbd>/<Kbd>n</Kbd> judge · <Kbd>r</Kbd> reveal · <Kbd>enter</Kbd> next
          </div>
        </div>
      </Empty>
    )
  }

  if (phase === "wager") {
    const max = Math.max(contenders.find((c) => c.id === wagerPlayer)?.score ?? 0, ...(state.board.round?.values ?? [0]))
    return (
      <div className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
        <div className="font-display text-2xl text-live animate-glow">NOGGIN&rsquo; NITRO</div>
        <div className="text-[12px] text-muted">{state.teams ? "Which team found it, and what are they risking?" : "Who found it, and what are they risking?"}</div>
        <select className="field max-w-xs" value={wagerPlayer} onChange={(e) => setWagerPlayer(e.target.value)}>
          {contenders.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.score}
            </option>
          ))}
        </select>
        <div className="flex w-full max-w-xs items-center gap-2">
          <input
            type="number"
            className="field font-value text-lg"
            placeholder={`up to ${max}`}
            value={wagerAmount}
            onChange={(e) => setWagerAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && wagerPlayer && send("wager:set", { playerId: wagerPlayer, amount: +wagerAmount || 0 })}
          />
          <button className="btn" onClick={() => setWagerAmount(String(max))}>
            max
          </button>
        </div>
        <button className="btn btn-gold px-6" disabled={!wagerPlayer} onClick={() => send("wager:set", { playerId: wagerPlayer, amount: +wagerAmount || 0 })}>
          Lock it in
        </button>
        <button className="text-[11px] text-faint hover:text-muted" onClick={() => send("clue:close")}>
          skip this clue
        </button>
      </div>
    )
  }

  /*
    Who a ✓ or ✕ lands on.

    Usually whoever holds the buzz. A team nitro has no holder — the clue is the
    side's and any of them may say it — so the wagering team stands in, which is
    what keeps the one-keypress ruling working on team night.
  */
  const onTheHook = state.buzzer.winner ?? (wager ? (wager.teamId ?? wager.playerId) : null)
  const holderName = nameOf(state, onTheHook)
  const wagerName = wager ? nameOf(state, wager.teamId ?? wager.playerId) : null

  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-4">
      <div className="flex items-center gap-2">
        <span className="label">{clue.category}</span>
        <span className="font-value text-2xl text-gold">{state.stake}</span>
        {clue.nitro && <span className="text-[10px] text-live">✦ Noggin&rsquo; Nitro</span>}
        {wagerName && <span className="text-[10px] text-muted">· {wagerName} wagered {wager.amount}</span>}
        <div className="ml-auto flex gap-1.5">
          {state.canUndo && (
            <button className="btn hover:border-live hover:text-live" onClick={() => send("judge:undo")} title="Take back the last ruling">
              ↩ Undo <Kbd>⌘z</Kbd>
            </button>
          )}
          <button className="btn" onClick={() => send("clue:reveal")} disabled={state.revealed}>
            Reveal <Kbd>r</Kbd>
          </button>
          <button className="btn btn-gold" onClick={() => send("clue:close")}>
            Next <Kbd>⏎</Kbd>
          </button>
        </div>
      </div>

      {/*
        Centred, and sized to be read aloud from a laptop at arm's length. This
        used to pin a 17px line to the top of a panel most of a screen tall, so
        the two things the host is actually looking at sat in one corner with an
        acre of nothing under them.
      */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col justify-center overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl">
          <div className="font-display text-xl leading-snug text-ink 2xl:text-3xl">
            {clue.prompt || <span className="text-faint">(no clue text)</span>}
          </div>
          {clue.media && <MediaPreview media={clue.media} />}

          <div className="mt-4 rounded-lg border border-good/40 bg-good/10 px-4 py-3">
            <div className="label mb-1" style={{ color: "var(--color-good)" }}>
              Answer {state.revealed && "· on screen"}
            </div>
            <div className="text-lg font-semibold text-ink 2xl:text-2xl">
              {clue.answer || <span className="text-faint">(none recorded)</span>}
            </div>
          </div>
          {clue.answerMedia && <MediaPreview media={clue.answerMedia} />}
        </div>
      </div>

      {holderName && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-live bg-live/10 px-4 py-3 animate-pop">
          <span className="font-display text-xl text-live 2xl:text-2xl">{holderName}</span>
          <span className="text-xs text-muted">has the floor</span>
          <AnswerClock timer={state.timer} now={now} />
          <div className="ml-auto flex gap-2">
            <button className="btn btn-good px-5 py-2.5 text-sm" onClick={() => send("judge", { correct: true })}>
              Correct <Kbd>y</Kbd>
            </button>
            <button className="btn btn-bad px-5 py-2.5 text-sm" onClick={() => send("judge", { correct: false })}>
              Wrong <Kbd>n</Kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Prove the buzzers work before the first clue.
 *
 * "Everyone has joined" and "everyone's button reaches the relay" are different
 * questions, and only the first was answerable from this desk. A phone can hold
 * a seat and a name on a socket that died ten minutes ago, or sit in an in-app
 * browser that swallows the press — and the way you found out was clue one, in
 * front of everybody.
 *
 * So: ask the room to press it, and watch them arrive. A test press scores
 * nothing and spends nobody; it only proves the path.
 */
function BuzzerCheck({ state, send }) {
  const { check, players } = state
  const hit = (id) => !!check?.hits?.[id]
  const heard = players.filter((p) => hit(p.id)).length

  if (!players.length) {
    return (
      <div className="mt-4">
        <div className="text-[12px] text-faint">Nobody has joined yet — nothing to test.</div>
        <button className="btn mt-3 px-6 py-2.5 opacity-60" disabled>
          Open the board
        </button>
      </div>
    )
  }

  if (!check) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button className="btn px-5 py-2.5" onClick={() => send("buzzer:check")} title="Ask everyone to press their buzzer, and watch them land">
          Test the buzzers
        </button>
        <button className="btn btn-gold px-6 py-2.5" onClick={() => send("game:start")}>
          Open the board
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className={`font-display text-lg ${check.complete ? "text-good" : "text-live animate-glow"}`}>
        {check.complete ? `All ${players.length} buzzers working` : `${heard} of ${players.length} — tell them to press it`}
      </div>

      <div className="mx-auto mt-3 max-w-sm space-y-1 text-left">
        {players.map((p) => (
          <div
            key={p.id}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
              hit(p.id) ? "border-good/60 bg-good/10" : p.connected ? "border-edge" : "border-bad/50 bg-bad/5"
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.connected ? "bg-good" : "bg-bad"}`} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {/* The relay's own measurement when it has one — that is the number
                ping correction runs on. The phone's own figure fills in until
                the first pong comes back. */}
            <Latency ms={p.lag ?? p.rtt} />
            <span className={`w-16 shrink-0 text-right ${hit(p.id) ? "text-good" : "text-faint"}`}>
              {hit(p.id) ? "✓ heard" : p.connected ? "waiting…" : "away"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button className="btn px-4 py-2" onClick={() => send("buzzer:check-stop")}>
          Stop test
        </button>
        <button className={`btn px-6 py-2.5 ${check.complete ? "btn-gold animate-pop" : ""}`} onClick={() => send("game:start")}>
          Open the board
        </button>
      </div>
    </div>
  )
}

/**
 * A phone's round-trip, as the phone reports it. Diagnostic only — it never
 * touches the ordering of a race — but it is the difference between "Bob keeps
 * losing" and "Bob is on the wifi in the kitchen".
 */
function Latency({ ms }) {
  if (ms == null) return <span className="w-12 shrink-0 text-right text-[10px] text-faint">—</span>
  const tone = ms < 150 ? "text-faint" : ms < 400 ? "text-live" : "text-bad"
  return (
    <span className={`w-12 shrink-0 text-right font-body text-[10px] tabular-nums ${tone}`} title="round trip to the relay">
      {ms}ms
    </span>
  )
}

function MediaPreview({ media }) {
  const src = resolveMediaUrl(media.url)
  if (media.kind === "image") return <img src={src} alt={media.alt ?? ""} className="mt-3 max-h-40 rounded-lg border border-edge object-contain" />
  // Muted: the desk is in the same room as the speakers playing it on the big
  // screen, and two copies half a second apart is worse than none.
  if (media.kind === "video") return <video src={src} controls muted playsInline className="mt-3 max-h-40 rounded-lg border border-edge bg-black" />
  return <audio src={src} controls className="mt-3 w-full" preload="metadata" />
}

function AnswerClock({ timer, now }) {
  const left = useCountdown(timer?.kind === "answer" ? timer.endsAt : null, now)
  if (left == null) return null
  return <span className={`font-value text-lg tabular-nums ${left < 3000 ? "text-bad" : "text-gold"}`}>{(left / 1000).toFixed(1)}s</span>
}

/** Arm, lock, reset — plus the race, so a photo finish can be adjudicated. */
function BuzzerPanel({ state, send, now }) {
  const { buzzer, players, phase, lifeline } = state
  const live = phase === "clue" && !state.paused
  const byId = Object.fromEntries(players.map((p) => [p.id, p]))
  const lifelineLeft = useCountdown(lifeline?.endsAt, now)

  return (
    <div className="panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Buzzer</span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            state.paused ? "bg-gold/20 text-gold" : buzzer.armed ? "bg-good/20 text-good animate-glow" : "bg-black/30 text-faint"
          }`}
        >
          {state.paused ? "held" : buzzer.armed ? "open" : "locked"}
        </span>

        <button className={`btn ${buzzer.armed ? "" : "btn-gold"}`} disabled={!live} onClick={() => send("buzzer:arm")}>
          Arm <Kbd>space</Kbd>
        </button>

        {/*
          Stopping the night rather than the clue. The clock is banked and comes
          back with the time it had left, so a break does not silently cost
          whoever had buzzed the seconds they were owed.
        */}
        <button
          className={`btn ${state.paused ? "btn-gold animate-pop" : ""}`}
          onClick={() => send(state.paused ? "game:resume" : "game:pause")}
          title={state.paused ? "Let the room go again" : "Freeze the room — buzzers off, clocks held"}
        >
          {state.paused ? "▶ Resume" : "❚❚ Pause"} <Kbd>p</Kbd>
        </button>
        <button className="btn" disabled={!buzzer.armed} onClick={() => send("buzzer:lock")}>
          Lock
        </button>
        <button className="btn" disabled={!live} onClick={() => send("buzzer:reset")}>
          Reset <Kbd>esc</Kbd>
        </button>

        {/* Re-testing between rounds: a phone that has gone flat or wandered
            out of range since the lobby is worth finding now, not on the tile
            somebody was about to win. */}
        {(phase === "board" || phase === "intermission") && (
          <button
            className={`btn ${state.check ? "btn-gold" : ""}`}
            onClick={() => send(state.check ? "buzzer:check-stop" : "buzzer:check")}
            title="Ask everyone to press their buzzer — nothing scores"
          >
            {state.check
              ? `Testing · ${players.filter((p) => state.check.hits?.[p.id]).length}/${players.length}`
              : "Test buzzers"}
          </button>
        )}
        {/* Surfaced only when it is the answer to something. Arming on its own
            cannot help here: everyone is spent, so the buzzer would open and
            nobody could press it. */}
        {live && (state.everyoneSpent || buzzer.spent.length > 0) && (
          <button
            className={`btn ${state.everyoneSpent ? "btn-gold animate-pop" : ""}`}
            onClick={() => send("buzzer:reopen")}
            title="Clear who is out and open the buzzer again, so everyone can have another go"
          >
            ↻ Everyone again
          </button>
        )}

        {lifeline && (
          <span className="ml-auto flex items-center gap-2 rounded-lg border border-amethyst bg-royal/30 px-2.5 py-1">
            <span className="text-[11px] text-amethyst">☎ {byId[lifeline.playerId]?.name}</span>
            <span className="font-value text-base text-gold tabular-nums">{Math.ceil((lifelineLeft ?? 0) / 1000)}s</span>
            <button className="text-[10px] text-faint hover:text-ink" onClick={() => send("lifeline:end")}>
              end
            </button>
          </span>
        )}
      </div>

      {buzzer.order.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {buzzer.order.map((e, i) => (
            <button
              key={e.playerId}
              className={`rounded-md border px-2 py-1 text-[11px] ${
                i === 0 ? "border-live text-live" : "border-edge text-muted hover:border-violet"
              }`}
              title="Give this player the floor instead"
              onClick={() => send("judge", { correct: true, playerId: e.playerId })}
            >
              {i + 1}. {nameOf(state, e.playerId) ?? "—"}{" "}
              {/* Margin behind the winner, not time since the buzzer opened.
                  The latter is mostly a measure of how long the host waited
                  before arming, which is why it used to read "15000ms". */}
              <span className="text-faint">{i === 0 ? "first" : `+${e.behind}ms`}</span>
            </button>
          ))}
        </div>
      )}
      {buzzer.spent.length > 0 && (
        <div className="mt-1.5 text-[10px] text-faint">
          {state.everyoneSpent ? (
            <span className="text-live">Everyone has had a go — reopen it or move on.</span>
          ) : (
            // Sides, so a team out of the clue is named once rather than once
            // per phone it happens to be fielding.
            <>
              out this clue:{" "}
              {[...new Set(buzzer.spent.map((id) => (state.teams ? state.teams.find((t) => t.members.includes(id))?.name : byId[id]?.name) ?? "?"))].join(", ")}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The soundboard.
 *
 * Every game show has one, and until now Noggin's only sounds were the ones the
 * game fired for itself — so a host who wanted applause after a good answer, or
 * a drumroll before the final, had nothing. These play on the big screen rather
 * than here: that is where the speakers the room can hear are, and a cue
 * coming out of the host's laptop is a cue only the host enjoys.
 *
 * The bed is a toggle rather than a cue because it is a state — a display that
 * reloads mid-round should come back with the music still on.
 */
function Soundboard({ state, send }) {
  const [flash, setFlash] = useState(null)

  // No sounds chosen yet, so there is nothing to fire. The wiring stays —
  // see `SAMPLES_ENABLED` in src/lib/sfx.js.
  if (!SAMPLES_ENABLED) return null

  const fire = (id) => {
    send("sfx:play", { cue: id })
    setFlash(id)
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 500)
  }

  return (
    <div className="panel p-3">
      <div className="flex items-center gap-2">
        <span className="label">Soundboard</span>
        <span className="text-[10px] text-faint">plays on the big screen</span>
        <button
          className={`btn ml-auto px-2 py-0.5 text-[10px] ${state.music ? "btn-gold" : ""}`}
          onClick={() => send("music:set", { on: !state.music })}
          title="A loop for the lobby. Ducks under a clue on its own."
        >
          {state.music ? "♪ Music on" : "♪ Music off"}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5 2xl:grid-cols-7">
        {BOARD_CUES.map((cue) => (
          <button
            key={cue.id}
            className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors ${
              flash === cue.id ? "border-gold bg-royal/60" : "border-edge hover:border-gold-dim"
            }`}
            onClick={() => fire(cue.id)}
            title={cue.label}
          >
            <span className="text-[15px] leading-none">{cue.icon}</span>
            <span className="w-full truncate text-center text-[9px] leading-tight text-muted">{cue.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Hand the board to a second pair of hands.
 *
 * The key is minted on demand and lives only in memory on the relay, so the
 * link works tonight and not next Tuesday. Whoever scans it drives the game
 * without needing an account — which is the point, since the person running the
 * board is rarely the person who wrote the quiz.
 */
function ControllerInvite({ send, controllerKey, code }) {
  const [urls, setUrls] = useState({ lectern: "", control: "" })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!controllerKey) {
      setUrls({ lectern: "", control: "" })
      return
    }
    Promise.all([lecternUrl(code, controllerKey), controllerUrl(code, controllerKey)]).then(([lectern, control]) =>
      setUrls({ lectern, control }),
    )
  }, [controllerKey, code])

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Remote host</span>
        {controllerKey && (
          <button className="text-[0.7rem] text-faint hover:text-bad" onClick={() => send("controller:revoke")}>
            revoke
          </button>
        )}
      </div>

      {!controllerKey ? (
        <>
          <button className="btn mt-1.5 w-full py-1.5 text-[11px]" onClick={() => send("controller:invite")}>
            Create a host link
          </button>
          <div className="mt-1 text-[10px] leading-snug text-faint">
            A tablet to read from — the clue, the answer, and the verdict. No account needed.
          </div>
        </>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <div className="rounded-lg border border-edge bg-black/30 px-2 py-1.5 text-[10px] break-all text-muted">{urls.lectern || "…"}</div>
          <div className="flex gap-1.5">
            <button
              className="btn btn-gold flex-1 py-1.5 text-[11px]"
              disabled={!urls.lectern}
              onClick={() => {
                navigator.clipboard?.writeText(urls.lectern)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              }}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a className="btn px-2.5 py-1.5 text-[11px]" href={urls.lectern || "#"} target="_blank" rel="noreferrer">
              Open ↗
            </a>
          </div>
          {/* The in-depth desk is the same key — someone else driving the board
              while you read is still a thing people want, just not the default. */}
          <a className="block text-[10px] text-faint transition-colors hover:text-muted" href={urls.control || "#"} target="_blank" rel="noreferrer">
            or the full controller ↗
          </a>
        </div>
      )}
    </div>
  )
}

/**
 * Put the game down for the night.
 *
 * The relay autosaves anyway, but a host closing a laptop wants to be *told*
 * it's safe — so this is an explicit button with an explicit acknowledgement,
 * not a reassuring label over a background process.
 */
function SaveControls({ send, savedAt, code }) {
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!savedAt) return
    setFlash(true)
    const id = setTimeout(() => setFlash(false), 2200)
    return () => clearTimeout(id)
  }, [savedAt])

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Save for later</span>
        {savedAt && <span className={`text-[10px] ${flash ? "text-good" : "text-faint"}`}>{flash ? "saved ✓" : `saved ${ago(savedAt)}`}</span>}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button className="btn btn-gold flex-1 py-1.5 text-[11px]" onClick={() => send("room:save")}>
          Save game
        </button>
        <button
          className="btn px-2.5 py-1.5 text-[11px] hover:border-bad hover:text-bad"
          title="Delete the saved copy"
          onClick={() => confirm(`Forget the saved copy of ${code}?`) && send("room:forget")}
        >
          ✕
        </button>
      </div>
      <div className="mt-1 text-[10px] leading-snug text-faint">
        Reopen it from the home page with code <span className="text-muted">{code}</span>. Scores and spent tiles come back; phones rejoin.
      </div>
    </div>
  )
}

/**
 * Ends the game and removes it entirely — the live room, the saved copy, the
 * scores. Distinct from "forget the saved copy", which leaves the night running
 * and only declines to keep it, so the confirmation spells out the difference.
 */
function DeleteRoom({ send, code, players }) {
  return (
    <div className="mt-3 border-t border-edge pt-3">
      <button
        className="btn w-full py-1.5 text-[11px] hover:border-bad hover:text-bad"
        onClick={() => {
          const who = players ? ` ${players} player${players === 1 ? "" : "s"} will be disconnected.` : ""
          if (confirm(`Delete game ${code}?${who} Scores and the saved copy go with it. This cannot be undone.`)) {
            send("room:delete")
          }
        }}
      >
        Delete this game
      </button>
    </div>
  )
}

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function TimerControls({ send, timer, now }) {
  const left = useCountdown(timer && timer.kind !== "answer" ? timer.endsAt : null, now)
  return (
    <div className="mt-3">
      <div className="label mb-1.5">Clock</div>
      <div className="flex items-center gap-1.5">
        {[15, 30, 60].map((s) => (
          <button key={s} className="btn flex-1 px-1 py-1 text-[11px]" onClick={() => send("timer:start", { seconds: s, kind: "read" })}>
            {s}s
          </button>
        ))}
        <button className="btn px-2 py-1 text-[11px]" onClick={() => send("timer:stop")}>
          ✕
        </button>
      </div>
      {left != null && <div className="mt-1.5 text-center font-value text-xl text-gold tabular-nums">{Math.ceil(left / 1000)}</div>}
    </div>
  )
}


/**
 * Driving the final.
 *
 * Deliberately one button at a time: the stages are strictly ordered and the
 * host is talking while they press, so the panel offers only the next step
 * rather than a row of alternatives to pick wrong from.
 */
function FinalControls({ state, send }) {
  const f = state.final
  if (!f) return null
  const waiting = (f.players ?? []).filter((p) => !p.wagered).length
  const unanswered = (f.players ?? []).filter((p) => !p.answered).length
  const current = (f.players ?? []).find((p) => p.id === f.current)

  if (f.stage === "wager") {
    return (
      <Empty>
        <div className="w-full max-w-md text-center">
          <div className="label">Final · {f.category || "no category"}</div>
          <div className="mt-1 font-display text-xl text-gold">Bets are open</div>
          <p className="mt-2 text-[12px] text-muted">
            {waiting === 0 ? "Everyone has bet." : `Waiting on ${waiting} player${waiting === 1 ? "" : "s"}.`}
          </p>
          <div className="mt-3 space-y-1 text-left">
            {(f.players ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-edge px-2.5 py-1.5 text-[12px]">
                <span className="flex-1 truncate">{p.name}</span>
                <span className="font-value text-gold">{p.wager ?? "—"}</span>
                <span className={p.wagered ? "text-good" : "text-faint"}>{p.wagered ? "in" : "…"}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-gold mt-4 px-6 py-2.5" onClick={() => send("final:start")}>
            Show the clue{waiting > 0 ? ` (${waiting} not in)` : ""}
          </button>
        </div>
      </Empty>
    )
  }

  if (f.stage === "clue") {
    return (
      <Empty>
        <div className="w-full max-w-md text-center">
          <div className="label">Final · {f.category}</div>
          <div className="mt-2 font-display text-[15px] leading-snug text-ink">{f.prompt}</div>
          <div className="mt-2 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-left">
            <div className="label" style={{ color: "var(--color-good)" }}>
              Answer
            </div>
            <div className="text-[14px] font-semibold text-ink">{f.answer}</div>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {unanswered === 0 ? "Everyone has written something." : `${unanswered} still writing.`}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button className="btn" onClick={() => send("final:lock")}>
              Stop the clock
            </button>
            <button className="btn btn-gold px-5" onClick={() => send("final:reveal")}>
              Start revealing
            </button>
          </div>
        </div>
      </Empty>
    )
  }

  return (
    <Empty>
      <div className="w-full max-w-md text-center">
        <div className="label">Final · turning over</div>
        <div className="mt-1 font-display text-xl text-gold">{current?.name ?? "—"}</div>
        <div className="mt-2 rounded-lg border border-edge bg-black/25 px-3 py-2">
          <div className="font-display text-lg text-ink">{current?.answer || <span className="text-faint">nothing written</span>}</div>
          <div className="mt-1 text-[12px] text-muted">
            staked <span className="font-value text-gold">{current?.wager ?? 0}</span> · correct answer{" "}
            <span className="text-ink">{f.answer}</span>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <button className="btn btn-good px-6 py-2.5" onClick={() => send("final:judge", { correct: true })}>
            Correct
          </button>
          <button className="btn btn-bad px-6 py-2.5" onClick={() => send("final:judge", { correct: false })}>
            Wrong
          </button>
        </div>
        <div className="mt-2 text-[11px] text-faint">
          {f.revealIndex + 1} of {f.order.length}
        </div>
      </div>
    </Empty>
  )
}

const Empty = ({ children }) => <div className="panel flex min-h-0 flex-1 items-center justify-center p-6">{children}</div>

const Kbd = ({ children }) => (
  <kbd className="ml-1 rounded border border-edge bg-black/30 px-1 py-px font-body text-[9px] uppercase text-faint">{children}</kbd>
)
