import { useEffect, useRef, useState } from "react"

/**
 * A score that counts to its new value instead of jumping to it.
 *
 * A number that snaps from 400 to 1200 reads as a glitch from twenty feet away;
 * one that rolls reads as a win. Three screens wanted this and had three copies
 * of it, which is how the bug below survived in all of them.
 *
 * **The animation is the decoration; arriving is the job.**
 * `requestAnimationFrame` does not run in a page the browser has stopped
 * compositing — a projector window sitting behind another, a display tab on a
 * second desktop, a screen the OS has decided is occluded. In that state the
 * old version simply stopped: the relay said −400 and the scoreboard went on
 * showing 0, indefinitely, with nothing to indicate it was lying. So the target
 * is committed three ways — the last frame, a timer that outlives the
 * animation, and immediately if the page is already hidden when the value
 * arrives.
 *
 * Returns `[shown, moving]`; `moving` is for suppressing the brass sheen while
 * the digits are changing, since the effect smears at speed.
 */
/**
 * A font size for a score that fits the space it is given.
 *
 * The scoreboards size their numbers off the viewport, which is right for "0"
 * and wrong for "-12400": on a five-column podium wall at 1920 the latter came
 * out 402px wide in a 370px panel and was quietly clipped — a scoreboard
 * showing "-1240" is worse than one showing nothing, because it is believable.
 *
 * So longer numbers get proportionally smaller. Three characters is the
 * reference width; a minus sign counts, since it is what usually tips a score
 * over the edge. The floor stops a runaway total from vanishing.
 */
export function scoreSize(value, stages, floorPx) {
  const len = String(value ?? 0).length
  const shrink = Math.max(0.45, Math.min(1, 3.5 / Math.max(3.5, len)))
  return `max(${floorPx}px, calc(var(--stage) * ${(stages * shrink).toFixed(2)}))`
}

export function useRolling(value) {
  const [shown, setShown] = useState(value)
  /** What is on screen right now — so an interrupted roll resumes from there. */
  const cur = useRef(value)
  const raf = useRef(0)
  const settle = useRef(0)

  useEffect(() => {
    const a = cur.current
    const b = value
    if (a === b) return

    const set = (n) => {
      cur.current = n
      setShown(n)
    }

    // Nobody is looking. Be right rather than pretty.
    if (typeof document !== "undefined" && document.hidden) {
      set(b)
      return
    }

    const dur = Math.min(900, 260 + Math.abs(b - a) * 0.45)
    const start = performance.now()

    const step = (t) => {
      const k = Math.min(1, (t - start) / dur)
      // Ease-out: fast enough to feel like a reaction, slow enough to read.
      set(Math.round(a + (b - a) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)

    // The net. Timers are throttled in a background tab but they do fire,
    // which is exactly the case rAF does not cover.
    settle.current = setTimeout(() => set(b), dur + 250)

    return () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(settle.current)
    }
  }, [value])

  return [shown, shown !== value]
}
