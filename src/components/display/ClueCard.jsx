import { useEffect, useRef, useState } from "react"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { CornerVein, VeinLine } from "../ui/Vein"

/**
 * A clue, filling the screen.
 *
 * It animates *out of the tile it came from* rather than fading in from
 * nowhere: `origin` is the tile's on-screen rect, so the card starts life
 * exactly on top of it and grows. That one detail is most of what makes the
 * board feel like a physical thing rather than a slideshow.
 */
export function ClueCard({ clue, revealed, stake, origin, wagerName }) {
  const el = useRef(null)
  const [flown, setFlown] = useState(false)

  useEffect(() => {
    setFlown(false)
    const node = el.current
    if (!node || !origin) {
      // No known tile (a reload mid-clue): just rise into place.
      requestAnimationFrame(() => setFlown(true))
      return
    }
    const to = node.getBoundingClientRect()
    const sx = origin.width / to.width
    const sy = origin.height / to.height
    node.style.transformOrigin = "top left"
    node.style.transform = `translate(${origin.left - to.left}px, ${origin.top - to.top}px) scale(${sx}, ${sy})`
    node.style.opacity = "0.85"
    // Two frames: one to commit the start state, one to animate away from it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        node.style.transition = "transform 520ms cubic-bezier(0.16, 0.9, 0.2, 1), opacity 260ms ease-out"
        node.style.transform = "none"
        node.style.opacity = "1"
        setFlown(true)
      }),
    )
  }, [clue?.id, origin])

  if (!clue) return null

  return (
    <div
      ref={el}
      className="absolute inset-[2vmin] flex flex-col overflow-hidden rounded-[1.2vmin] border border-gold-deep/45 bg-gradient-to-b from-onyx/96 to-void/98 shadow-2xl shadow-black/60"
    >
      <CornerVein className="opacity-45" />
      <div className="relative flex items-center gap-[1.5vmin] border-b border-gold-deep/25 px-[3vmin] py-[1.6vmin]">
        <span className="font-display uppercase tracking-[0.14em] text-gold/85" style={{ fontSize: "max(12px, calc(var(--stage) * 1.7))" }}>
          {clue.category}
        </span>
        <span className="ml-auto font-value tabular-nums text-gold brass-sm" style={{ fontSize: "max(20px, calc(var(--stage) * 3))" }}>
          {stake}
        </span>
        {clue.dailyDouble && (
          <span className="rounded-full border border-live/60 px-[1.4vmin] py-[0.4vmin] font-display text-live animate-glow" style={{ fontSize: "max(9px, calc(var(--stage) * 1))" }}>
            ✦ DAILY DOUBLE{wagerName ? ` · ${wagerName}` : ""}
          </span>
        )}
      </div>

      <div className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-[2.5vmin] px-[6vmin] py-[3vmin] ${flown ? "" : "opacity-0"}`}>
        {clue.prompt && (
          <p
            className="max-w-[46ch] text-center font-display leading-[1.16] text-ink animate-rise"
            style={{ fontSize: `max(20px, calc(var(--stage) * ${Math.max(2.1, 5.4 - clue.prompt.length / 90)}))`, animationDelay: "220ms" }}
          >
            {clue.prompt}
          </p>
        )}
        {clue.media && <Media media={clue.media} />}

        {revealed && (
          <div className="mt-[1vmin] flex flex-col items-center gap-[1.5vmin] animate-slam">
            <VeinLine className="w-[36vmin]" height={16} />
            <div className="label" style={{ letterSpacing: "0.4em" }}>
              Answer
            </div>
            <p className="max-w-[40ch] text-center font-display leading-tight text-gold brass" style={{ fontSize: "max(22px, calc(var(--stage) * 4))" }}>
              {clue.answer}
            </p>
            {clue.answerMedia && <Media media={clue.answerMedia} compact />}
          </div>
        )}
      </div>
    </div>
  )
}

function Media({ media, compact = false }) {
  const src = resolveMediaUrl(media.url)

  if (media.kind === "image") {
    return (
      <img
        src={src}
        alt={media.alt ?? ""}
        className="rounded-[1vmin] border border-gold-deep/30 object-contain shadow-xl shadow-black/50 animate-rise"
        style={{ maxHeight: compact ? "24vh" : "46vh", animationDelay: "300ms" }}
      />
    )
  }
  return <AudioClue src={src} label={media.alt} compact={compact} />
}

/**
 * Audio clues need a visual — a room staring at a blank screen while a song
 * plays has no idea whether anything is happening. The bars are decorative and
 * deliberately not tied to real analysis: one <audio> element feeding an
 * analyser across reloads is more failure than the effect is worth.
 */
function AudioClue({ src, label, compact }) {
  const audio = useRef(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = audio.current
    if (!el) return
    // Autoplay gets refused until the display has had a click; the play button
    // below is the fallback, and the host can always hit it.
    el.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    )
    return () => el.pause()
  }, [src])

  return (
    <div className={`flex flex-col items-center gap-[2vmin] animate-rise ${compact ? "scale-75" : ""}`} style={{ animationDelay: "260ms" }}>
      <audio ref={audio} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <div className="flex h-[12vmin] items-end gap-[0.8vmin]">
        {Array.from({ length: 13 }).map((_, i) => (
          <span
            key={i}
            className="w-[1.4vmin] rounded-full bg-gradient-to-t from-gold-deep to-gold"
            style={{
              height: `${20 + Math.abs(Math.sin(i * 1.7)) * 80}%`,
              opacity: playing ? 1 : 0.3,
              animation: playing ? `glow ${0.6 + (i % 5) * 0.17}s ease-in-out ${i * 0.06}s infinite alternate` : "none",
            }}
          />
        ))}
      </div>
      <button
        className="rounded-full border border-gold-deep/50 px-[2.5vmin] py-[0.9vmin] font-display text-gold"
        style={{ fontSize: "max(11px, calc(var(--stage) * 1.2))" }}
        onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
      >
        {playing ? "❚❚ pause" : "▶ play"} {label ? <span className="ml-2 text-[0.75em] text-muted">{label}</span> : null}
      </button>
    </div>
  )
}
