import { useEffect, useState } from "react"
import { useCountdown } from "../../lib/useRoom"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { PlayerRoster } from "./PlayerRoster"

/**
 * Part two of the host's night: running the game.
 *
 * The layout is deliberately unglamorous — this screen is read at a glance,
 * under pressure, while talking. The one thing it does own is the answer,
 * which nobody else in the building can see.
 */
export function GameControl({ state, send, now, requests, code, savedAt }) {
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
      else if (e.key === "r" || e.key === "R") send("clue:reveal")
      else if (e.key === "Enter") send("clue:close")
      else if (e.key === "Escape") send("buzzer:reset")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [send, buzzer.armed])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_290px] 2xl:grid-cols-[minmax(260px,18%)_minmax(0,1fr)_minmax(330px,22%)]">
      <MiniBoard state={state} send={send} />

      <div className="flex min-h-0 flex-col gap-3">
        <StagePanel state={state} send={send} now={now} />
        <BuzzerPanel state={state} send={send} now={now} />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <PlayerRoster players={players} send={send} buzzer={buzzer} lifeline={lifeline} requests={requests} stake={state.stake} />
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
          <SaveControls send={send} savedAt={savedAt} code={code} />
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

  return (
    <div className="panel flex min-h-0 flex-col">
      <div className="border-b border-edge px-3 py-2">
        <span className="label">{round.name}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${round.categories.length}, minmax(0, 1fr))` }}>
          {round.categories.map((cat) => (
            <div key={cat.id} className="truncate px-0.5 pb-1 text-center text-[9px] uppercase leading-tight text-muted" title={cat.title}>
              {cat.title || "—"}
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
                  className={`relative h-8 rounded font-value text-[13px] transition-colors ${
                    active
                      ? "bg-gold text-onyx"
                      : played
                        ? "bg-black/30 text-gold-dim/40 line-through decoration-gold-dim/30"
                        : live
                          ? "bg-panel-2 text-gold/85 hover:bg-royal"
                          : "bg-panel-2 text-gold/40"
                  }`}
                >
                  {clue.value}
                  {clue.dailyDouble && !played && <span className="absolute right-0.5 top-0 text-[8px] text-live">✦</span>}
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
  const [wagerAmount, setWagerAmount] = useState("")
  const [wagerPlayer, setWagerPlayer] = useState("")

  useEffect(() => {
    if (phase === "wager") {
      setWagerAmount("")
      setWagerPlayer(players[0]?.id ?? "")
    }
  }, [phase, clue?.id])

  if (phase === "lobby") {
    return (
      <Empty>
        <div className="text-center">
          <div className="font-display text-xl text-gold">Ready when you are.</div>
          <p className="mx-auto mt-2 max-w-sm text-[12px] text-muted">
            Players join with the room code. Open the board when everyone's in — the big screen follows this desk.
          </p>
          <button className="btn btn-gold mt-4 px-6 py-2.5" onClick={() => send("game:start")}>
            Open the board
          </button>
        </div>
      </Empty>
    )
  }

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
          {phase === "intermission" && (
            <button className="btn btn-gold mt-4 px-6 py-2.5" onClick={() => send("round:next")}>
              Start next round
            </button>
          )}
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
    const max = Math.max(players.find((p) => p.id === wagerPlayer)?.score ?? 0, ...(state.board.round?.values ?? [0]))
    return (
      <div className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
        <div className="font-display text-2xl text-live animate-glow">DAILY DOUBLE</div>
        <div className="text-[12px] text-muted">Who found it, and what are they risking?</div>
        <select className="field max-w-xs" value={wagerPlayer} onChange={(e) => setWagerPlayer(e.target.value)}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.score}
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

  const holder = players.find((p) => p.id === state.buzzer.winner)

  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-4">
      <div className="flex items-center gap-2">
        <span className="label">{clue.category}</span>
        <span className="font-value text-lg text-gold">{state.stake}</span>
        {clue.dailyDouble && <span className="text-[10px] text-live">✦ daily double</span>}
        {wager?.playerId && <span className="text-[10px] text-muted">· {players.find((p) => p.id === wager.playerId)?.name} wagered {wager.amount}</span>}
        <div className="ml-auto flex gap-1.5">
          <button className="btn" onClick={() => send("clue:reveal")} disabled={state.revealed}>
            Reveal <Kbd>r</Kbd>
          </button>
          <button className="btn btn-gold" onClick={() => send("clue:close")}>
            Next <Kbd>⏎</Kbd>
          </button>
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <div className="font-display text-[17px] leading-snug text-ink">{clue.prompt || <span className="text-faint">(no clue text)</span>}</div>
        {clue.media && <MediaPreview media={clue.media} />}

        <div className="mt-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2">
          <div className="label mb-0.5" style={{ color: "var(--color-good)" }}>
            Answer {state.revealed && "· on screen"}
          </div>
          <div className="text-[15px] font-semibold text-ink">{clue.answer || <span className="text-faint">(none recorded)</span>}</div>
        </div>
        {clue.answerMedia && <MediaPreview media={clue.answerMedia} />}
      </div>

      {holder && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-live bg-live/10 px-3 py-2 animate-pop">
          <span className="font-display text-lg text-live">{holder.name}</span>
          <span className="text-[11px] text-muted">has the floor</span>
          <AnswerClock timer={state.timer} now={now} />
          <div className="ml-auto flex gap-1.5">
            <button className="btn btn-good" onClick={() => send("judge", { correct: true })}>
              Correct <Kbd>y</Kbd>
            </button>
            <button className="btn btn-bad" onClick={() => send("judge", { correct: false })}>
              Wrong <Kbd>n</Kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MediaPreview({ media }) {
  const src = resolveMediaUrl(media.url)
  return media.kind === "image" ? (
    <img src={src} alt={media.alt ?? ""} className="mt-3 max-h-40 rounded-lg border border-edge object-contain" />
  ) : (
    <audio src={src} controls className="mt-3 w-full" preload="metadata" />
  )
}

function AnswerClock({ timer, now }) {
  const left = useCountdown(timer?.kind === "answer" ? timer.endsAt : null, now)
  if (left == null) return null
  return <span className={`font-value text-lg tabular-nums ${left < 3000 ? "text-bad" : "text-gold"}`}>{(left / 1000).toFixed(1)}s</span>
}

/** Arm, lock, reset — plus the race, so a photo finish can be adjudicated. */
function BuzzerPanel({ state, send, now }) {
  const { buzzer, players, phase, lifeline } = state
  const live = phase === "clue"
  const byId = Object.fromEntries(players.map((p) => [p.id, p]))
  const lifelineLeft = useCountdown(lifeline?.endsAt, now)

  return (
    <div className="panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Buzzer</span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            buzzer.armed ? "bg-good/20 text-good animate-glow" : "bg-black/30 text-faint"
          }`}
        >
          {buzzer.armed ? "open" : "locked"}
        </span>

        <button className={`btn ${buzzer.armed ? "" : "btn-gold"}`} disabled={!live} onClick={() => send("buzzer:arm")}>
          Arm <Kbd>space</Kbd>
        </button>
        <button className="btn" disabled={!buzzer.armed} onClick={() => send("buzzer:lock")}>
          Lock
        </button>
        <button className="btn" disabled={!live} onClick={() => send("buzzer:reset")}>
          Reset <Kbd>esc</Kbd>
        </button>

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
              {i + 1}. {byId[e.playerId]?.name ?? "—"} <span className="text-faint">{e.ms}ms</span>
            </button>
          ))}
        </div>
      )}
      {buzzer.spent.length > 0 && (
        <div className="mt-1.5 text-[10px] text-faint">
          out this clue: {buzzer.spent.map((id) => byId[id]?.name ?? "?").join(", ")}
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

const Empty = ({ children }) => <div className="panel flex min-h-0 flex-1 items-center justify-center p-6">{children}</div>

const Kbd = ({ children }) => (
  <kbd className="ml-1 rounded border border-edge bg-black/30 px-1 py-px font-body text-[9px] uppercase text-faint">{children}</kbd>
)
