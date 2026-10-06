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

/** The Nitro splash — the one moment the board is allowed to shout. */
export function NitroSplash({ show }) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-void/70 backdrop-blur-sm">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(242,201,107,0.26),transparent_62%)] animate-flare" />
      <div className="text-center animate-slam">
        <div className="font-display leading-[0.9] brass" style={{ fontSize: "max(40px, calc(var(--stage) * 11))" }}>
          NOGGIN&rsquo;
        </div>
        <div className="font-display leading-[0.9] brass" style={{ fontSize: "max(40px, calc(var(--stage) * 11))" }}>
          NITRO
        </div>
      </div>
    </div>
  )
}

/**
 * Phone a Friend: a ring that drains, plus whose call it is.
 *
 * Docked in a corner rather than laid over the room, which is what this was: a
 * full-bleed `inset-0` veil with a blur behind it, covering the one thing
 * everybody needed to be looking at. A lifeline is thirty seconds of *reading
 * the clue to somebody*, so the clue has to stay readable — by the player
 * phoning, by the friend being read to, and by the room following along. The
 * same argument `TimerRing` is parked in a corner for, and the same props, so
 * the two clocks appear in the same place and the eye learns one spot. They
 * never collide: `TimerRing` draws nothing for a `lifeline` timer.
 *
 * @param {object} props
 * @param {string} [props.className] – where it sits. Default is the big
 *   screen's top-right, which is free for the duration of a call.
 * @param {string} [props.size] – ring edge length, as any CSS length.
 */
export function LifelineOverlay({ lifeline, playerName, now, className = "absolute right-[2.5vmin] top-[2.5vmin] z-30", size = "13vmin" }) {
  const left = useCountdown(lifeline?.endsAt, now)
  if (!lifeline) return null

  // Granted but not dialled through yet — see `grantLifeline`. The ring sits
  // full, so what is on screen is "thirty seconds, not yet spent".
  const waiting = !lifeline.endsAt
  const total = (lifeline.seconds ?? 30) * 1000
  const frac = waiting ? 1 : Math.max(0, Math.min(1, (left ?? 0) / total))
  const r = 46
  const circ = 2 * Math.PI * r
  const seconds = waiting ? (lifeline.seconds ?? 30) : Math.ceil((left ?? 0) / 1000)
  const low = !waiting && seconds <= 5

  return (
    <div className={`pointer-events-none flex flex-col items-center gap-[0.6vmin] rounded-[1.2vmin] border border-amethyst bg-void/85 px-[1.4vmin] py-[1vmin] ${className}`}>
      <div className="font-display uppercase leading-none tracking-[0.25em] text-amethyst" style={{ fontSize: "max(8px, calc(var(--stage) * 1.1))" }}>
        ☎ {playerName}
      </div>

      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#2b2733" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={low ? "#ff5f7a" : waiting ? "#8a7bb8" : "#f2c96b"}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - frac)}
            style={{ transition: "stroke-dashoffset 120ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`font-value tabular-nums ${low ? "text-bad" : waiting ? "text-amethyst" : "text-gold"}`}
            style={{ fontSize: "max(13px, 3.8vmin)" }}
          >
            {seconds}
          </span>
        </div>
      </div>

      {/* Said in words, because a full ring and a running one look alike at a
          glance and the room should not have to guess whether time is going. */}
      {waiting && (
        <div className="font-display uppercase leading-none tracking-[0.2em] text-faint" style={{ fontSize: "max(7px, calc(var(--stage) * 0.95))" }}>
          dialling
        </div>
      )}
    </div>
  )
}

/** The host's read/discussion clock, parked top-right so it never covers a clue. */
/**
 * @param {object} props
 * @param {string} [props.className] – where it sits. The default is the big
 *   screen's top-right corner, which on a phone is occupied by the player's own
 *   name and score; that is the only reason this is a prop.
 * @param {string} [props.size] – edge length, as any CSS length.
 */
export function TimerRing({ timer, now, className = "absolute right-[2.5vmin] top-[2.5vmin] z-20", size = "11vmin" }) {
  const left = useCountdown(timer?.endsAt, now)
  if (!timer || timer.kind === "lifeline" || left == null) return null

  const frac = Math.max(0, Math.min(1, left / (timer.duration * 1000)))
  const seconds = Math.ceil(left / 1000)
  const r = 44
  const circ = 2 * Math.PI * r

  return (
    <div className={className} style={{ width: size, height: size }}>
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
        <span className={`font-value tabular-nums ${seconds <= 5 ? "text-bad" : "text-gold"}`} style={{ fontSize: "max(13px, 3.6vmin)" }}>
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
