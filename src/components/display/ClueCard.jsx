import { useEffect, useRef, useState } from "react"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { useCountdown } from "../../lib/useRoom"
import { CornerVein, VeinLine } from "../ui/Vein"

/**
 * A clue, filling the screen.
 *
 * It animates *out of the tile it came from* rather than fading in from
 * nowhere: `origin` is the tile's on-screen rect, so the card starts life
 * exactly on top of it and grows. That one detail is most of what makes the
 * board feel like a physical thing rather than a slideshow.
 */
export function ClueCard({ clue, revealed, stake, origin, wagerName, timer, now }) {
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
        {clue.nitro && (
          <span className="rounded-full border border-live/60 px-[1.4vmin] py-[0.4vmin] font-display text-live animate-glow" style={{ fontSize: "max(9px, calc(var(--stage) * 1))" }}>
            ✦ NOGGIN&rsquo; NITRO{wagerName ? ` · ${wagerName}` : ""}
          </span>
        )}
        <ClueClock timer={timer} now={now} />
      </div>

      {/*
        `m-auto` on the inner column rather than `justify-center` on the outer
        one. Both centre while there is room, but a centred *flex* child cannot
        be scrolled back to once it overflows — its top goes above the scroll
        origin — and the card clips. With auto margins the content simply stops
        being centred when it stops fitting, and the overflow is reachable.
      */}
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-[6vmin] py-[3vmin] ${flown ? "" : "opacity-0"}`}>
        <div className="m-auto flex w-full flex-col items-center gap-[2.5vmin]">
          {clue.prompt && (
            <p
              className="max-w-[46ch] shrink-0 text-center font-display leading-[1.16] text-ink animate-rise"
              style={{ fontSize: `max(20px, calc(var(--stage) * ${Math.max(2.1, 5.4 - clue.prompt.length / 90)}))`, animationDelay: "220ms" }}
            >
              {clue.prompt}
            </p>
          )}
          {/* The picture yields to the answer. A tall image plus a revealed
              answer is exactly the case that used to push the answer off the
              bottom of the card, and of the two the answer is the one the room
              is waiting for. */}
          {clue.media && <Media media={clue.media} revealed={revealed} />}

          {revealed && (
            <div className="mt-[1vmin] flex shrink-0 flex-col items-center gap-[1.5vmin] animate-slam">
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
    </div>
  )
}

/**
 * The clock, inline in the clue's own header.
 *
 * It used to float in the top-right corner of the stage, which is exactly where
 * the clue card puts its value — so a running timer sat on top of the points.
 * Living in the same flex row means they can never overlap, whatever the
 * screen.
 *
 * Ringed, because sitting beside the value it was two gold numerals in the same
 * face and the room had no way to tell which was the clock. The ring drains as
 * well as encircles: from the back of a room the falling arc reads before the
 * digits do.
 */
function ClueClock({ timer, now }) {
  const left = useCountdown(timer && timer.kind !== "lifeline" ? timer.endsAt : null, now ?? (() => Date.now()))
  if (left == null) return null

  const seconds = Math.ceil(left / 1000)
  const total = (timer.duration || 1) * 1000
  const frac = Math.max(0, Math.min(1, left / total))
  const r = 44
  const circ = 2 * Math.PI * r
  const urgent = seconds <= 5

  return (
    <span
      className="relative ml-[1.5vmin] shrink-0"
      style={{ width: "max(44px, calc(var(--stage) * 5.6))", height: "max(44px, calc(var(--stage) * 5.6))" }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="rgba(0,0,0,0.35)" stroke="rgba(122,92,28,0.45)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={urgent ? "#ff5f7a" : "#f2c96b"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-value tabular-nums ${urgent ? "text-bad animate-glow" : "text-gold"}`}
        style={{ fontSize: "max(15px, calc(var(--stage) * 2.1))" }}
      >
        {seconds}
      </span>
    </span>
  )
}

function Media({ media, compact = false, revealed = false }) {
  const src = resolveMediaUrl(media.url)

  if (media.kind === "image") {
    return (
      <img
        src={src}
        alt={media.alt ?? ""}
        className="min-h-0 shrink rounded-[1vmin] border border-gold-deep/30 object-contain shadow-xl shadow-black/50 transition-all duration-500 animate-rise"
        style={{ maxHeight: compact ? "24vh" : revealed ? "30vh" : "46vh", animationDelay: "300ms" }}
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
