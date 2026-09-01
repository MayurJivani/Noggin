import { useCallback, useEffect, useRef, useState } from "react"
import { useRoom } from "../../lib/useRoom"
import { DEFAULT_SETTINGS, makeBoard } from "../../lib/board"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { displayUrl } from "../../lib/net"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"
import { JoinCard } from "../ui/JoinCard"
import { Builder } from "./Builder"
import { GameControl } from "./GameControl"

const STORAGE = "noggin.host"

/**
 * The host's dashboard, in two halves.
 *
 * **Build** is the quiz-writing half — it works with no players connected and
 * no game running. **Run** is the desk during the show. They're one page rather
 * than two because the host flips between them constantly on the night: a
 * typo in a clue is found at the worst possible moment, every time.
 */
export function AdminApp() {
  const [board, setBoard] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE + ".board") ?? "null")
      return cached ?? makeBoard()
    } catch {
      return makeBoard()
    }
  })
  const [roundIndex, setRoundIndex] = useState(0)
  const [tab, setTab] = useState("build")
  const [pushState, setPushState] = useState("idle")
  const [banner, setBanner] = useState(null)
  /** Players who have asked for a lifeline but not yet been granted one. */
  const [requests, setRequests] = useState([])

  /** Set by the relay when a save lands; drives the "saved ✓" acknowledgement. */
  const [savedAt, setSavedAt] = useState(null)

  // The home page links here with an explicit room (`?code=`) when resuming a
  // saved game. Failing that, rejoin the room we opened last time rather than
  // minting a new code — the old one is on a projector and in five phones.
  const [code, setCode] = useState(() => {
    const wanted = new URLSearchParams(location.search).get("code")?.toUpperCase()
    if (wanted) return wanted
    try {
      return localStorage.getItem(STORAGE + ".code") ?? ""
    } catch {
      return ""
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE + ".board", JSON.stringify(board))
  }, [board])

  // `?board=` opens a saved board straight into the builder.
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get("board")
    if (!wanted) return
    fetch(`${getRelayOrigin()}/boards/${encodeURIComponent(wanted)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.board && setBoard(j.board))
      .catch(() => {})
  }, [])

  const onEffects = useCallback((effects) => {
    for (const fx of effects) {
      if (fx.kind === "lifeline-request") setRequests((r) => (r.includes(fx.playerId) ? r : [...r, fx.playerId]))
      if (fx.kind === "lifeline-start" || fx.kind === "clue-close") setRequests([])
    }
  }, [])

  const { state, connected, identity, send } = useRoom({
    role: "host",
    code,
    onEffects,
    onError: (e) => setBanner(e.message),
    onMessage: useCallback((msg) => {
      if (msg.type === "saved") setSavedAt(msg.savedAt)
      if (msg.type === "forgotten") setSavedAt(null)
    }, []),
  })

  useEffect(() => {
    if (identity?.code && identity.code !== code) {
      setCode(identity.code)
      localStorage.setItem(STORAGE + ".code", identity.code)
    }
  }, [identity, code])

  /**
   * Resuming a saved game: adopt the room's board into the builder.
   *
   * Without this the builder would still be showing whatever was last edited on
   * this machine while the desk runs a different game — and the next Push would
   * overwrite the resumed board with it. Only fires when the room's board is
   * genuinely a different one, and only once.
   */
  const adopted = useRef(false)
  useEffect(() => {
    if (adopted.current || !state?.rawBoard) return
    if (state.rawBoard.id !== board.id) {
      setBoard(state.rawBoard)
      setRoundIndex(0)
    }
    adopted.current = true
  }, [state?.rawBoard, board.id])

  // Once a game is under way the desk is more useful than the builder.
  const started = state && state.phase !== "lobby"
  const jumped = useRef(false)
  useEffect(() => {
    if (started && !jumped.current) {
      jumped.current = true
      setTab("run")
    }
  }, [started])

  const push = async () => {
    setPushState("pushing")
    await fetch(`${getRelayOrigin()}/boards/${board.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...board, updatedAt: Date.now() }),
    }).catch(() => {})
    send("board:set", { board })
    setPushState("pushed")
    setTab("run")
    setTimeout(() => setPushState("idle"), 2500)
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <Backdrop veins={5} glow={3} />

      <header className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5">
        <BrandMark className="text-lg" />
        <span className="label">host desk</span>

        <div className="ml-2 flex rounded-lg border border-edge p-0.5">
          <TabButton on={tab === "build"} onClick={() => setTab("build")}>
            Build
          </TabButton>
          <TabButton on={tab === "run"} onClick={() => setTab("run")}>
            Run{state?.players.length ? ` · ${state.players.length}` : ""}
          </TabButton>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <ScreenLink code={state?.code} />
          <div className="text-right">
            <div className="label leading-none">Room</div>
            <div className="font-display brass-sm text-lg leading-tight tracking-[0.2em]">{state?.code ?? "…"}</div>
          </div>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} title={connected ? "connected" : "reconnecting"} />
        </div>
      </header>
      <div className="bulbs relative z-10 mx-4 shrink-0" />

      {banner && (
        <div className="relative z-10 mx-4 mt-2 flex items-center gap-2 rounded-lg border border-bad/50 bg-bad/10 px-3 py-1.5 text-[12px] text-bad">
          {banner}
          <button className="ml-auto" onClick={() => setBanner(null)}>
            ✕
          </button>
        </div>
      )}

      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {tab === "build" ? (
          <Builder
            board={board}
            setBoard={setBoard}
            roundIndex={roundIndex}
            setRoundIndex={setRoundIndex}
            settings={state?.settings ?? DEFAULT_SETTINGS}
            onSettings={(settings) => send("settings:set", { settings })}
            onPush={push}
            pushState={pushState}
          />
        ) : state ? (
          <GameControl state={state} send={send} now={() => Date.now()} requests={requests} code={state.code} savedAt={savedAt} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-faint">Opening the room…</div>
        )}
      </main>

      {tab === "run" && state?.phase === "lobby" && (
        <div className="pointer-events-auto absolute bottom-4 right-4 z-20 panel p-3">
          <JoinCard code={state.code} size={120} compact />
        </div>
      )}
    </div>
  )
}

const TabButton = ({ on, onClick, children }) => (
  <button
    onClick={onClick}
    className={`rounded-md px-3.5 py-1 font-body text-[12px] font-semibold transition-colors ${
      on ? "bg-gold text-[#17110a]" : "text-muted hover:text-ink"
    }`}
  >
    {children}
  </button>
)

/** One-click open of the big screen, on the LAN address a projector can use. */
function ScreenLink({ code }) {
  const [url, setUrl] = useState("")
  useEffect(() => {
    if (code) displayUrl(code).then(setUrl)
  }, [code])
  if (!url) return null
  return (
    <a className="btn text-[11px]" href={url} target="_blank" rel="noreferrer">
      Open big screen ↗
    </a>
  )
}
