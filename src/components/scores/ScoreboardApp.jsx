import { useCallback, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { holdsBuzz, isCalling, isSpent, nameOf, raceOf, rows as sideRows, wagerOf } from "../../lib/sides"
import { useRolling } from "../../lib/useRolling"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

/**
 * The scoreboard: a second screen that answers "where are we?".
 *
 * The big screen is busy being the game — a board, then a clue filling the
 * frame, then an answer. None of that leaves room for the state of play, so
 * this is everything the room keeps asking about instead: the scores, who is
 * in, what is at stake, whose phone call is running, and who has bet what.
 *
 * Read-only and stateless, like `/display`. It joins as a viewer, so it is
 * subject to exactly the same redaction: it never learns an unplayed clue, and
 * a blind final wager stays blind here too.
 */
export function ScoreboardApp() {
  const [code] = useState(() => new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "")
  const [error, setError] = useState(null)
  const { state, connected } = useRoom({ role: "display", code, onError: setError })
  const now = useCallback(() => Date.now(), [])

  if (!code) return <Prompt />
  if (error) return <Full>{error.message}</Full>
  if (!state) return <Full>{connected ? "Joining…" : "Looking for the room…"}</Full>

  const { buzzer, lifeline, clue, phase } = state
  // Whatever is being scored tonight: five people, or three teams.
  const rows = sideRows(state)
  const holderName = nameOf(state, buzzer.winner)
  const finalRows = state.final?.players ?? []

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <Backdrop veins={7} glow={3} />

      <header className="relative z-10 flex shrink-0 items-center gap-[2vmin] px-[2.5vmin] pt-[2vmin]">
        <BrandMark className="text-[max(14px,calc(var(--stage)*2))]" />
        <span className="label">scoreboard</span>
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

      {/* One line for whatever the room is waiting on right now. */}
      <div className="relative z-10 shrink-0 px-[2.5vmin] pt-[1.5vmin]">
        <StatusStrip state={state} holderName={holderName} now={now} />
      </div>

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden p-[2vmin]">
        <div
          className="grid h-full gap-[1.2vmin]"
          style={{
            gridTemplateColumns: `repeat(${columnsFor(rows.length)}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(0, 1fr)",
          }}
        >
          {rows.map((row, i) => {
            const onCall = isCalling(row, lifeline)
            return (
              <SideCard
                key={row.id}
                row={row}
                rank={i + 1}
                buzzer={buzzer}
                onCall={onCall}
                callEndsAt={onCall ? lifeline.endsAt : null}
                dimmed={!!lifeline && !onCall}
                final={finalRows.find((f) => f.id === row.id)}
                wager={wagerOf(row, state.wager)}
                now={now}
              />
            )
          })}
          {rows.length === 0 && (
            <div className="col-span-full flex items-center justify-center text-muted" style={{ fontSize: "max(13px, calc(var(--stage) * 2))" }}>
              Nobody has joined yet.
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 flex shrink-0 items-center gap-[2vmin] px-[2.5vmin] pb-[1.5vmin] text-muted">
        <span style={{ fontSize: "max(11px, calc(var(--stage) * 1.4))" }}>{state.board.round?.name}</span>
        {clue && (
          <span style={{ fontSize: "max(11px, calc(var(--stage) * 1.4))" }}>
            · {clue.category} for <span className="font-value text-gold">{state.stake}</span>
          </span>
        )}
        <span className="ml-auto capitalize" style={{ fontSize: "max(11px, calc(var(--stage) * 1.4))" }}>
          {phase === "final" ? `final · ${state.final?.stage ?? ""}` : phase}
        </span>
      </footer>
    </div>
  )
}

/** Keep cards big: few players means few columns, not a row of slivers. */
const columnsFor = (n) => (n <= 2 ? Math.max(n, 1) : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5)

function StatusStrip({ state, holderName, now }) {
  const { buzzer, phase, final } = state
  const answer = useCountdown(state.timer?.kind === "answer" ? state.timer.endsAt : null, now)

  let text = "Waiting"
  let tone = "border-edge text-faint"

  if (phase === "final") {
    const stage = final?.stage
    const waiting = (final?.players ?? []).filter((p) => !p.wagered).length
    text =
      stage === "wager"
        ? `Final · placing bets${waiting ? ` · ${waiting} to go` : " · all in"}`
        : stage === "clue"
          ? "Final · writing"
          : "Final · turning them over"
    tone = "border-gold-deep/60 text-gold"
  } else if (state.paused) {
    text = "Paused"
    tone = "border-gold-deep/60 text-gold"
  } else if (holderName) {
    text = `${holderName} is in`
    tone = "border-live bg-live/10 text-live"
  } else if (buzzer.armed) {
    text = "Buzzers open"
    tone = "border-good bg-good/10 text-good"
  } else if (phase === "clue") {
    text = "Buzzers locked"
    tone = "border-edge text-muted"
  } else if (phase === "lobby") {
    text = "Waiting to start"
  } else if (phase === "ended") {
    text = "Final scores"
    tone = "border-gold-deep/60 text-gold"
  } else if (phase === "board") {
    text = "Picking a clue"
  }

  return (
    <div
      className={`flex items-center justify-center gap-[2vmin] rounded-[1vmin] border px-[2vmin] py-[1vmin] font-display uppercase tracking-[0.25em] transition-colors ${tone}`}
      style={{ fontSize: "max(12px, calc(var(--stage) * 1.9))" }}
    >
      {text}
      {answer != null && <span className="font-value tabular-nums">{(answer / 1000).toFixed(1)}s</span>}
    </div>
  )
}

function SideCard({ row, rank, buzzer, onCall, callEndsAt, dimmed, final, wager, now }) {
  const holds = holdsBuzz(row, buzzer)
  const spent = isSpent(row, buzzer)
  const race = raceOf(row, buzzer)

  return (
    <div
      style={row.color && !holds && !onCall && !spent ? { borderColor: `${row.color}66` } : undefined}
      className={`relative flex min-h-0 flex-col justify-center overflow-hidden rounded-[1.2vmin] border px-[1.6vmin] py-[1.2vmin] transition-all duration-300 ${
        holds
          ? "border-live bg-live/15 shadow-[0_0_4vmin_rgba(255,207,61,0.2)]"
          : onCall
            ? "border-amethyst bg-royal/40"
            : spent
              ? "border-edge/50 bg-black/25 opacity-50"
              : "border-gold-dim/30 bg-gradient-to-b from-onyx/85 to-void/85"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      <div className="flex items-baseline gap-[1vmin]">
        <span className="font-value tabular-nums text-faint" style={{ fontSize: "max(10px, calc(var(--stage) * 1.4))" }}>
          {rank}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-display uppercase text-ink"
          style={{ fontSize: "max(13px, calc(var(--stage) * 2.4))", color: row.color ?? undefined }}
        >
          {row.name}
        </span>
        {!row.connected && <span className="h-[1vmin] w-[1vmin] shrink-0 rounded-full bg-faint" title="away" />}
      </div>

      {row.memberNames?.length > 0 && (
        <div className="truncate text-muted/70" style={{ fontSize: "max(8px, calc(var(--stage) * 1.1))" }}>
          {row.memberNames.join(" · ")}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-[1.5vmin]">
        <Rolling value={row.score} />
        {/* The call clock belongs on the side making it. As a full-screen
            overlay it hid every other score for thirty seconds, which is
            exactly when the room most wants to compare them. */}
        {onCall && <CallRing endsAt={callEndsAt} now={now} />}
      </div>

      <div className="flex flex-wrap items-center gap-[0.8vmin]" style={{ fontSize: "max(9px, calc(var(--stage) * 1.2))" }}>
        {(row.lifelines?.phone ?? 0) > 0 && <span className="text-gold-dim">☎ {row.lifelines.phone}</span>}
        {holds && <span className="text-live">buzzed{race ? ` +${race.behind}ms` : ""}</span>}
        {spent && !holds && <span className="text-faint">out this clue</span>}
        {onCall && <span className="text-amethyst">on the phone</span>}
        {wager != null && <span className="text-live">✦ wagered {wager}</span>}
        {/* In the final a bet is secret until the host turns it over, so this
            says only that one exists — the amount arrives with the reveal. */}
        {final?.wagered && <span className="text-gold">{final.wager != null ? `bet ${final.wager}` : "bet in"}</span>}
        {final?.answered && final.answer == null && <span className="text-good">written</span>}
        {final?.judged != null && <span className={final.judged ? "text-good" : "text-bad"}>{final.judged ? "correct" : "wrong"}</span>}
      </div>
    </div>
  )
}

/** Scores roll rather than snap — a jump reads as a glitch from across a room. */
function Rolling({ value }) {
  const [shown] = useRolling(value)
  return (
    <div
      className={`font-value leading-none tabular-nums ${shown < 0 ? "text-bad" : "text-gold brass-sm"}`}
      style={{ fontSize: "max(24px, calc(var(--stage) * 5))" }}
    >
      {shown}
    </div>
  )
}

/** The phone-a-friend clock, sized to sit beside a player's own score. */
function CallRing({ endsAt, now }) {
  const left = useCountdown(endsAt, now)
  if (left == null) return null
  const seconds = Math.ceil(left / 1000)
  const frac = Math.max(0, Math.min(1, left / 30_000))
  const r = 44
  const circ = 2 * Math.PI * r

  return (
    <span className="relative shrink-0" style={{ width: "max(38px, calc(var(--stage) * 5))", height: "max(38px, calc(var(--stage) * 5))" }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="rgba(0,0,0,0.35)" stroke="#2b2733" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={seconds <= 5 ? "#ff5f7a" : "#a86ce0"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-value tabular-nums ${seconds <= 5 ? "text-bad" : "text-amethyst"}`}
        style={{ fontSize: "max(13px, calc(var(--stage) * 1.8))" }}
      >
        {seconds}
      </span>
    </span>
  )
}

function Prompt() {
  const [value, setValue] = useState("")
  return (
    <Full>
      <form
        className="flex flex-col items-center gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) location.search = `?code=${value.trim().toUpperCase()}`
        }}
      >
        <BrandMark className="text-2xl" />
        <div className="label">scoreboard</div>
        <div className="flex gap-2">
          <input
            className="field w-40 text-center font-display text-2xl uppercase tracking-[0.3em]"
            maxLength={4}
            placeholder="CODE"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
          />
          <button className="btn btn-gold px-5">Go</button>
        </div>
      </form>
    </Full>
  )
}

function Full({ children }) {
  return (
    <div className="relative flex h-dvh items-center justify-center text-center text-muted">
      <Backdrop veins={5} glow={2} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
