import { useCallback, useEffect, useRef, useState } from "react"
import { useRoom } from "../../lib/useRoom"
import { useAuth } from "../../lib/useAuth"
import { AuthLoading, SignIn } from "../auth/SignIn"
import { DEFAULT_SETTINGS, makeBoard } from "../../lib/board"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { displayUrl } from "../../lib/net"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"
import { JoinCard } from "../ui/JoinCard"
import { RoomSwitcher } from "./RoomSwitcher"
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
  const auth = useAuth()
  if (!auth.ready) return <AuthLoading />
  if (!auth.user) return <SignIn auth={auth} what="host a game" />
  return <HostDesk auth={auth} />
}

function HostDesk({ auth }) {
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
  /** The key the host hands to whoever is driving the controller tonight. */
  const [controllerKey, setControllerKey] = useState(null)
  /** Bumped whenever the set of rooms changes, so the switcher refetches. */
  const [roomsVersion, setRoomsVersion] = useState(0)

  // The home page links here with an explicit room (`?code=`) when resuming a
  // saved game. Failing that, rejoin the room we opened last time rather than
  // minting a new code — the old one is on a projector and in five phones.
  const [code, setCode] = useState(() => {
    const params = new URLSearchParams(location.search)
    if (params.get("new")) return ""
    const wanted = params.get("code")?.toUpperCase()
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
    fetch(`${getRelayOrigin()}/boards/${encodeURIComponent(wanted)}`, { credentials: "include" })
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
      if (msg.type === "controller-key") setControllerKey(msg.key)
      if (msg.type === "deleted") {
        // The room this desk was driving is gone. Drop the remembered code so
        // the next connection opens a fresh one instead of resurrecting it.
        localStorage.removeItem(STORAGE + ".code")
        setRoomsVersion((v) => v + 1)
        location.href = "/host"
      }
    }, []),
  })

  useEffect(() => {
    if (!identity?.code) return
    if (identity.code !== code) {
      setCode(identity.code)
      setRoomsVersion((v) => v + 1)
    }
    localStorage.setItem(STORAGE + ".code", identity.code)

    /*
      Take `?new=1` out of the address bar the moment the room exists.

      It is an instruction, not a location, and leaving it there made the page
      mean "open a new game" forever — so every refresh of the host desk minted
      another empty room and abandoned the one before it. Replacing the URL with
      the room's own code makes a reload reopen *this* game, and makes the
      address worth bookmarking or sending to a second screen.
    */
    const params = new URLSearchParams(location.search)
    if (params.has("new") || params.get("code") !== identity.code) {
      history.replaceState(null, "", `/host?code=${identity.code}`)
    }
  }, [identity, code])

  /**
   * Move the desk to another of your games, or open a brand new one.
   *
   * A full reload rather than a live swap: the builder, the run desk and the
   * controller invite all hold state belonging to the room being left, and
   * unpicking that by hand is a long list of places to forget one.
   */
  const goToRoom = (next) => {
    localStorage.removeItem(STORAGE + ".board")
    if (next) {
      localStorage.setItem(STORAGE + ".code", next)
      location.href = `/host?code=${next}`
    } else {
      localStorage.removeItem(STORAGE + ".code")
      location.href = "/host?new=1"
    }
  }

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
      credentials: "include",
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

      {/*
        `relative` without a `z-index`, deliberately.
        `position: relative` alone does not open a stacking context, so the room
        switcher's dropdown and the import dialog compete in the root context and
        land where their own z-index says. With `z-10` here, the header became a
        context of its own: the dropdown's `z-50` only ranked it against its
        siblings inside the header, and <main> — an equal `z-10` appearing later
        in the document — painted straight over it. The backdrop stays behind
        regardless, because it is on a negative layer.
      */}
      <header className="relative mx-auto flex w-full max-w-[2400px] shrink-0 flex-wrap items-center gap-3 px-4 py-2.5">
        <BrandMark className="text-lg" />
        <span className="label">host desk</span>
        <span className="hidden text-[0.7rem] text-faint sm:inline">{auth.user.name}</span>

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
          <RoomSwitcher code={state?.code} refreshKey={roomsVersion} onSwitch={goToRoom} onNew={() => goToRoom(null)} />
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} title={connected ? "connected" : "reconnecting"} />
          <button className="text-[0.7rem] text-faint transition-colors hover:text-bad" onClick={auth.logout}>
            sign out
          </button>
        </div>
      </header>
      <div className="bulbs relative mx-4 shrink-0" />

      {banner && (
        <div className="relative mx-4 mt-2 flex items-center gap-2 rounded-lg border border-bad/50 bg-bad/10 px-3 py-1.5 text-[12px] text-bad">
          {banner}
          <button className="ml-auto" onClick={() => setBanner(null)}>
            ✕
          </button>
        </div>
      )}

      <main className="relative mx-auto flex w-full min-h-0 max-w-[2400px] flex-1 flex-col overflow-y-auto p-4">
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
          <GameControl
            state={state}
            send={send}
            now={() => Date.now()}
            requests={requests}
            code={state.code}
            savedAt={savedAt}
            controllerKey={controllerKey}
          />
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
