import { useEffect, useState } from "react"
import { useCountdown } from "../../lib/useRoom"

/** Someone got there first. Sits over everything for a beat, then clears. */
export function BuzzOverlay({ name, verdict }) {
  if (!name) return null
  const tone =
    verdict === "correct"
      ? "border-good text-good shadow-good/30"
      : verdict === "wrong"
        ? "border-bad text-bad shadow-bad/30"
        : "border-live text-live shadow-live/30"

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className={`rounded-[2vmin] border-2 bg-void/85 px-[6vmin] py-[3vmin] shadow-2xl backdrop-blur-sm animate-slam ${tone} ${verdict === "wrong" ? "animate-shake" : ""}`}>
        {/* `gleam` rather than `brass` — the verdict colour has to survive, and
            brass paints every glyph gold regardless of what it is told. */}
        <div className="font-display leading-none gleam" style={{ fontSize: "max(30px, calc(var(--stage) * 7))" }}>
          {name}
        </div>
        {verdict && (
          <div className="mt-[1vmin] text-center font-display uppercase tracking-[0.4em]" style={{ fontSize: "max(12px, calc(var(--stage) * 1.6))" }}>
            {verdict === "correct" ? "correct" : "no"}
          </div>
        )}
      </div>
    </div>
  )
}

/** The daily double splash — the one moment the board is allowed to shout. */
export function DailyDoubleSplash({ show }) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-void/70 backdrop-blur-sm">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(242,201,107,0.26),transparent_62%)] animate-flare" />
      <div className="text-center animate-slam">
        <div className="font-display leading-[0.9] brass" style={{ fontSize: "max(40px, calc(var(--stage) * 11))" }}>
          DAILY
        </div>
        <div className="font-display leading-[0.9] brass" style={{ fontSize: "max(40px, calc(var(--stage) * 11))" }}>
          DOUBLE
        </div>
      </div>
    </div>
  )
}

/** Phone a Friend: a ring that drains, plus whose call it is. */
export function LifelineOverlay({ lifeline, playerName, now }) {
  const left = useCountdown(lifeline?.endsAt, now)
  if (!lifeline) return null

  const total = 30_000
  const frac = Math.max(0, Math.min(1, (left ?? 0) / total))
  const r = 46
  const circ = 2 * Math.PI * r
  const seconds = Math.ceil((left ?? 0) / 1000)

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-[2vmin] bg-void/80 backdrop-blur-sm">
      <div className="font-display uppercase tracking-[0.35em] text-amethyst" style={{ fontSize: "max(13px, calc(var(--stage) * 2))" }}>
        Phone a Friend
      </div>
      <div className="font-display text-gold brass" style={{ fontSize: "max(26px, calc(var(--stage) * 5))" }}>
        {playerName}
      </div>

      <div className="relative" style={{ width: "26vmin", height: "26vmin" }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#2b2733" strokeWidth="5" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={seconds <= 5 ? "#ff5f7a" : "#f2c96b"}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - frac)}
            style={{ transition: "stroke-dashoffset 120ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-value tabular-nums ${seconds <= 5 ? "text-bad" : "text-gold"}`} style={{ fontSize: "max(30px, calc(var(--stage) * 7))" }}>
            {seconds}
          </span>
        </div>
      </div>
    </div>
  )
}

/** The host's read/discussion clock, parked top-right so it never covers a clue. */
export function TimerRing({ timer, now }) {
  const left = useCountdown(timer?.endsAt, now)
  if (!timer || timer.kind === "lifeline" || left == null) return null

  const frac = Math.max(0, Math.min(1, left / (timer.duration * 1000)))
  const seconds = Math.ceil(left / 1000)
  const r = 44
  const circ = 2 * Math.PI * r

  return (
    <div className="absolute right-[2.5vmin] top-[2.5vmin] z-20" style={{ width: "11vmin", height: "11vmin" }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(43,39,51,0.8)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={seconds <= 5 ? "#ff5f7a" : "#f2c96b"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-value tabular-nums ${seconds <= 5 ? "text-bad" : "text-gold"}`} style={{ fontSize: "3.6vmin" }}>
          {seconds}
        </span>
      </div>
    </div>
  )
}

/** Wide "BUZZERS OPEN" bar. Peripheral vision is the point — nobody is reading it. */
export function BuzzerBanner({ armed }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => setVisible(armed), [armed])
  if (!visible) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[1vmin]">
      <div className="rounded-full border border-good/50 bg-good/12 px-[4vmin] py-[0.8vmin] font-display uppercase tracking-[0.4em] text-good animate-glow" style={{ fontSize: "max(10px, calc(var(--stage) * 1.3))" }}>
        Buzzers open
      </div>
    </div>
  )
}
