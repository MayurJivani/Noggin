import { useId } from "react"

/**
 * The gold seam, as a component.
 *
 * The backdrop grows its veins procedurally because it has a whole wall to
 * fill. These are hand-drawn instead: a divider and a corner flourish get
 * looked at directly and at a fixed size, so a lucky seed is not good enough.
 *
 * Every instance mints its own gradient id — two of these on one page sharing
 * an id means the second one silently adopts the first one's fill.
 */

function GoldStops({ id, soft = false }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#7a5c1c" stopOpacity="0" />
      <stop offset="16%" stopColor="#c9922a" stopOpacity={soft ? 0.6 : 1} />
      <stop offset="48%" stopColor="#fdf0c8" />
      <stop offset="80%" stopColor="#c9922a" stopOpacity={soft ? 0.6 : 1} />
      <stop offset="100%" stopColor="#7a5c1c" stopOpacity="0" />
    </linearGradient>
  )
}

/**
 * A horizontal seam. Replaces `.rule-gold` where a straight line looks too
 * drawn — a section heading, the underline of the wordmark.
 *
 * `preserveAspectRatio="none"` lets it stretch to any width; the stroke keeps
 * its weight because `vector-effect` opts it out of that scaling.
 */
export function VeinLine({ className = "", height = 14, opacity = 1 }) {
  const id = useId()
  return (
    <svg viewBox="0 0 600 20" preserveAspectRatio="none" className={`w-full ${className}`} style={{ height }} aria-hidden="true">
      <defs>
        <GoldStops id={id} />
      </defs>
      <g fill="none" stroke={`url(#${id})`} vectorEffect="non-scaling-stroke" opacity={opacity}>
        <path d="M0 10 C 90 3, 150 16, 232 9 S 372 2, 448 13 S 536 7, 600 10" strokeWidth="1.5" />
        {/* A shorter seam running alongside, the way a real one splits. */}
        <path d="M96 12 C 168 18, 236 14, 300 16 S 404 12, 470 15" strokeWidth="0.8" opacity="0.55" />
      </g>
    </svg>
  )
}

/**
 * A seam curling into the top-right of a card. Decorative only — it sits behind
 * the content and never takes a pointer event.
 */
export function CornerVein({ className = "", flip = false }) {
  const id = useId()
  return (
    <svg
      viewBox="0 0 160 120"
      className={`pointer-events-none absolute right-0 top-0 h-28 w-40 overflow-visible ${className}`}
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdf0c8" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#c9922a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#7a5c1c" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id})`} strokeLinecap="round" vectorEffect="non-scaling-stroke">
        <path d="M160 8 C 118 14, 96 40, 64 52 S 16 74, -4 108" strokeWidth="1.4" />
        <path d="M138 2 C 112 26, 92 34, 70 66" strokeWidth="0.7" opacity="0.6" />
        <path d="M96 42 C 108 58, 104 74, 116 92" strokeWidth="0.6" opacity="0.45" />
      </g>
      <g fill={`url(#${id})`}>
        <circle cx="120" cy="20" r="1.6" opacity="0.7" />
        <circle cx="78" cy="52" r="1.1" opacity="0.5" />
        <circle cx="112" cy="86" r="0.9" opacity="0.4" />
      </g>
    </svg>
  )
}
