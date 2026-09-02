import { useCallback, useEffect, useRef, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

const PINNED = "noggin.podium"

/**
 * One player's podium.
 *
 * The screen that stands in front of a contestant: their name banded across the
 * top, their score filling the middle, and nothing else competing with it. Put
 * one on a tablet or spare monitor at each seat.
 *
 * Everything else this screen knows how to say — buzzed in, on the phone, what
 * they staked — is said *on the score*, by lighting the whole panel, because
 * from the far side of a room a badge is invisible and a colour is not.
 *
 * Read-only, and joins as a viewer, so it is subject to the same redaction as
 * the big screen: a blind final wager stays blind here too.
 */
export function PodiumApp() {
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()
  const [code] = useState(() => (params.get("code") ?? "").toUpperCase())
  // A booth tablet must come back to the same player after a reload — nobody
  // wants to re-pick five podiums because the wifi blinked.
  const [pick, setPick] = useState(() => params.get("name") ?? localStorage.getItem(`${PINNED}.${code}`) ?? "")
  const [error, setError] = useState(null)
  const { state, connected } = useRoom({ role: "display", code, onError: setError })
  const now = useCallback(() => Date.now(), [])

  useEffect(() => {
    if (code && pick) localStorage.setItem(`${PINNED}.${code}`, pick)
  }, [code, pick])

  if (!code) return <Frame><CodeForm /></Frame>
  if (error) return <Frame><span className="text-muted">{error.message}</span></Frame>
  if (!state) return <Frame><span className="text-faint">{connected ? "Joining…" : "Looking for the room…"}</span></Frame>

  const me = state.players.find((p) => p.name.toLowerCase() === pick.trim().toLowerCase())
  if (!me) return <Frame><Picker players={state.players} onPick={setPick} /></Frame>

  const holds = state.buzzer.winner === me.id
  const spent = state.buzzer.spent.includes(me.id)
  const onCall = state.lifeline?.playerId === me.id
  const wager = state.wager?.playerId === me.id ? state.wager.amount : null
  const final = state.final?.players?.find((f) => f.id === me.id)

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <Backdrop veins={6} glow={3} />

      {/*
        The whole panel is the indicator. A contestant looking at their own
        podium sees the colour before they read anything on it, which is the
        point — they need to know they are in before they start talking.
      */}
      <div
        className={`relative z-10 m-[2vmin] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2vmin] border-[0.5vmin] transition-all duration-300 ${
          holds
            ? "border-live bg-live/12 shadow-[0_0_10vmin_rgba(255,207,61,0.28)]"
            : onCall
              ? "border-amethyst bg-royal/45"
              : spent
                ? "border-edge bg-black/40"
                : "border-gold-deep/50 bg-gradient-to-b from-onyx/90 to-void/95"
        }`}
      >
        <div className="shrink-0 px-[3vmin] pt-[2.5vmin] text-center">
          <div
            className="truncate font-display uppercase leading-none text-ink"
            style={{ fontSize: "max(22px, calc(var(--stage) * 5.5))", letterSpacing: "0.04em" }}
          >
            {me.name}
          </div>
          <VeinLine className="mx-auto mt-[1.5vmin] w-[80%]" height={16} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[1.5vmin] px-[3vmin]">
          <Score value={me.score} />

          {/* One line, and only when there is something to say. */}
          <StatusLine
            holds={holds}
            spent={spent}
            onCall={onCall}
            callEndsAt={onCall ? state.lifeline.endsAt : null}
            wager={wager}
            final={final}
            finalStage={state.final?.stage}
            phase={state.phase}
            armed={state.buzzer.armed}
            now={now}
          />
        </div>

        <div className="flex shrink-0 items-center justify-center gap-[1.5vmin] pb-[2.5vmin] opacity-70">
          <BrandMark className="text-[max(11px,calc(var(--stage)*1.6))]" />
          <span className="label">{state.code}</span>
          {!connected && <span className="h-[1vmin] w-[1vmin] rounded-full bg-bad animate-glow" title="reconnecting" />}
        </div>
      </div>

      <button
        className="absolute bottom-[1vmin] right-[1.5vmin] z-20 text-[0.7rem] text-faint/60 transition-colors hover:text-muted"
        onClick={() => setPick("")}
      >
        change player
      </button>
    </div>
  )
}

/** The number, rolling. It is the whole screen, so it gets the whole screen. */
function Score({ value }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef(0)

  useEffect(() => {
    if (value === shown) return
    const start = performance.now()
    const a = from.current
    const b = value
    const dur = Math.min(1100, 300 + Math.abs(b - a) * 0.5)
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur)
      setShown(Math.round(a + (b - a) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf.current = requestAnimationFrame(step)
      else from.current = b
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value])

  const moving = shown !== value
  return (
    <div
      className={`font-value leading-[0.85] tabular-nums ${shown < 0 ? "text-bad" : "text-gold"} ${moving ? "" : "brass"}`}
      style={{ fontSize: "max(56px, calc(var(--stage) * 16))" }}
    >
      {shown}
    </div>
  )
}

function StatusLine({ holds, spent, onCall, callEndsAt, wager, final, finalStage, phase, armed, now }) {
  const left = useCountdown(callEndsAt, now)

  if (onCall) {
    const seconds = Math.ceil((left ?? 0) / 1000)
    return (
      <Line tone="text-amethyst">
        ☎ Phone a friend
        <span className={`ml-[1.5vmin] font-value tabular-nums ${seconds <= 5 ? "text-bad" : "text-amethyst"}`}>{seconds}</span>
      </Line>
    )
  }
  if (holds) return <Line tone="text-live">You're in — answer</Line>
  if (wager != null) return <Line tone="text-live">✦ Wagered {wager}</Line>
  if (spent) return <Line tone="text-faint">Out this clue</Line>

  if (phase === "final" && final) {
    if (finalStage === "wager") return <Line tone="text-gold">{final.wagered ? "Bet placed" : "Place your bet"}</Line>
    if (finalStage === "clue") return <Line tone="text-gold">{final.answered ? "Answer locked" : "Writing…"}</Line>
    if (final.judged != null) return <Line tone={final.judged ? "text-good" : "text-bad"}>{final.judged ? "Correct" : "Wrong"}</Line>
    return <Line tone="text-gold">Final</Line>
  }

  if (armed) return <Line tone="text-good">Buzzers open</Line>
  return null
}

const Line = ({ tone, children }) => (
  <div
    className={`flex items-center font-display uppercase tracking-[0.25em] ${tone}`}
    style={{ fontSize: "max(12px, calc(var(--stage) * 2))" }}
  >
    {children}
  </div>
)

function Picker({ players, onPick }) {
  return (
    <div className="w-full max-w-sm text-center">
      <div className="label mb-3">Which podium is this?</div>
      {players.length === 0 && <div className="text-sm text-faint">Nobody has joined this room yet.</div>}
      <div className="flex flex-col gap-2">
        {players.map((p) => (
          <button key={p.id} className="btn py-3 text-base" onClick={() => onPick(p.name)}>
            {p.name}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">This screen remembers your choice.</p>
    </div>
  )
}

function CodeForm() {
  const [value, setValue] = useState("")
  return (
    <form
      className="flex flex-col items-center gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) location.search = `?code=${value.trim().toUpperCase()}`
      }}
    >
      <BrandMark className="text-2xl" />
      <div className="label">podium</div>
      <div className="flex gap-2">
        <input
          className="field w-40 text-center font-display text-2xl uppercase tracking-[0.3em]"
          maxLength={4}
          placeholder="CODE"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
        />
        <button className="btn btn-gold px-5">Go</button>
      </div>
    </form>
  )
}

function Frame({ children }) {
  return (
    <div className="relative flex h-dvh items-center justify-center px-6 text-center">
      <Backdrop veins={5} glow={2} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
