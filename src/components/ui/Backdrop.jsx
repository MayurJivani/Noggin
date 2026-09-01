import { useMemo } from "react"

/**
 * The stage behind everything: black marble with liquid gold running through it.
 *
 * The veins are grown rather than drawn — a wandering walk with the odd branch,
 * rendered twice (a wide blurred pass for the bloom, a thin bright pass for the
 * metal). Seeded, so a re-render never reshuffles the stone under the board.
 *
 * @param {object} props
 * @param {number} [props.veins] – how many gold seams. The big screen can carry
 *   a lot more of them than a phone, which mostly needs the black.
 * @param {number} [props.glow]  – purple pools lighting the stone from behind.
 */
export function Backdrop({ veins = 7, glow = 4, seed = 11, className = "" }) {
  const { seams, pools, flecks } = useMemo(() => build(veins, glow, seed), [veins, glow, seed])
  const id = useMemo(() => `bd${seed}-${veins}-${glow}`, [seed, veins, glow])

  return (
    <div className={`fixed inset-0 -z-10 overflow-hidden bg-void ${className}`} aria-hidden="true">
      {/* Stone. Layered radials in charcoal give the slab depth before any
          texture goes over the top of it. */}
      <div className="absolute inset-0 bg-[radial-gradient(115%_80%_at_25%_10%,#1e1c26_0%,#131219_38%,#0a090e_70%,#07060a_100%)]" />

      {/* The marbling itself: turbulence, smeared and knocked back until it
          reads as veined stone rather than television static. */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.55] mix-blend-screen" preserveAspectRatio="none">
        <filter id={`${id}-stone`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.02" numOctaves="4" seed={seed} />
          <feColorMatrix
            type="matrix"
            values="0.10 0 0 0 0.045
                    0.08 0 0 0 0.040
                    0.14 0 0 0 0.060
                    0    0 0 0 1"
          />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id}-stone)`} />
      </svg>

      {/* Purple, only ever as light behind the stone. */}
      <div className="absolute inset-0 animate-drift">
        {pools.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.r}vmax`,
              height: `${p.r}vmax`,
              transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, rgba(${p.tint}, ${p.a}) 0%, rgba(${p.tint}, ${p.a * 0.35}) 45%, transparent 70%)`,
              filter: `blur(${p.blur}px)`,
            }}
          />
        ))}
      </div>

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`${id}-vein`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8a6516" />
            <stop offset="22%" stopColor="#f2c96b" />
            <stop offset="45%" stopColor="#fdf0c8" />
            <stop offset="70%" stopColor="#d9a63c" />
            <stop offset="100%" stopColor="#7a5c1c" />
          </linearGradient>
          <filter id={`${id}-bloom`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Bloom pass — the light the gold throws onto the stone around it. */}
        <g fill="none" stroke={`url(#${id}-vein)`} filter={`url(#${id}-bloom)`} opacity="0.5" strokeLinecap="round">
          {seams.map((s, i) => (
            <path key={i} d={s.d} strokeWidth={s.w * 2.6} />
          ))}
        </g>

        {/* Metal pass. */}
        <g fill="none" stroke={`url(#${id}-vein)`} strokeLinecap="round">
          {seams.map((s, i) => (
            <path key={i} d={s.d} strokeWidth={s.w} opacity={s.o} />
          ))}
        </g>

        {/* Flecks — gold spatter tends to collect alongside a seam. */}
        <g fill={`url(#${id}-vein)`}>
          {flecks.map((f, i) => (
            <circle key={i} cx={f.x} cy={f.y} r={f.r} opacity={f.o} />
          ))}
        </g>
      </svg>

      {/* Vignette — keeps the middle of a projected image the brightest part. */}
      <div className="absolute inset-0 bg-[radial-gradient(125%_105%_at_50%_50%,transparent_42%,rgba(0,0,0,0.72)_100%)]" />
    </div>
  )
}

/** Deterministic noise, so the stone is the same every render. */
function rng(seed) {
  let s = (seed * 9301 + 49297) % 233280
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

/**
 * Walk a seam across the slab. Direction wanders by a small random amount each
 * step, which is what separates a crack in stone from a sine wave.
 */
function walk(r, start, angle, steps, stride) {
  const pts = [start]
  let [x, y] = start
  let a = angle
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * 0.9
    x += Math.cos(a) * stride * (0.6 + r() * 0.8)
    y += Math.sin(a) * stride * (0.6 + r() * 0.8)
    pts.push([x, y])
  }
  return pts
}

/** Catmull-Rom through the points, as cubic beziers — no visible corners. */
function smooth(pts) {
  if (pts.length < 2) return ""
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

function build(veinCount, glowCount, seed) {
  const r = rng(seed)
  const seams = []
  const flecks = []

  for (let i = 0; i < veinCount; i++) {
    // Start off-canvas so no seam appears to begin in mid-air.
    const edge = Math.floor(r() * 4)
    const t = r() * 1000
    const start = [
      [-60, t],
      [t, -60],
      [1060, t],
      [t, 1060],
    ][edge]
    const angle = [0, Math.PI / 2, Math.PI, -Math.PI / 2][edge] + (r() - 0.5) * 1.1

    const pts = walk(r, start, angle, 9 + Math.floor(r() * 6), 130)
    const w = 1.1 + r() * 1.9
    seams.push({ d: smooth(pts), w, o: 0.55 + r() * 0.45 })

    // Branches: a thinner seam peeling off part-way along the main one.
    const branches = Math.floor(r() * 3)
    for (let b = 0; b < branches; b++) {
      const at = pts[2 + Math.floor(r() * (pts.length - 3))]
      const child = walk(r, at, angle + (r() - 0.5) * 2.4, 4 + Math.floor(r() * 4), 90)
      seams.push({ d: smooth(child), w: w * (0.28 + r() * 0.3), o: 0.35 + r() * 0.35 })
    }

    // Spatter alongside the seam.
    for (let f = 0; f < 6; f++) {
      const at = pts[Math.floor(r() * pts.length)]
      flecks.push({
        x: at[0] + (r() - 0.5) * 90,
        y: at[1] + (r() - 0.5) * 90,
        r: 0.7 + r() * 2.4,
        o: 0.2 + r() * 0.6,
      })
    }
  }

  const pools = Array.from({ length: glowCount }, () => ({
    x: r() * 100,
    y: 10 + r() * 80,
    r: 30 + r() * 45,
    // Mostly royal purple, occasionally a warm one so the gold has a source.
    tint: r() > 0.72 ? "201, 146, 42" : "106, 47, 166",
    a: 0.1 + r() * 0.14,
    blur: 30 + r() * 50,
  }))

  return { seams, pools, flecks }
}
