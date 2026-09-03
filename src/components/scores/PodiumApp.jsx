import { useCallback, useEffect, useRef, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

/**
 * Podiums: an individual scoreboard for each player.
 *
 * Two ways to run it, because there are two ways a room is set up:
 *
 * - **A screen each.** `?name=` pins one player, for the tablet standing in
 *   front of them.
 * - **One screen for all of them.** No name, and every player gets their own
 *   panel side by side — the same thing a row of lecterns shows, on a single
 *   monitor laid in front of the seats.
 *
 * The URL is the whole state. A booth tablet that reloads, or gets handed to
 * someone else, is doing what its address says rather than what it happens to
 * remember.
 *
 * Read-only, and joins as a viewer, so it is under the same redaction as the
 * big screen: it never learns an unplayed clue, and a blind final wager stays
 * blind here too.
 */
export function PodiumApp() {
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()
  const [code] = useState(() => (params.get("code") ?? "").toUpperCase())
  const only = (params.get("name") ?? "").trim().toLowerCase()
  const [error, setError] = useState(null)
  const { state, connected } = useRoom({ role: "display", code, onError: setError })
  const now = useCallback(() => Date.now(), [])

  if (!code) return <Frame><CodeForm /></Frame>
  if (error) return <Frame><span className="text-muted">{error.message}</span></Frame>
  if (!state) return <Frame><span className="text-faint">{connected ? "Joining…" : "Looking for the room…"}</span></Frame>

  const players = only ? state.players.filter((p) => p.name.toLowerCase() === only) : state.players

  if (only && !players.length) {
    return (
      <Frame>
        <div className="space-y-3">
          <div className="text-muted">Nobody in this room is called “{params.get("name")}”.</div>
          <a className="btn btn-gold" href={`/podium?code=${code}`}>
            Show every podium
          </a>
        </div>
      </Frame>
    )
  }

  if (!players.length) {
    return <Frame><span className="text-faint">Nobody has joined this room yet.</span></Frame>
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <Backdrop veins={6} glow={3} />

      <main className="relative z-10 min-h-0 flex-1 p-[1.5vmin]">
        <div
          className="grid h-full gap-[1.5vmin]"
          style={{ gridTemplateColumns: `repeat(${columnsFor(players.length)}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
        >
          {players.map((p) => (
            <Podium key={p.id} player={p} state={state} now={now} solo={!!only} code={code} />
          ))}
        </div>
      </main>

      <footer className="relative z-10 flex shrink-0 items-center justify-center gap-[2vmin] pb-[1.2vmin] opacity-70">
        <BrandMark className="text-[max(11px,calc(var(--stage)*1.5))]" />
        <span className="label">{state.code}</span>
        {!connected && <span className="h-[1vmin] w-[1vmin] rounded-full bg-bad animate-glow" title="reconnecting" />}
        {only && (
          <a className="text-[0.7rem] text-faint/70 transition-colors hover:text-muted" href={`/podium?code=${code}`}>
            all podiums
          </a>
        )}
      </footer>
    </div>
  )
}

/**
 * Panels stay tall rather than spreading into a row of slivers. Three across is
 * the shape of the thing being imitated, and a fourth player wraps rather than
 * halving everyone's width.
 */
const columnsFor = (n) => (n <= 1 ? 1 : n <= 2 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : 5)

function Podium({ player, state, now, solo, code }) {
  const holds = state.buzzer.winner === player.id
  const spent = state.buzzer.spent.includes(player.id)
  const onCall = state.lifeline?.playerId === player.id
  const wager = state.wager?.playerId === player.id ? state.wager.amount : null
  const final = state.final?.players?.find((f) => f.id === player.id)
  const dimmed = !!state.lifeline && !onCall

  /*
    The whole panel is the indicator. A contestant looking at their own podium
    sees the colour before they read anything on it, which is the point — they
    need to know they are in before they start talking.
  */
  const skin = holds
    ? "border-live bg-live/12 shadow-[0_0_8vmin_rgba(255,207,61,0.28)]"
    : onCall
      ? "border-amethyst bg-royal/45"
      : spent
        ? "border-edge bg-black/40"
        : "border-gold-deep/50 bg-gradient-to-b from-onyx/90 to-void/95"

  const body = (
    <>
      <div className="shrink-0 px-[2vmin] pt-[2vmin] text-center">
        <div
          className="truncate font-display uppercase leading-none text-ink"
          style={{ fontSize: `max(16px, calc(var(--stage) * ${solo ? 5.5 : 3.2}))`, letterSpacing: "0.04em" }}
        >
          {player.name}
        </div>
        <VeinLine className="mx-auto mt-[1.2vmin] w-[80%]" height={solo ? 16 : 12} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[1.2vmin] px-[1.5vmin]">
        <Score value={player.score} solo={solo} />
        <StatusLine
          holds={holds}
          spent={spent}
          onCall={onCall}
          callEndsAt={onCall ? state.lifeline.endsAt : null}
          wager={wager}
          final={final}
          finalStage={state.final?.stage}
          phase={state.phase}
          armed={state.buzzer.armed}
          solo={solo}
          now={now}
        />
      </div>

      <div className="flex shrink-0 items-center justify-center gap-[1vmin] pb-[1.5vmin]">
        {(player.lifelines?.phone ?? 0) > 0 && (
          <span className="text-gold-dim" style={{ fontSize: `max(9px, calc(var(--stage) * ${solo ? 1.5 : 1.1}))` }}>
            ☎ {player.lifelines.phone}
          </span>
        )}
        {!player.connected && (
          <span className="text-faint" style={{ fontSize: `max(9px, calc(var(--stage) * ${solo ? 1.5 : 1.1}))` }}>
            away
          </span>
        )}
      </div>
    </>
  )

  const shell = `relative flex min-h-0 flex-col overflow-hidden rounded-[1.5vmin] border-[0.4vmin] transition-all duration-300 ${skin} ${
    dimmed ? "opacity-40" : ""
  }`

  // On the wall each panel is a link to its own screen, so a booth tablet gets
  // an address it will still be showing after a reload.
  return solo ? (
    <div className={shell}>{body}</div>
  ) : (
    <a className={`${shell} hover:border-gold`} href={`/podium?code=${code}&name=${encodeURIComponent(player.name)}`} title={`Open ${player.name}'s own screen`}>
      {body}
    </a>
  )
}

/** The number, rolling. It is most of the panel, so it gets most of the panel. */
function Score({ value, solo }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef(0)

  useEffect(() => {
    if (value === shown) return
    const start = performance.now()
    const a = from.current
    const b = value
    const dur = Math.min(1100, 300 + Math.abs(b - a) * 0.5)
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur)
      setShown(Math.round(a + (b - a) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf.current = requestAnimationFrame(step)
      else from.current = b
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value])

  const moving = shown !== value
  return (
    <div
      className={`font-value leading-[0.85] tabular-nums ${shown < 0 ? "text-bad" : "text-gold"} ${moving ? "" : "brass"}`}
      style={{ fontSize: `max(${solo ? 56 : 34}px, calc(var(--stage) * ${solo ? 16 : 8}))` }}
    >
      {shown}
    </div>
  )
}

function StatusLine({ holds, spent, onCall, callEndsAt, wager, final, finalStage, phase, armed, solo, now }) {
  const left = useCountdown(callEndsAt, now)
  const size = { fontSize: `max(10px, calc(var(--stage) * ${solo ? 2 : 1.3}))` }

  if (onCall) {
    const seconds = Math.ceil((left ?? 0) / 1000)
    return (
      <Line tone="text-amethyst" size={size}>
        ☎ Phone a friend
        <span className={`ml-[1.2vmin] font-value tabular-nums ${seconds <= 5 ? "text-bad" : "text-amethyst"}`}>{seconds}</span>
      </Line>
    )
  }
  if (holds) return <Line tone="text-live" size={size}>You're in — answer</Line>
  if (wager != null) return <Line tone="text-live" size={size}>✦ Wagered {wager}</Line>
  if (spent) return <Line tone="text-faint" size={size}>Out this clue</Line>

  if (phase === "final" && final) {
    if (finalStage === "wager") return <Line tone="text-gold" size={size}>{final.wagered ? "Bet placed" : "Place your bet"}</Line>
    if (finalStage === "clue") return <Line tone="text-gold" size={size}>{final.answered ? "Answer locked" : "Writing…"}</Line>
    if (final.judged != null)
      return (
        <Line tone={final.judged ? "text-good" : "text-bad"} size={size}>
          {final.judged ? "Correct" : "Wrong"}
          {final.wager != null && ` · ${final.judged ? "+" : "−"}${final.wager}`}
        </Line>
      )
    return <Line tone="text-gold" size={size}>Final</Line>
  }

  if (armed) return <Line tone="text-good" size={size}>Buzzers open</Line>
  return null
}

const Line = ({ tone, size, children }) => (
  <div className={`flex items-center text-center font-display uppercase tracking-[0.22em] ${tone}`} style={size}>
    {children}
  </div>
)

function CodeForm() {
  const [value, setValue] = useState("")
  return (
    <form
      className="flex flex-col items-center gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) location.search = `?code=${value.trim().toUpperCase()}`
      }}
    >
      <BrandMark className="text-2xl" />
      <div className="label">podiums</div>
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
  )
}

function Frame({ children }) {
  return (
    <div className="relative flex h-dvh items-center justify-center px-6 text-center">
      <Backdrop veins={5} glow={2} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
