import { useEffect, useRef, useState } from "react"

/**
 * Podiums along the bottom of the big screen.
 *
 * Scores roll rather than snap. A number that jumps from 400 to 1200 reads as a
 * glitch from twenty feet away; a number that counts up reads as a win.
 */
export function ScoreBar({ players, buzzer, lifeline }) {
  if (!players.length) return null
  return (
    <div className="flex shrink-0 items-end justify-center gap-[1vmin] px-[2vmin] pb-[1.5vmin]">
      {players.map((p) => {
        const holds = buzzer?.winner === p.id
        const spent = buzzer?.spent?.includes(p.id)
        const calling = lifeline?.playerId === p.id
        return (
          <div
            key={p.id}
            className={`min-w-[15vmin] flex-1 max-w-[26vmin] rounded-t-[1vmin] border-t border-x px-[1.2vmin] py-[1vmin] text-center transition-all duration-300 ${
              holds
                ? "border-live bg-live/15 -translate-y-[0.8vmin]"
                : calling
                  ? "border-amethyst bg-royal/40"
                  : spent
                    ? "border-edge/50 bg-black/20 opacity-45"
                    : "border-gold-deep/25 bg-gradient-to-b from-onyx/70 to-void/70"
            }`}
          >
            <div className="flex items-center justify-center gap-[0.6vmin]">
              {!p.connected && <span className="h-[0.8vmin] w-[0.8vmin] rounded-full bg-faint" title="away" />}
              <div className="truncate font-display uppercase tracking-wide text-ink/90" style={{ fontSize: "clamp(10px, 1.5vw, 24px)" }}>
                {p.name}
              </div>
              {(p.lifelines?.phone ?? 0) > 0 && <span className="text-gold-dim" style={{ fontSize: "clamp(8px, 1vw, 14px)" }}>☎</span>}
            </div>
            <Rolling value={p.score} />
          </div>
        )
      })}
    </div>
  )
}

function Rolling({ value }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef(0)

  useEffect(() => {
    if (value === shown) return
    const start = performance.now()
    const a = from.current
    const b = value
    const dur = Math.min(900, 260 + Math.abs(b - a) * 0.45)

    const step = (t) => {
      const k = Math.min(1, (t - start) / dur)
      // Ease-out: fast enough to feel like a reaction, slow enough to read.
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (b - a) * eased))
      if (k < 1) raf.current = requestAnimationFrame(step)
      else from.current = b
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value])

  const moving = shown !== value
  return (
    <div
      className={`font-value tabular-nums leading-none ${shown < 0 ? "text-bad" : "text-gold"} ${moving ? "" : "brass-sm"}`}
      style={{ fontSize: "clamp(20px, 3.4vw, 56px)" }}
    >
      {shown}
    </div>
  )
}
