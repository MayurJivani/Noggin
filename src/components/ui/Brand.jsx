import { useId } from "react"

/**
 * The wordmark: NOGGIN with the first O struck as a gold ring.
 *
 * The ring is a ring, not a filled ellipse with a slot cut in it — the earlier
 * version read as a lens or a closed eye, especially tilted, and collided with
 * the N beside it. It is also near-circular rather than tall, because Righteous
 * has round bowls and an oval O in that setting looks like a mistake rather
 * than a choice. A single seam crosses it, so the letter is made of the same
 * material as the backdrop.
 *
 * `.brass` goes on each run of glyphs rather than the container: it fills text
 * with a clipped gradient, and a clipped background does not reach into a
 * transformed or blockified child, which leaves that child invisible.
 */
export function Brand({ size = 44, sub = null, className = "" }) {
  return (
    <div className={`select-none ${className}`}>
      <div className="flex items-center leading-none font-display" style={{ fontSize: size, letterSpacing: "0.005em" }}>
        <span className="brass">N</span>
        <RingO size={size} />
        {/* A right single quote, not a straight typewriter tick — this is
            display type, and the straight one reads as a stray mark at size. */}
        <span className="brass">GGIN’</span>
      </div>
      {sub && (
        <div className="label mt-2" style={{ letterSpacing: "0.3em" }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/**
 * The ring, as a single even-odd path.
 *
 * Two subpaths — outer bowl, inner counter — so the hole is a genuine hole.
 * Filling the counter with the page colour was close enough on the homepage and
 * wrong everywhere else: over a card, over the marble, over anything but flat
 * black it showed as a dark disc sitting in the letter.
 */
const RING = "M9,50a41,43 0 1,0 82,0a41,43 0 1,0 -82,0 M30,50a20,22 0 1,0 40,0a20,22 0 1,0 -40,0"

/** Seams across the ring: along it, across it, and a hairline. */
const SEAMS = [
  "M-10 74 C 22 62, 34 44, 62 30 S 96 8, 118 -6",
  "M-6 30 C 22 44, 42 50, 60 66 S 90 88, 106 100",
  "M26 100 C 38 78, 44 62, 60 42 S 82 16, 92 2",
]

function RingO({ size }) {
  const id = useId()
  // Righteous sits its bowls a touch above the line box centre, so the ring is
  // nudged up to share an optical centre with the letters either side.
  const box = size * 0.82

  return (
    <span className="relative inline-block animate-float align-middle" style={{ width: box * 0.86, height: size }}>
      <svg
        viewBox="0 0 100 100"
        width={box}
        height={box}
        className="absolute left-1/2 top-1/2"
        style={{ transform: "translate(-50%, -56%) rotate(-12deg)", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={`${id}-face`} x1="0.15" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#fdf0c8" />
            <stop offset="34%" stopColor="#f2c96b" />
            <stop offset="62%" stopColor="#d9a63c" />
            <stop offset="100%" stopColor="#a8781f" />
          </linearGradient>
          <linearGradient id={`${id}-seam`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8a6516" stopOpacity="0" />
            <stop offset="38%" stopColor="#fdf0c8" />
            <stop offset="72%" stopColor="#c9922a" />
            <stop offset="100%" stopColor="#8a6516" stopOpacity="0" />
          </linearGradient>

          {/* Shadow shaped by the ring itself, so nothing darkens the counter. */}
          <filter id={`${id}-lift`} x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="2" dy="5" stdDeviation="3.5" floodColor="#000" floodOpacity="0.65" />
          </filter>

          {/* Seams stop at both edges of the metal — the outer rim and the hole. */}
          <clipPath id={`${id}-metal`}>
            <path d={RING} clipRule="evenodd" />
          </clipPath>
        </defs>

        <g filter={`url(#${id}-lift)`}>
          <path d={RING} fillRule="evenodd" fill={`url(#${id}-face)`} />

          <g clipPath={`url(#${id}-metal)`}>
            {/* Veining, the same material as the backdrop: one seam running the
                length of the ring, one crossing it, one hairline — with gold
                running down them. A seam inside something is exactly where the
                river reading works; the long dividers ripple in place instead. */}
            <path d={SEAMS[0]} fill="none" stroke={`url(#${id}-seam)`} strokeWidth="2.4" opacity="0.85" />
            <path d={SEAMS[1]} fill="none" stroke={`url(#${id}-seam)`} strokeWidth="1.5" opacity="0.6" />
            <path d={SEAMS[2]} fill="none" stroke={`url(#${id}-seam)`} strokeWidth="0.9" opacity="0.45" />
            <g fill="none" stroke="#fff6dd" strokeLinecap="round">
              <path d={SEAMS[0]} pathLength="100" strokeWidth="2.6" opacity="0.9" className="vein-flow" />
              <path d={SEAMS[1]} pathLength="100" strokeWidth="1.6" opacity="0.55" className="vein-flow vein-flow-slow" />
              <path d={SEAMS[2]} pathLength="100" strokeWidth="1" opacity="0.4" className="vein-flow vein-flow-fast" />
            </g>

            {/* Specular arc, upper left, where the gradient is already lightest. */}
            <path d="M20 36 A 39 41 0 0 1 50 8" fill="none" stroke="#fff6dd" strokeWidth="3.5" strokeLinecap="round" opacity="0.45" />

            {/* Bevel — a dark inner edge stops the ring reading as flat paint.
                Clipped, so the half that would fall into the hole is discarded. */}
            <ellipse cx="50" cy="50" rx="20" ry="22" fill="none" stroke="#6b4d10" strokeWidth="4" opacity="0.85" />
          </g>

          <path d={RING} fillRule="evenodd" fill="none" stroke="#7a5c1c" strokeWidth="0.9" opacity="0.75" />
        </g>
      </svg>
    </span>
  )
}

/** Small lockup for headers and phone chrome. */
export function BrandMark({ className = "" }) {
  return (
    <span className={`font-display tracking-wide ${className}`}>
      <span className="brass-sm">N</span>
      <span className="brass-sm inline-block rotate-[-12deg] mx-[0.04em]">O</span>
      <span className="brass-sm">GGIN’</span>
    </span>
  )
}
