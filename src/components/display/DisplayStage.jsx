import { useCallback, useEffect, useRef, useState } from "react"
import { useRoom } from "../../lib/useRoom"
import { playForEffect, unlock, isUnlocked } from "../../lib/sfx"
import { Backdrop } from "../ui/Backdrop"
import { Brand, BrandMark } from "../ui/Brand"
import { JoinCard } from "../ui/JoinCard"
import { VeinLine } from "../ui/Vein"
import { BoardGrid } from "./BoardGrid"
import { FinalStage } from "./FinalStage"
import { ClueCard } from "./ClueCard"
import { ScoreBar } from "./ScoreBar"
import { BuzzerBanner, BuzzOverlay, NitroSplash, LifelineOverlay, TimerRing } from "./Overlays"

/**
 * The big screen. Read-only by design: it holds no game state of its own and
 * takes no input, so it can be reloaded at any point in the night and land
 * exactly where the room is.
 */
export function DisplayStage({ code: initialCode }) {
  const [code] = useState(() => initialCode || new URLSearchParams(location.search).get("code")?.toUpperCase() || "")
  const [error, setError] = useState(null)
  const [audioOn, setAudioOn] = useState(false)

  // Transient reactions. State says "who holds the buzzer"; this says "someone
  // *just* buzzed", which is what an animation actually needs.
  const [flash, setFlash] = useState(null)
  const [splash, setSplash] = useState(false)
  const flashTimer = useRef(0)

  /** Tile rects, so a clue can fly out of the tile it came from. */
  const cells = useRef(new Map())
  const cellRef = useCallback((ci, qi, el) => {
    if (el) cells.current.set(`${ci}:${qi}`, el)
    else cells.current.delete(`${ci}:${qi}`)
  }, [])
  const [origin, setOrigin] = useState(null)

  const onEffects = useCallback((effects, next) => {
    for (const fx of effects) {
      playForEffect(fx)

      if (fx.kind === "clue-open" || fx.kind === "nitro") {
        const el = cells.current.get(`${fx.catIndex}:${fx.clueIndex}`)
        setOrigin(el ? el.getBoundingClientRect() : null)
      }
      if (fx.kind === "nitro") {
        setSplash(true)
        setTimeout(() => setSplash(false), 2000)
      }
      if (fx.kind === "buzz-in" || fx.kind === "correct" || fx.kind === "wrong") {
        const name = next.players.find((p) => p.id === fx.playerId)?.name
        if (!name) continue
        clearTimeout(flashTimer.current)
        const verdict = fx.kind === "buzz-in" ? null : fx.kind
        setFlash({ name, verdict })
        flashTimer.current = setTimeout(() => setFlash(null), verdict ? 1400 : 1100)
      }
      if (fx.kind === "clue-close" || fx.kind === "round-start") setOrigin(null)
    }
  }, [])

  const { state, connected, send } = useRoom({ role: "display", code, onEffects, onError: setError })
  void send

  // Nothing on this page is clickable, so the audio gesture has to be caught
  // wherever it lands — one tap anywhere arms the cues for the night.
  useEffect(() => {
    const arm = () => {
      unlock()
      setAudioOn(isUnlocked())
    }
    window.addEventListener("pointerdown", arm)
    window.addEventListener("keydown", arm)
    return () => {
      window.removeEventListener("pointerdown", arm)
      window.removeEventListener("keydown", arm)
    }
  }, [])

  // A projector that sleeps mid-round is the worst failure mode there is.
  useEffect(() => {
    let lock
    navigator.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {})
    const reacquire = () => document.visibilityState === "visible" && navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {})
    document.addEventListener("visibilitychange", reacquire)
    return () => {
      document.removeEventListener("visibilitychange", reacquire)
      lock?.release?.().catch(() => {})
    }
  }, [])

  if (!code) return <CodePrompt />
  if (error) return <Fullscreen>{error.message}</Fullscreen>
  if (!state) return <Fullscreen>{connected ? "Joining…" : "Looking for the room…"}</Fullscreen>

  const { phase, board, clue, players, buzzer, timer, lifeline } = state
  const wagerName = state.wager?.playerId ? players.find((p) => p.id === state.wager.playerId)?.name : null

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <Backdrop veins={9} glow={4} />

      <header className="relative z-10 flex shrink-0 items-center gap-[2vmin] px-[2.5vmin] pt-[2vmin] pb-[1vmin]">
        <BrandMark className="text-[max(14px, calc(var(--stage) * 2))]" />
        <VeinLine className="hidden min-w-0 flex-1 sm:block" height={14} />
        <div className="font-display uppercase tracking-[0.2em] text-gold/80" style={{ fontSize: "max(10px, calc(var(--stage) * 1.4))" }}>
          {board.round?.name}
        </div>
        <VeinLine className="hidden min-w-0 flex-1 sm:block" height={14} />
        <div className="text-right">
          <div className="label leading-none">Room</div>
          <div className="font-display brass-sm leading-none tracking-[0.2em]" style={{ fontSize: "max(14px, calc(var(--stage) * 2))" }}>
            {state.code}
          </div>
        </div>
        {!connected && <span className="ml-2 h-2 w-2 rounded-full bg-bad animate-glow" title="reconnecting" />}
      </header>
      <div className="bulbs relative z-10 mx-[2.5vmin] shrink-0" />

      <main className="relative z-10 min-h-0 flex-1">
        {phase === "lobby" && <Lobby code={state.code} players={players} title={board.title} />}
        {phase === "final" && <FinalStage state={state} now={() => Date.now()} />}
        {phase === "intermission" && <Interlude title="Round cleared" players={players} sub={board.round?.name} />}
        {phase === "ended" && <Interlude title="Final scores" players={players} final />}

        {(phase === "board" || phase === "clue" || phase === "wager" || phase === "reveal") && (
          <div className="relative h-full w-full">
            <BoardGrid round={board.round} cellRef={cellRef} />
            {clue && phase !== "board" && (
              <ClueCard
                clue={clue}
                revealed={state.revealed}
                stake={state.stake}
                origin={origin}
                wagerName={wagerName}
                timer={timer}
                now={() => Date.now()}
              />
            )}
          </div>
        )}

        <NitroSplash show={splash} />
        <LifelineOverlay lifeline={lifeline} playerName={players.find((p) => p.id === lifeline?.playerId)?.name} now={() => Date.now()} />
        <BuzzOverlay name={flash?.name} verdict={flash?.verdict} />
        {!clue && <TimerRing timer={timer} now={() => Date.now()} />}
        <BuzzerBanner armed={buzzer.armed} />
      </main>

      {phase !== "lobby" && <ScoreBar players={players} buzzer={buzzer} lifeline={lifeline} />}

      {!audioOn && (
        <div className="pointer-events-none absolute bottom-[1vmin] left-1/2 z-40 -translate-x-1/2 rounded-full border border-edge bg-void/80 px-4 py-1.5 text-[11px] text-muted">
          click anywhere for sound
        </div>
      )}
    </div>
  )
}

function Lobby({ code, players, title }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin] px-[4vmin]">
      <Brand size={Math.min(120, Math.max(48, window.innerWidth / 12))} />
      <VeinLine className="w-[46vmin]" height={18} />
      <div className="text-center font-display text-gold/85" style={{ fontSize: "max(16px, calc(var(--stage) * 2.6))" }}>
        {title}
      </div>

      <JoinCard code={code} size={Math.round(Math.min(260, Math.max(150, window.innerWidth / 7)))} />

      <div className="flex max-w-[80vw] flex-wrap justify-center gap-[1.2vmin]">
        {players.map((p, i) => (
          <div
            key={p.id}
            className="rounded-full border border-gold-deep/40 bg-royal/40 px-[2.4vmin] py-[0.9vmin] font-display text-ink animate-tile-in"
            style={{ fontSize: "max(12px, calc(var(--stage) * 1.7))", animationDelay: `${i * 60}ms` }}
          >
            {p.name}
          </div>
        ))}
        {players.length === 0 && <div className="text-[13px] text-faint">nobody yet — scan to join</div>}
      </div>
    </div>
  )
}

function Interlude({ title, players, sub, final = false }) {
  const medal = ["#f2c96b", "#c0c0c8", "#c08a5a"]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin]">
      {sub && <div className="label" style={{ letterSpacing: "0.4em" }}>{sub}</div>}
      <div className="font-display text-gold brass" style={{ fontSize: "max(30px, calc(var(--stage) * 6))" }}>
        {title}
      </div>
      <VeinLine className="w-[40vmin]" height={18} />
      <div className="flex flex-col items-center gap-[1.4vmin]">
        {players.slice(0, 8).map((p, i) => (
          <div key={p.id} className="flex items-baseline gap-[2.5vmin] animate-rise" style={{ animationDelay: `${i * 110}ms` }}>
            <span className="font-value tabular-nums text-muted" style={{ fontSize: "max(14px, calc(var(--stage) * 2))" }}>
              {i + 1}
            </span>
            <span className="font-display" style={{ fontSize: "max(18px, calc(var(--stage) * 3.4))", color: final && i < 3 ? medal[i] : "var(--color-ink)" }}>
              {p.name}
            </span>
            <span className="font-value tabular-nums text-gold" style={{ fontSize: "max(18px, calc(var(--stage) * 3.4))" }}>
              {p.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CodePrompt() {
  const [value, setValue] = useState("")
  return (
    <Fullscreen>
      <div className="flex flex-col items-center gap-4">
        <Brand size={64} sub="big screen" />
        <p className="text-[13px] text-muted">Which room is this screen showing?</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) location.search = `?code=${value.trim().toUpperCase()}`
          }}
          className="flex gap-2"
        >
          <input
            className="field w-40 text-center font-display text-2xl uppercase tracking-[0.3em]"
            maxLength={4}
            placeholder="CODE"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
          />
          <button className="btn btn-gold px-5">Go</button>
        </form>
      </div>
    </Fullscreen>
  )
}

function Fullscreen({ children }) {
  return (
    <div className="relative flex h-dvh items-center justify-center text-center text-muted">
      <Backdrop veins={6} glow={3} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
