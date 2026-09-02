import { useEffect, useState } from "react"
import { useCountdown } from "../../lib/useRoom"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { controllerUrl } from "../../lib/net"
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
      else if (e.key === "Enter") send("clue:close")
      else if (e.key === "Escape") send("buzzer:reset")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [send, buzzer.armed])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(300px,30%)_minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(380px,32%)_minmax(0,1fr)_minmax(340px,20%)]">
      <MiniBoard state={state} send={send} />

      <div className="flex min-h-0 flex-col gap-3">
        <StagePanel state={state} send={send} now={now} />
        <BuzzerPanel state={state} send={send} now={now} />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <PlayerRoster players={players} send={send} buzzer={buzzer} lifeline={lifeline} requests={requests} stake={state.stake} code={code} />
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
                  {clue.dailyDouble && !played && <span className="absolute right-1 top-0.5 text-[0.6rem] text-live">✦</span>}
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
        <span className="font-value text-2xl text-gold">{state.stake}</span>
        {clue.dailyDouble && <span className="text-[10px] text-live">✦ daily double</span>}
        {wager?.playerId && <span className="text-[10px] text-muted">· {players.find((p) => p.id === wager.playerId)?.name} wagered {wager.amount}</span>}
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

      {holder && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-live bg-live/10 px-4 py-3 animate-pop">
          <span className="font-display text-xl text-live 2xl:text-2xl">{holder.name}</span>
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
              {i + 1}. {byId[e.playerId]?.name ?? "—"}{" "}
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
          out this clue: {buzzer.spent.map((id) => byId[id]?.name ?? "?").join(", ")}
        </div>
      )}
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
  const [url, setUrl] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!controllerKey) {
      setUrl("")
      return
    }
    controllerUrl(code, controllerKey).then(setUrl)
  }, [controllerKey, code])

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Remote controller</span>
        {controllerKey && (
          <button className="text-[0.7rem] text-faint hover:text-bad" onClick={() => send("controller:revoke")}>
            revoke
          </button>
        )}
      </div>

      {!controllerKey ? (
        <>
          <button className="btn mt-1.5 w-full py-1.5 text-[11px]" onClick={() => send("controller:invite")}>
            Create a controller link
          </button>
          <div className="mt-1 text-[10px] leading-snug text-faint">
            For someone else to drive the board while you read. No account needed.
          </div>
        </>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <div className="rounded-lg border border-edge bg-black/30 px-2 py-1.5 text-[10px] break-all text-muted">{url || "…"}</div>
          <div className="flex gap-1.5">
            <button
              className="btn btn-gold flex-1 py-1.5 text-[11px]"
              disabled={!url}
              onClick={() => {
                navigator.clipboard?.writeText(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              }}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a className="btn px-2.5 py-1.5 text-[11px]" href={url || "#"} target="_blank" rel="noreferrer">
              Open ↗
            </a>
          </div>
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
