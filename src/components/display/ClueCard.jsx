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

    /*
      The card starts invisible and is revealed by the animation, which makes
      the animation load-bearing — and `requestAnimationFrame` does not run in a
      page the browser has stopped compositing. On a display window sitting
      behind another, the clue therefore never appeared at all. This is the net:
      whatever happens to the animation, the clue is on screen shortly.
    */
    const net = setTimeout(() => setFlown(true), 700)
    const done = () => clearTimeout(net)

    if (!node || !origin || (typeof document !== "undefined" && document.hidden)) {
      // No known tile (a reload mid-clue), or nobody watching the transition:
      // just be there.
      setFlown(true)
      return done
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
    return done
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
        Nothing here scrolls, because nobody scrolls a projector.

        The words and the answer take the height they need; the picture takes
        whatever is left. Sizing media in `vh` was the mistake — it knows the
        height of the *window*, not the height of the gap between a three-line
        clue and a revealed answer, so a tall image on a wordy clue ran off the
        bottom of the card with no way to see it. Here the media sits in a
        `flex-1 min-h-0` box and is `object-contain` inside it, which means it
        is exactly as big as the space actually left over, always.
      */}
      <div
        className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-[2vmin] overflow-hidden px-[6vmin] py-[2vmin] ${
          flown ? "" : "opacity-0"
        }`}
      >
        {clue.prompt && (
          <p
            className="max-w-[46ch] shrink-0 text-center font-display leading-[1.16] text-ink animate-rise"
            style={{ fontSize: `max(18px, calc(var(--stage) * ${Math.max(2.1, 5.4 - clue.prompt.length / 90)}))`, animationDelay: "220ms" }}
          >
            {clue.prompt}
          </p>
        )}

        {clue.media && (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <Media media={clue.media} />
          </div>
        )}

        {revealed && (
          <div className="flex shrink-0 flex-col items-center gap-[1.2vmin] animate-slam">
            <VeinLine className="w-[36vmin]" height={14} />
            <div className="label" style={{ letterSpacing: "0.4em" }}>
              Answer
            </div>
            <p className="max-w-[40ch] text-center font-display leading-tight text-gold brass" style={{ fontSize: "max(20px, calc(var(--stage) * 3.6))" }}>
              {clue.answer}
            </p>
            {clue.answerMedia && (
              <div className="flex max-h-[22vh] min-h-0 items-center justify-center">
                <Media media={clue.answerMedia} />
              </div>
            )}
          </div>
        )}
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

/**
 * Whatever is attached to the clue, sized by its container rather than by the
 * viewport. `max-h-full max-w-full object-contain` is the whole trick: the box
 * above has already worked out how much room is going spare.
 */
function Media({ media }) {
  const src = resolveMediaUrl(media.url)

  if (media.kind === "image") {
    return (
      <img
        src={src}
        alt={media.alt ?? ""}
        className="max-h-full max-w-full rounded-[1vmin] border border-gold-deep/30 object-contain shadow-xl shadow-black/50 animate-rise"
        style={{ animationDelay: "300ms" }}
      />
    )
  }
  if (media.kind === "video") return <VideoClue src={src} />
  return <AudioClue src={src} label={media.alt} />
}

/**
 * A clip, on the big screen.
 *
 * Autoplayed with sound, which browsers refuse until the page has been
 * interacted with — the display already catches one click anywhere to arm the
 * audio cues, and that same gesture is what lets this play. Controls stay on so
 * the host can scrub or replay a clip the room asks to see again.
 */
function VideoClue({ src }) {
  const el = useRef(null)

  useEffect(() => {
    const node = el.current
    if (!node) return
    node.play().catch(() => {
      // Blocked: the controls are right there, and muting to force it through
      // would be worse than a clip the host has to press play on.
    })
    return () => node.pause()
  }, [src])

  return (
    <video
      ref={el}
      src={src}
      controls
      playsInline
      className="max-h-full max-w-full rounded-[1vmin] border border-gold-deep/30 bg-black object-contain shadow-xl shadow-black/50 animate-rise"
      style={{ animationDelay: "300ms" }}
    />
  )
}

/**
 * Audio clues need a visual — a room staring at a blank screen while a song
 * plays has no idea whether anything is happening. The bars are decorative and
 * deliberately not tied to real analysis: one <audio> element feeding an
 * analyser across reloads is more failure than the effect is worth.
 */
function AudioClue({ src, label }) {
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
    <div className="flex max-h-full flex-col items-center justify-center gap-[2vmin] animate-rise" style={{ animationDelay: "260ms" }}>
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
