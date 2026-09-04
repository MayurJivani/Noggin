import { useCallback, useEffect, useRef, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { unlock, sfx } from "../../lib/sfx"
import { readJson, removeStore, writeJson } from "../../lib/storage"
import { Backdrop } from "../ui/Backdrop"
import { Brand, BrandMark } from "../ui/Brand"
import { FinalPanel } from "./FinalPanel"
import { VeinLine } from "../ui/Vein"

const STORAGE = "noggin.player"

/**
 * The thing in everyone's hand.
 *
 * Rules it lives by: one thumb, no scrolling during a clue, and never a moment
 * where the player can't tell whether their press registered. Identity is kept
 * in localStorage so a locked screen or an accidental reload rejoins the same
 * seat with the same score instead of a fresh zero.
 */
export function PlayerApp() {
  const [saved] = useState(() => readJson(STORAGE, {}))
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()

  const [code, setCode] = useState((params.get("code") ?? saved.code ?? "").toUpperCase())
  const [name, setName] = useState(saved.name ?? "")
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState(null)
  /** Local echo so the button reacts on touch, not on the round trip. */
  const [pressed, setPressed] = useState(false)

  const onEffects = useCallback(
    (effects, next) => {
      const me = identityRef.current?.playerId
      for (const fx of effects) {
        if (fx.playerId && fx.playerId !== me) continue
        if (fx.kind === "buzz-in") {
          sfx.buzz()
          buzz(60)
        } else if (fx.kind === "buzz-early") {
          sfx.reject()
          buzz([25, 40, 25])
        } else if (fx.kind === "correct") {
          sfx.correct()
          buzz([40, 60, 90])
        } else if (fx.kind === "wrong") {
          sfx.wrong()
          buzz(200)
        }
      }
      void next
    },
    [],
  )

  const { state, connected, identity, send, rtt } = useRoom({
    role: "player",
    code,
    name,
    playerId: saved.playerId,
    enabled: joined,
    onEffects,
    onError: (e) => {
      setError(e)
      if (e.code === "no-room" || e.code === "kicked") setJoined(false)
    },
  })

  const identityRef = useRef(identity)
  identityRef.current = identity

  useEffect(() => {
    if (identity?.playerId) writeJson(STORAGE, { playerId: identity.playerId, name, code: identity.code })
  }, [identity, name])

  if (!joined || !state) {
    return (
      <Join
        code={code}
        setCode={setCode}
        name={name}
        setName={setName}
        error={error}
        connecting={joined && !state}
        onJoin={() => {
          unlock() // the join tap is the only guaranteed gesture we get
          setError(null)
          setJoined(true)
        }}
      />
    )
  }

  const me = state.players.find((p) => p.id === identity?.playerId)
  return (
    <Board
      state={state}
      me={me}
      connected={connected}
      rtt={rtt}
      send={send}
      pressed={pressed}
      setPressed={setPressed}
      onLeave={() => {
        removeStore(STORAGE)
        setJoined(false)
      }}
    />
  )
}

/** Haptics where they exist; a no-op everywhere else. */
const buzz = (pattern) => navigator.vibrate?.(pattern)

function Join({ code, setCode, name, setName, onJoin, error, connecting }) {
  const ready = code.trim().length >= 3 && name.trim().length > 0
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <Backdrop veins={5} glow={3} />
      <Brand size={52} sub="player" className="relative z-10" />
      <VeinLine className="relative z-10 -mt-3 w-56" height={16} />

      <form
        className="relative z-10 w-full max-w-xs space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onJoin()
        }}
      >
        <div>
          <div className="label mb-1">Room code</div>
          <input
            className="field text-center font-display text-3xl uppercase tracking-[0.3em]"
            maxLength={4}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            placeholder="CODE"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
        </div>
        <div>
          <div className="label mb-1">Your name</div>
          <input
            className="field text-center font-display text-xl"
            maxLength={16}
            placeholder="Who's playing?"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button className="btn btn-gold w-full py-3.5 text-base" disabled={!ready || connecting}>
          {connecting ? "Joining…" : "Join the game"}
        </button>
        {error && <div className="text-center text-[12px] text-bad">{error.message}</div>}
      </form>

      <p className="relative z-10 max-w-xs text-center text-[11px] text-faint">
        Keep this page open — the buzzer only works while you're here.
      </p>
    </div>
  )
}

function Board({ state, me, connected, rtt, send, pressed, setPressed, onLeave }) {
  const { phase, buzzer, clue, lifeline } = state
  const now = useCallback(() => Date.now(), [])

  /*
    Whether this phone shows the clue is the host's call, made from their desk.

    There is nothing to toggle here: with the setting off the relay does not
    send the words at all, so `clue.prompt` is simply empty. This only decides
    whether to draw the panel around what did arrive.
  */
  const showClue = clue && phase !== "board" && !!(clue.prompt || clue.media)

  const iHoldIt = buzzer.winner === me?.id
  const spent = buzzer.spent.includes(me?.id)
  const lockedUntil = buzzer.lockedUntil?.[me?.id] ?? 0
  const penalty = useCountdown(lockedUntil > Date.now() ? lockedUntil : null, now)
  const onPenalty = (penalty ?? 0) > 0

  const live = phase === "clue" && !!me && !state.paused
  const team = state.teams?.find((t) => t.members.includes(me?.id))

  /*
    The host is sound-checking. The button is live but the game is not: a press
    scores nothing and costs nothing, it just proves the path from this thumb to
    the relay works — which is the one thing nobody could confirm before the
    first clue.
  */
  const testing = !!state.check
  const heard = testing && !!state.check.hits?.[me?.id]

  const canBuzz = testing ? connected : live && buzzer.armed && !iHoldIt && !spent && !onPenalty && !lifeline

  // Keep the last state around for a beat so "wrong" doesn't vanish instantly.
  // With connections evened out the race stays open for a moment, so a press
  // is registered before it is decided. Saying so beats a button that has
  // visibly been pressed and a screen that says nothing happened.
  const settling = !!buzzer.settleUntil && buzzer.order?.some((e) => e.playerId === me?.id)

  const status = testing
    ? heard
      ? { text: "Buzzer works ✓", tone: "good" }
      : { text: "Buzzer test — press it", tone: "live" }
    : settling
    ? { text: "In — settling the race", tone: "live" }
    : state.paused
    ? { text: "Paused", tone: "dim" }
    : iHoldIt
    ? { text: "You're in — answer!", tone: "live" }
    : spent
      ? { text: team ? "Your team is out this clue" : "Out this clue", tone: "dim" }
      : onPenalty
        ? { text: "Too early", tone: "bad" }
        : lifeline
          ? { text: lifeline.playerId === me?.id ? "Your call — go" : "Someone's on the phone", tone: "amethyst" }
          : buzzer.armed
            ? { text: "Buzzers open", tone: "good" }
            : phase === "clue"
              ? { text: "Wait for it…", tone: "dim" }
              : phase === "lobby"
                ? { text: "Waiting to start", tone: "dim" }
                : phase === "ended"
                  ? { text: "That's the game", tone: "dim" }
                  : { text: "Watch the screen", tone: "dim" }

  const tone = {
    live: "text-live",
    good: "text-good",
    bad: "text-bad",
    amethyst: "text-amethyst",
    dim: "text-faint",
  }[status.tone]

  /**
   * A buzz is worth replaying for a moment if the socket happens to be down,
   * and worthless after that: arriving late would enter a race that is already
   * decided. Two seconds is about as long as a clue stays unanswered.
   */
  const BUZZ_TTL_MS = 2000

  const press = () => {
    if (testing) {
      setPressed(true)
      send("buzz", {}, BUZZ_TTL_MS)
      buzz(35)
      setTimeout(() => setPressed(false), 220)
      return
    }
    if (!canBuzz) {
      // Still send it. An early press is a real event the relay wants to see —
      // silently swallowing it would let a player mash with no consequence.
      if (live && !spent && !iHoldIt) send("buzz", {}, BUZZ_TTL_MS)
      buzz(20)
      return
    }
    setPressed(true)
    send("buzz", {}, BUZZ_TTL_MS)
    buzz(35)
    setTimeout(() => setPressed(false), 220)
  }

  /*
    The page is exactly the window, and nothing scrolls it.

    A phone that has to be scrolled to reach the buzzer is a phone that loses
    the race, and the one thing this screen must guarantee is that the button is
    under a thumb without anyone having to look for it. So the height is fixed,
    the header, clue and footer take only what they need, and the buzzer gets
    the rest — growing when the clue is turned off.
  */
  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-hidden">
      <Backdrop veins={4} glow={2} />

      <header className="relative z-10 flex shrink-0 items-center gap-2 px-4 pt-3">
        <BrandMark className="text-base" />
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} />
        <div className="ml-auto text-right">
          <div className="text-[13px] font-semibold leading-tight text-ink">{me?.name}</div>
          {/* On team night the number belongs to the side, so say whose it is —
              otherwise a player watches "their" score move when they did
              nothing and assumes the game is broken. */}
          {team && (
            <div className="text-[10px] uppercase tracking-[0.15em]" style={{ color: team.color }}>
              {team.name}
            </div>
          )}
          <div className={`font-value text-2xl leading-none ${(me?.score ?? 0) < 0 ? "text-bad" : "text-gold"}`}>{me?.score ?? 0}</div>
        </div>
      </header>

      <div className="relative z-10 shrink-0 px-4 pt-3">
        <div className={`text-center font-display uppercase tracking-[0.2em] ${connected ? tone : "text-bad"}`} style={{ fontSize: 13 }}>
          {connected ? status.text : "Reconnecting…"}
          {connected && onPenalty && <span className="ml-2 tabular-nums">{(penalty / 1000).toFixed(1)}s</span>}
        </div>
        {connected && rtt != null && (
          <div className="mt-0.5 text-center text-[0.65rem] text-faint">
            {rtt}ms to the host{rtt > 400 ? " · slow connection" : ""}
          </div>
        )}
      </div>

      {phase === "final" && <FinalPanel state={state} me={me} send={send} />}

      {/* The clue, quietly. Players look at the TV; this is for the person at
          the back who can't, and for audio clues they want in their own ear.
          Capped and scrolled *inside itself*, so a wordy clue never pushes the
          buzzer off the screen. */}
      {showClue && (
        <div className="relative z-10 mx-4 mt-3 max-h-[24vh] shrink overflow-y-auto rounded-xl border border-edge bg-black/25 px-3 py-2.5">
          <div className="label mb-1">
            {clue.category} · {state.stake}
          </div>
          {clue.prompt && <div className="font-display text-[15px] leading-snug text-ink">{clue.prompt}</div>}
          {clue.media?.kind === "image" && <img src={resolveMediaUrl(clue.media.url)} alt="" className="mt-2 max-h-40 w-full rounded-lg object-contain" />}
          {clue.media?.kind === "audio" && <audio src={resolveMediaUrl(clue.media.url)} controls className="mt-2 w-full" preload="none" />}
          {/* Not autoplayed. Everyone is looking at the TV; a dozen phones each
              playing the same clip a second out of step is the worst outcome. */}
          {clue.media?.kind === "video" && (
            <video src={resolveMediaUrl(clue.media.url)} controls playsInline preload="none" className="mt-2 max-h-40 w-full rounded-lg bg-black" />
          )}
          {state.revealed && clue.answer && (
            <div className="mt-2 border-t border-edge pt-2 font-display text-[15px] text-gold">{clue.answer}</div>
          )}
        </div>
      )}

      <div className={`relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 py-3 ${phase === "final" ? "hidden" : ""}`}>
        <BuzzerButton
          canBuzz={canBuzz && connected}
          iHoldIt={iHoldIt || heard}
          label={testing ? (heard ? "✓" : "TEST") : iHoldIt ? "GO" : "BUZZ"}
          disabled={!testing && (spent || onPenalty)}
          pressed={pressed}
          onPress={press}
          offline={!connected}
          roomy={!showClue}
        />
      </div>

      <footer className="relative z-10 shrink-0 space-y-2 px-4 pb-5">
        <button
          className={`btn w-full py-2.5 ${lifeline?.playerId === me?.id ? "btn-gold" : ""}`}
          disabled={(me?.lifelines?.phone ?? 0) <= 0 || !!lifeline}
          onClick={() => {
            send("lifeline:request", { lifeline: "phone" })
            buzz(30)
          }}
        >
          ☎ Phone a Friend
          <span className="ml-1.5 text-[11px] opacity-70">
            {lifeline?.playerId === me?.id ? "· on the line" : `· ${me?.lifelines?.phone ?? 0} left`}
          </span>
        </button>

        <div className="flex items-center justify-between text-[10px] text-faint">
          <span>room {state.code}</span>
          <button className="hover:text-muted" onClick={onLeave}>
            leave
          </button>
        </div>
      </footer>
    </div>
  )
}

/**
 * One enormous target. Sized to the viewport rather than a fixed pixel count
 * because the difference between a 5" phone and a 7" one is the difference
 * between winning the race and not.
 *
 * Pressing is bound to pointer *and* touch, with the first one to fire winning
 * and the other suppressed for a moment afterwards. `onPointerDown` alone looks
 * complete and is not: the in-app browsers people actually open a link in —
 * Instagram, Facebook, older Android WebViews — do not all implement Pointer
 * Events, and on those the buzzer simply did nothing. Falling back to `onClick`
 * would work but costs the ~300ms the fallback exists to avoid.
 */
function BuzzerButton({ canBuzz, iHoldIt, disabled, pressed, onPress, offline = false, roomy = false, label = "BUZZ" }) {
  const lastFire = useRef(0)

  /**
   * Whichever event arrives first wins; the duplicate is dropped.
   *
   * `preventDefault` is only attempted where it can actually work. React
   * registers `touchstart` passively, so calling it from the touch path does
   * nothing except log an error in Safari — scrolling and double-tap zoom are
   * already ruled out by `touch-action: none` on the button itself.
   */
  const fire = (e) => {
    if (e.type !== "touchstart" && e.cancelable) e.preventDefault()
    const now = Date.now()
    if (now - lastFire.current < 350) return
    lastFire.current = now
    onPress()
  }

  const face = iHoldIt
    ? "from-live to-[#c99411] border-live text-[#17110a]"
    : canBuzz
      ? "from-gold to-gold-deep border-gold text-[#17110a]"
      : disabled
        ? "from-[#17161f] to-[#0a090e] border-edge text-faint"
        : "from-[#241038] to-[#0d0b13] border-gold-dim/50 text-muted"

  /*
    Sized against the shorter of what the viewport allows and what the row it
    sits in has left, so the button can never be the thing that makes the page
    scroll. It takes the extra room back when the mirrored clue is turned off.
  */
  return (
    <button
      onPointerDown={fire}
      onTouchStart={fire}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative aspect-square ${
        roomy ? "w-[min(78vw,42vh,26rem)]" : "w-[min(72vw,30vh,20rem)]"
      } max-h-full select-none rounded-full border-4 bg-gradient-to-b shadow-2xl shadow-black/50 transition-transform duration-75 ${face} ${
        pressed ? "scale-95" : "active:scale-95"
      }`}
      style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}
    >
      {canBuzz && <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-gold animate-pulse-ring" />}

      {/*
        Gloss, clipped to the face.

        It was a flat white slab with a blur on it, and the blur had nothing to
        stop it: it smeared past the rim and washed the top third of the button
        into grey, which read as a rendering fault rather than a highlight. The
        wrapper clips it to the circle — and has to be a wrapper, because the
        pulse ring above scales to 1.35 and must not be clipped with it. Fading
        to nothing downward is what makes it look like light on a curve instead
        of paint.
      */}
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <span className="absolute inset-x-[14%] top-[4%] h-[30%] rounded-[50%] bg-gradient-to-b from-white/28 via-white/10 to-transparent blur-lg" />
      </span>
      <span className="relative font-display uppercase leading-none tracking-[0.08em]" style={{ fontSize: "clamp(28px, min(12vw, 7vh), 72px)" }}>
        {label}
      </span>
      {offline && (
        <span className="pointer-events-none absolute inset-x-0 bottom-[18%] text-center text-[0.7rem] uppercase tracking-widest text-bad">
          offline · press still counts
        </span>
      )}
    </button>
  )
}
