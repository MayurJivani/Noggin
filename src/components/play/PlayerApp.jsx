import { useCallback, useEffect, useRef, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { unlock, sfx } from "../../lib/sfx"
import { Backdrop } from "../ui/Backdrop"
import { Brand, BrandMark } from "../ui/Brand"
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
  const [saved] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE) ?? "{}")
    } catch {
      return {}
    }
  })
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

  const { state, connected, identity, send } = useRoom({
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
    if (identity?.playerId) localStorage.setItem(STORAGE, JSON.stringify({ playerId: identity.playerId, name, code: identity.code }))
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
      send={send}
      pressed={pressed}
      setPressed={setPressed}
      onLeave={() => {
        localStorage.removeItem(STORAGE)
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

function Board({ state, me, connected, send, pressed, setPressed, onLeave }) {
  const { phase, buzzer, clue, lifeline } = state
  const now = useCallback(() => Date.now(), [])

  const iHoldIt = buzzer.winner === me?.id
  const spent = buzzer.spent.includes(me?.id)
  const lockedUntil = buzzer.lockedUntil?.[me?.id] ?? 0
  const penalty = useCountdown(lockedUntil > Date.now() ? lockedUntil : null, now)
  const onPenalty = (penalty ?? 0) > 0

  const live = phase === "clue" && !!me
  const canBuzz = live && buzzer.armed && !iHoldIt && !spent && !onPenalty && !lifeline

  // Keep the last state around for a beat so "wrong" doesn't vanish instantly.
  const status = iHoldIt
    ? { text: "You're in — answer!", tone: "live" }
    : spent
      ? { text: "Out this clue", tone: "dim" }
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

  const press = () => {
    if (!canBuzz) {
      // Still send it. An early press is a real event the relay wants to see —
      // silently swallowing it would let a player mash with no consequence.
      if (live && !spent && !iHoldIt) send("buzz")
      buzz(20)
      return
    }
    setPressed(true)
    send("buzz")
    buzz(35)
    setTimeout(() => setPressed(false), 220)
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl touch-none flex-col overflow-hidden">
      <Backdrop veins={4} glow={2} />

      <header className="relative z-10 flex items-center gap-2 px-4 pt-3">
        <BrandMark className="text-base" />
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} />
        <div className="ml-auto text-right">
          <div className="text-[13px] font-semibold leading-tight text-ink">{me?.name}</div>
          <div className={`font-value text-2xl leading-none ${(me?.score ?? 0) < 0 ? "text-bad" : "text-gold"}`}>{me?.score ?? 0}</div>
        </div>
      </header>

      <div className="relative z-10 px-4 pt-3">
        <div className={`text-center font-display uppercase tracking-[0.2em] ${tone}`} style={{ fontSize: 13 }}>
          {status.text}
          {onPenalty && <span className="ml-2 tabular-nums">{(penalty / 1000).toFixed(1)}s</span>}
        </div>
      </div>

      {/* The clue, quietly. Players look at the TV; this is for the person at
          the back who can't, and for audio clues they want in their own ear. */}
      {clue && phase !== "board" && (
        <div className="relative z-10 mx-4 mt-3 max-h-[26vh] overflow-y-auto rounded-xl border border-edge bg-black/25 px-3 py-2.5">
          <div className="label mb-1">
            {clue.category} · {state.stake}
          </div>
          {clue.prompt && <div className="font-display text-[15px] leading-snug text-ink">{clue.prompt}</div>}
          {clue.media?.kind === "image" && <img src={resolveMediaUrl(clue.media.url)} alt="" className="mt-2 max-h-40 w-full rounded-lg object-contain" />}
          {clue.media?.kind === "audio" && <audio src={resolveMediaUrl(clue.media.url)} controls className="mt-2 w-full" preload="none" />}
          {state.revealed && clue.answer && (
            <div className="mt-2 border-t border-edge pt-2 font-display text-[15px] text-gold">{clue.answer}</div>
          )}
        </div>
      )}

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-4">
        <BuzzerButton canBuzz={canBuzz} iHoldIt={iHoldIt} disabled={spent || onPenalty} pressed={pressed} onPress={press} />
      </div>

      <footer className="relative z-10 space-y-2 px-4 pb-5">
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
 */
function BuzzerButton({ canBuzz, iHoldIt, disabled, pressed, onPress }) {
  const face = iHoldIt
    ? "from-live to-[#c99411] border-live text-[#17110a]"
    : canBuzz
      ? "from-gold to-gold-deep border-gold text-[#17110a]"
      : disabled
        ? "from-[#17161f] to-[#0a090e] border-edge text-faint"
        : "from-[#241038] to-[#0d0b13] border-gold-dim/50 text-muted"

  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault()
        onPress()
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative aspect-square w-[min(78vw,44vh,26rem)] select-none rounded-full border-4 bg-gradient-to-b shadow-2xl shadow-black/50 transition-transform duration-75 ${face} ${
        pressed ? "scale-95" : "active:scale-95"
      }`}
      style={{ touchAction: "none", WebkitUserSelect: "none" }}
    >
      {canBuzz && <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-gold animate-pulse-ring" />}
      <span className="pointer-events-none absolute inset-x-[12%] top-[8%] h-[28%] rounded-full bg-white/18 blur-md" />
      <span className="relative font-display uppercase leading-none tracking-[0.08em]" style={{ fontSize: "clamp(28px, min(12vw, 7vh), 72px)" }}>
        {iHoldIt ? "GO" : "BUZZ"}
      </span>
    </button>
  )
}
