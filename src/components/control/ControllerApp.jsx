import { useCallback, useEffect, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { useAuth } from "../../lib/useAuth"
import { BOARD_CUES, SAMPLES_ENABLED } from "../../lib/sfx"
import { holdsBuzz, isSpent, nameOf, rows as sideRows } from "../../lib/sides"
import { AuthLoading, SignIn } from "../auth/SignIn"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"

/**
 * The remote controller.
 *
 * One person cannot comfortably read a clue aloud, watch five faces, and drive
 * a board at the same time. This is the second pair of hands: the host keeps
 * the questions and the verdict, and whoever holds this runs everything else.
 *
 * It is laid out for a tablet or a phone held in one hand — big targets, no
 * hover, and the two things that are urgent (the buzzer, and ruling on whoever
 * is holding it) pinned where a thumb already is.
 *
 * Two ways in: the owner signed into their own account, or a key the host
 * generated for tonight. The key lets someone drive without an account and dies
 * with the room.
 */
export function ControllerApp() {
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase())
  const [key] = useState(params.get("key") ?? "")
  const [entered, setEntered] = useState(!!params.get("code"))
  const [error, setError] = useState(null)

  const auth = useAuth()

  const { state, connected, send } = useRoom({
    role: "controller",
    code,
    key,
    enabled: entered && !!code && (auth.ready ? !!auth.user || !!key : false),
    onError: (e) => {
      setError(e)
      if (e.code === "auth" || e.code === "no-room" || e.code === "revoked") setEntered(false)
    },
  })

  if (!auth.ready) return <AuthLoading />
  // A key stands in for an account — that is the whole point of handing one out.
  if (!auth.user && !key) return <SignIn auth={auth} what="pick up a controller" />

  if (!entered || !state) {
    return (
      <CodePrompt
        code={code}
        setCode={setCode}
        error={error}
        connecting={entered && !state}
        onGo={() => {
          setError(null)
          setEntered(true)
        }}
      />
    )
  }

  return <Console state={state} send={send} connected={connected} auth={auth} viaKey={!!key} />
}

function CodePrompt({ code, setCode, onGo, error, connecting }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5">
      <Backdrop veins={5} glow={3} />
      <form
        className="relative z-10 w-full max-w-xs space-y-3 text-center"
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim().length >= 3) onGo()
        }}
      >
        <BrandMark className="text-xl" />
        <div className="label pt-2">controller</div>
        <input
          className="field text-center font-display text-3xl uppercase tracking-[0.3em]"
          maxLength={4}
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="CODE"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
        <button className="btn btn-gold w-full py-2.5" disabled={code.trim().length < 3 || connecting}>
          {connecting ? "Connecting…" : "Take the controls"}
        </button>
        {error && <div className="text-xs text-bad">{error.message}</div>}
      </form>
    </div>
  )
}

function Console({ state, send, connected, auth, viaKey }) {
  const { phase, board, clue, players, buzzer, timer, lifeline } = state
  const round = board.round
  const now = useCallback(() => Date.now(), [])
  // Sides, so a team nitro — which has no single holder — still gets a ✓/✕.
  const rows = sideRows(state)
  const onTheHook = buzzer.winner ?? (state.wager ? (state.wager.teamId ?? state.wager.playerId) : null)
  const holderName = nameOf(state, onTheHook)
  const live = phase === "clue" && !state.paused

  return (
    <div className="relative min-h-dvh pb-40">
      <Backdrop veins={4} glow={2} />

      <header className="relative z-10 flex items-center gap-2 px-4 pt-3">
        <BrandMark className="text-base" />
        <span className="label">controller</span>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} />
        <div className="ml-auto flex items-center gap-3">
          <span className="font-display brass-sm text-lg tracking-[0.2em]">{state.code}</span>
          {!viaKey && auth.user && (
            <button className="text-[0.7rem] text-faint hover:text-bad" onClick={auth.logout}>
              sign out
            </button>
          )}
        </div>
      </header>
      <div className="bulbs relative z-10 mx-4" />

      <main className="relative z-10 mx-auto w-full max-w-3xl space-y-3 p-4 lg:max-w-6xl lg:columns-2 lg:gap-3 lg:space-y-0 [&>*]:mb-3 lg:[&>*]:break-inside-avoid">
        {phase === "final" ? <FinalConsole state={state} send={send} /> : <ClueStatus state={state} holderName={holderName} now={now} />}

        <Grid round={round} state={state} send={send} />

        <Panel title={state.teams ? "Teams" : "Scores"}>
          <div className="space-y-1.5">
            {rows.length === 0 && <div className="py-3 text-center text-xs text-faint">Nobody yet.</div>}
            {rows.map((row) => (
              <SideRow key={row.id} row={row} state={state} send={send} />
            ))}
          </div>
        </Panel>

        {/* Hidden until sounds are chosen — see `SAMPLES_ENABLED` in lib/sfx.js. */}
        {SAMPLES_ENABLED && (
          <Panel title="Soundboard">
            <div className="grid grid-cols-5 gap-1.5">
              {BOARD_CUES.map((cue) => (
                <button
                  key={cue.id}
                  className="flex flex-col items-center gap-0.5 rounded-lg border border-edge py-1.5 active:border-gold"
                  onClick={() => send("sfx:play", { cue: cue.id })}
                  title={cue.label}
                >
                  <span className="text-base leading-none">{cue.icon}</span>
                  <span className="w-full truncate px-0.5 text-center text-[0.55rem] leading-tight text-muted">{cue.label}</span>
                </button>
              ))}
            </div>
            <button
              className={`btn mt-2 w-full py-2 text-xs ${state.music ? "btn-gold" : ""}`}
              onClick={() => send("music:set", { on: !state.music })}
            >
              {state.music ? "♪ Music on" : "♪ Music off"}
            </button>
          </Panel>
        )}

        <Panel title="Clock">
          <div className="flex flex-wrap items-center gap-1.5">
            {[15, 30, 60, 90].map((s) => (
              <button key={s} className="btn flex-1 py-2 text-xs" onClick={() => send("timer:start", { seconds: s, kind: "read" })}>
                {s}s
              </button>
            ))}
            <button className="btn px-3 py-2 text-xs" onClick={() => send("timer:stop")}>
              stop
            </button>
          </div>
          <Countdown timer={timer} now={now} />
          {lifeline && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-amethyst bg-royal/30 px-3 py-2 text-xs">
              <span className="text-amethyst">☎ {players.find((p) => p.id === lifeline.playerId)?.name}</span>
              <button className="ml-auto text-faint hover:text-ink" onClick={() => send("lifeline:end")}>
                end
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Round">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{round?.name}</span>
            <span>
              {state.roundIndex + 1}/{board.roundCount}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="btn py-2 text-xs" disabled={phase !== "lobby"} onClick={() => send("game:start")}>
              Open board
            </button>
            <button
              className="btn py-2 text-xs"
              disabled={phase !== "intermission" && phase !== "ended"}
              onClick={() => send("round:next")}
            >
              Next round
            </button>
            {state.final?.enabled && phase !== "final" && (
              <button className="btn col-span-2 py-2 text-xs" onClick={() => send("final:open")}>
                ✦ Play the final clue
              </button>
            )}
          </div>
        </Panel>
      </main>

      {/* The two urgent controls, pinned under the thumb. */}
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-void/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-3xl space-y-2">
          {holderName ? (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-good py-3.5 text-sm" onClick={() => send("judge", { correct: true })}>
                ✓ {holderName}
              </button>
              <button className="btn btn-bad py-3.5 text-sm" onClick={() => send("judge", { correct: false })}>
                ✕ Wrong
              </button>
            </div>
          ) : (
            <button
              className={`w-full py-3.5 text-sm ${buzzer.armed ? "btn" : "btn btn-gold"}`}
              disabled={!live}
              onClick={() => send(buzzer.armed ? "buzzer:lock" : "buzzer:arm")}
            >
              {buzzer.armed ? "Lock buzzer" : "Arm buzzer"}
            </button>
          )}
          <div className="grid grid-cols-5 gap-2">
            <button
              className={`btn py-2 text-xs ${state.paused ? "btn-gold" : ""}`}
              onClick={() => send(state.paused ? "game:resume" : "game:pause")}
              title={state.paused ? "Let the room go again" : "Freeze the room — buzzers off, clocks held"}
            >
              {state.paused ? "▶ Go" : "❚❚ Hold"}
            </button>
            <button
              className="btn py-2 text-xs hover:border-live hover:text-live"
              disabled={!state.canUndo}
              onClick={() => send("judge:undo")}
              title="Take back the last ruling"
            >
              ↩ Undo
            </button>
            <button
              className={`btn py-2 text-xs ${state.everyoneSpent ? "btn-gold" : ""}`}
              disabled={!live}
              onClick={() => send(state.everyoneSpent ? "buzzer:reopen" : "buzzer:reset")}
              title={state.everyoneSpent ? "Everyone has had a go — open it for all of them again" : "Clear the race"}
            >
              {state.everyoneSpent ? "↻ Again" : "Reset"}
            </button>
            <button className="btn py-2 text-xs" disabled={state.revealed || !clue} onClick={() => send("clue:reveal")}>
              Reveal
            </button>
            <button className="btn py-2 text-xs" disabled={!clue} onClick={() => send("clue:close")}>
              Next clue
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** The final, driven from the controller: one step at a time, same as the desk. */
function FinalConsole({ state, send }) {
  const f = state.final
  if (!f) return null
  const current = (f.players ?? []).find((p) => p.id === f.current)

  if (f.stage === "wager") {
    const waiting = (f.players ?? []).filter((p) => !p.wagered).length
    return (
      <Panel title={`Final · ${f.category || "bets open"}`}>
        <div className="space-y-1">
          {(f.players ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-edge px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="font-value text-gold">{p.wager ?? "—"}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-gold mt-2 w-full py-2.5 text-xs" onClick={() => send("final:start")}>
          Show the clue{waiting > 0 ? ` (${waiting} not in)` : ""}
        </button>
      </Panel>
    )
  }

  if (f.stage === "clue") {
    return (
      <Panel title={`Final · ${f.category}`}>
        <div className="font-display text-sm text-ink">{f.prompt}</div>
        <div className="mt-2 rounded-lg border border-good/40 bg-good/10 px-2.5 py-1.5 text-sm text-ink">{f.answer}</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="btn py-2 text-xs" onClick={() => send("final:lock")}>
            Stop clock
          </button>
          <button className="btn btn-gold py-2 text-xs" onClick={() => send("final:reveal")}>
            Start revealing
          </button>
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={`Final · ${f.revealIndex + 1} of ${f.order.length}`}>
      <div className="font-display text-lg text-gold">{current?.name ?? "—"}</div>
      <div className="mt-1 rounded-lg border border-edge bg-black/25 px-2.5 py-2">
        <div className="font-display text-sm text-ink">{current?.answer || <span className="text-faint">nothing written</span>}</div>
        <div className="mt-1 text-xs text-muted">
          staked <span className="font-value text-gold">{current?.wager ?? 0}</span> · answer <span className="text-ink">{f.answer}</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn btn-good py-3 text-sm" onClick={() => send("final:judge", { correct: true })}>
          ✓ Correct
        </button>
        <button className="btn btn-bad py-3 text-sm" onClick={() => send("final:judge", { correct: false })}>
          ✕ Wrong
        </button>
      </div>
    </Panel>
  )
}

/** What the room is waiting on, and the answer only this screen and the host have. */
function ClueStatus({ state, holderName, now }) {
  const { clue, buzzer, phase } = state
  const answerClock = useCountdown(state.timer?.kind === "answer" ? state.timer.endsAt : null, now)

  if (!clue) {
    return (
      <Panel title="Stage">
        <div className="py-3 text-center text-xs text-muted">
          {state.paused
            ? "Held — nothing is running."
            : phase === "lobby"
              ? "Waiting to start."
              : phase === "ended"
                ? "That's the game."
                : "Pick a tile below."}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={`${clue.category} · ${state.stake}`}>
      <div className="font-display text-base leading-snug text-ink">{clue.prompt || <span className="text-faint">(no clue text)</span>}</div>
      <div className="mt-2 rounded-lg border border-good/40 bg-good/10 px-3 py-2">
        <div className="label mb-0.5" style={{ color: "var(--color-good)" }}>
          Answer
        </div>
        <div className="text-sm font-semibold text-ink">{clue.answer || <span className="text-faint">(none recorded)</span>}</div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 font-semibold uppercase tracking-wider ${
            state.paused ? "bg-gold/20 text-gold" : buzzer.armed ? "bg-good/20 text-good" : "bg-black/30 text-faint"
          }`}
        >
          {state.paused ? "held" : buzzer.armed ? "open" : "locked"}
        </span>
        {holderName && <span className="font-display text-live">{holderName} is in</span>}
        {answerClock != null && <span className="font-value text-gold tabular-nums">{(answerClock / 1000).toFixed(1)}s</span>}
      </div>

      {buzzer.order.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {buzzer.order.map((e, i) => (
            <span key={e.playerId} className={`rounded border px-2 py-0.5 text-[0.7rem] ${i === 0 ? "border-live text-live" : "border-edge text-faint"}`}>
              {nameOf(state, e.playerId)} {i === 0 ? "first" : `+${e.behind}ms`}
            </span>
          ))}
        </div>
      )}
    </Panel>
  )
}

function Grid({ round, state, send }) {
  if (!round) return null
  const live = state.phase === "board"
  return (
    <Panel title={`Board · ${live ? "pick one" : "in play"}`}>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${round.categories.length}, minmax(0, 1fr))` }}>
        {round.categories.map((cat) => (
          <div key={cat.id} className="truncate pb-1 text-center text-[0.6rem] uppercase leading-tight text-muted" title={cat.title}>
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
                className={`relative h-11 rounded font-value text-sm transition-colors ${
                  active
                    ? "bg-gold text-onyx"
                    : played
                      ? "bg-black/30 text-gold-dim/40 line-through decoration-gold-dim/30"
                      : live
                        ? "bg-panel-2 text-gold/85 active:bg-royal"
                        : "bg-panel-2 text-gold/40"
                }`}
              >
                {clue.value}
                {clue.nitro && !played && <span className="absolute right-1 top-0.5 text-[0.55rem] text-live">✦</span>}
              </button>
            )
          }),
        )}
      </div>
    </Panel>
  )
}

/**
 * A row that scores — a player, or a team.
 *
 * Score changes are addressed by the row's own id, which the relay resolves to
 * whichever ledger it belongs to, so this needs no branch of its own. The
 * lifeline does: a phone call is made by a person, so on a team it is granted
 * to the first member.
 */
function SideRow({ row, state, send }) {
  const stake = state.stake || 100
  const holds = holdsBuzz(row, state.buzzer)
  const spent = isSpent(row, state.buzzer)
  const caller = row.members ? row.members[0] : row.id

  return (
    <div
      style={row.color && !holds ? { borderColor: `${row.color}55` } : undefined}
      className={`rounded-lg border px-2.5 py-2 ${holds ? "border-live bg-live/10" : "border-edge"} ${spent ? "opacity-55" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.connected ? "bg-good" : "bg-faint"}`}
          style={row.color && row.connected ? { background: row.color } : undefined}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</span>
        <span className={`font-value text-base tabular-nums ${row.score < 0 ? "text-bad" : "text-gold"}`}>{row.score}</span>
      </div>
      {row.memberNames?.length > 0 && <div className="truncate text-[0.6rem] text-faint">{row.memberNames.join(" · ")}</div>}
      <div className="mt-1.5 flex gap-1">
        <button className="btn flex-1 px-1 py-1 text-[0.7rem]" onClick={() => send("score:adjust", { playerId: row.id, delta: stake })}>
          +{stake}
        </button>
        <button className="btn flex-1 px-1 py-1 text-[0.7rem]" onClick={() => send("score:adjust", { playerId: row.id, delta: -stake })}>
          −{stake}
        </button>
        <button
          className="btn px-2 py-1 text-[0.7rem]"
          disabled={(row.lifelines?.phone ?? 0) <= 0 || !!state.lifeline || !caller}
          onClick={() => send("lifeline:grant", { playerId: caller, lifeline: "phone" })}
        >
          ☎ {row.lifelines?.phone ?? 0}
        </button>
      </div>
    </div>
  )
}

function Countdown({ timer, now }) {
  const left = useCountdown(timer && timer.kind !== "answer" ? timer.endsAt : null, now)
  if (left == null) return null
  return <div className="mt-2 text-center font-value text-2xl text-gold tabular-nums">{Math.ceil(left / 1000)}</div>
}

const Panel = ({ title, children }) => (
  <section className="panel p-3">
    <div className="label mb-2">{title}</div>
    {children}
  </section>
)
