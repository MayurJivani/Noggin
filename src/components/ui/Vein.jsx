import { useId, useSyncExternalStore } from "react"

/**
 * The gold seam, as a component.
 *
 * The backdrop grows its veins procedurally because it has a whole wall to
 * fill. These are shaped instead: a divider and a corner flourish get looked at
 * directly and at a fixed size, so a lucky seed is not good enough.
 *
 * The divider ripples **in place** — a standing wave, not a travelling one.
 * Each harmonic keeps a fixed shape along x and oscillates in time, so crests
 * rise and fall where they are instead of marching off the end. An envelope
 * pins the amplitude to zero at both ends, which anchors the line like a
 * plucked string rather than letting its tips flap.
 *
 * The frames are precomputed and handed to SVG's own `d` animation: no rAF
 * loop, no JS per frame, and it loops forever by construction.
 *
 * Every instance mints its own gradient id — two of these on one page sharing
 * an id means the second one silently adopts the first one's fill.
 */

const SPAN = 600
const MID = 10
const FRAMES = 12

/** `[cycles across the span, amplitude, spatial phase, temporal phase]` */
const MAIN_HARMONICS = [
  [2, 3.6, 0.0, 0.0],
  [3, 1.6, 1.1, 1.9],
  [5, 0.8, 2.3, 3.4]
]
const BRANCH_HARMONICS = [
  [2, 2.4, 0.6, 1.2],
  [4, 1.2, 2.0, 2.8]
]

/**
 * One loop of a standing wave, as a list of `d` strings.
 *
 * Every frame is sampled identically, so the shapes morph cleanly into one
 * another — SVG interpolates `d` point by point and mismatched geometry makes
 * it give up and snap instead.
 */
function standingWave(harmonics) {
  const frames = []
  for (let f = 0; f < FRAMES; f++) {
    const wt = (f / FRAMES) * Math.PI * 2
    const pts = []
    for (let x = 0; x <= SPAN; x += 8) {
      const t = (x / SPAN) * Math.PI * 2
      // Anchored at both ends, fullest in the middle.
      const envelope = Math.sin((Math.PI * x) / SPAN)
      let y = MID
      for (const [cycles, amp, spatial, temporal] of harmonics) {
        y += envelope * amp * Math.sin(cycles * t + spatial) * Math.cos(wt + temporal)
      }
      pts.push(`${x},${y.toFixed(2)}`)
    }
    frames.push(`M${pts.join(" L")}`)
  }
  // Back to the first frame, so the cycle closes without a seam.
  frames.push(frames[0])
  return frames
}

const MAIN_FRAMES = standingWave(MAIN_HARMONICS)
const BRANCH_FRAMES = standingWave(BRANCH_HARMONICS)

/**
 * SMIL ignores `prefers-reduced-motion` — the CSS rule that flattens every
 * other animation in the app cannot reach it — so the animation element simply
 * is not rendered for anyone who asked for less movement.
 */
const REDUCED = "(prefers-reduced-motion: reduce)"
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED)
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  )
}

function Ripple({ frames, dur, still }) {
  if (still) return null
  return <animate attributeName="d" values={frames.join(";")} dur={`${dur}s`} repeatCount="indefinite" calcMode="linear" />
}

/**
 * A horizontal seam, rippling in place. Replaces `.rule-gold` where a straight
 * line looks too drawn — a section heading, the underline of the wordmark.
 *
 * `preserveAspectRatio="none"` lets it stretch to any width; the stroke keeps
 * its weight because `vector-effect` opts it out of that scaling.
 */
export function VeinLine({ className = "", height = 14, opacity = 1, flow = true, speed = 9 }) {
  const id = useId()
  const still = usePrefersReducedMotion() || !flow

  return (
    <svg viewBox="0 0 600 20" preserveAspectRatio="none" className={`w-full ${className}`} style={{ height }} aria-hidden="true">
      <defs>
        {/* Pinned to the viewBox, so the soft ends stay put as the wave moves. */}
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={SPAN} y2="0">
          <stop offset="0%" stopColor="#7a5c1c" stopOpacity="0" />
          <stop offset="16%" stopColor="#c9922a" />
          <stop offset="48%" stopColor="#fdf0c8" />
          <stop offset="80%" stopColor="#c9922a" />
          <stop offset="100%" stopColor="#7a5c1c" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g fill="none" stroke={`url(#${id})`} vectorEffect="non-scaling-stroke" opacity={opacity}>
        <path d={MAIN_FRAMES[0]} strokeWidth="1.5">
          <Ripple frames={MAIN_FRAMES} dur={speed} still={still} />
        </path>
        {/* A second seam on a different beat, so the two drift apart and back. */}
        <path d={BRANCH_FRAMES[0]} strokeWidth="0.8" opacity="0.55">
          <Ripple frames={BRANCH_FRAMES} dur={speed * 1.6} still={still} />
        </path>
      </g>
    </svg>
  )
}

const CORNER = ["M160 8 C 118 14, 96 40, 64 52 S 16 74, -4 108", "M138 2 C 112 26, 92 34, 70 66", "M96 42 C 108 58, 104 74, 116 92"]

/**
 * A seam curling into the top-right of a card. Decorative only — it sits behind
 * the content and never takes a pointer event.
 *
 * A curl has no span to stand a wave on, so the gold runs *down* it instead —
 * a river finding its channel. That reading only works on a short seam inside
 * something; the long dividers ripple in place, or a page of them all flowing
 * the same way starts to look like a row of progress bars.
 */
export function CornerVein({ className = "", flip = false, flow = true }) {
  const id = useId()
  const still = usePrefersReducedMotion() || !flow
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
        <path d={CORNER[0]} strokeWidth="1.4" />
        <path d={CORNER[1]} strokeWidth="0.7" opacity="0.6" />
        <path d={CORNER[2]} strokeWidth="0.6" opacity="0.45" />
      </g>

      {/* The river: a bright length running down the seam it is laid over. */}
      {!still && (
        <g fill="none" stroke="#fff6dd" strokeLinecap="round" vectorEffect="non-scaling-stroke">
          <path d={CORNER[0]} pathLength="100" strokeWidth="1.8" opacity="0.8" className="vein-flow" />
          <path d={CORNER[1]} pathLength="100" strokeWidth="1" opacity="0.45" className="vein-flow vein-flow-slow" />
          <path d={CORNER[2]} pathLength="100" strokeWidth="0.9" opacity="0.35" className="vein-flow vein-flow-fast" />
        </g>
      )}

      <g fill={`url(#${id})`} stroke="none">
        <circle cx="120" cy="20" r="1.6" opacity="0.7" />
        <circle cx="78" cy="52" r="1.1" opacity="0.5" />
        <circle cx="112" cy="86" r="0.9" opacity="0.4" />
      </g>
    </svg>
  )
}
