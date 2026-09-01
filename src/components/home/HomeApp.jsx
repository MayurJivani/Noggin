import { useEffect, useState } from "react"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { isLoopbackPage } from "../../lib/net"
import { Backdrop } from "../ui/Backdrop"
import { Brand } from "../ui/Brand"
import { CornerVein, VeinLine } from "../ui/Vein"
import { useAuth } from "../../lib/useAuth"

/**
 * The front door.
 *
 * Three people arrive at this URL wanting three different things: the host
 * wants their desk, whoever is at the projector wants the big screen, and
 * everyone else wants to type four letters and start playing. Guessing wrong
 * for any of them costs the whole room a minute, so it asks rather than
 * assumes — and puts the unfinished games right underneath.
 */
export function HomeApp() {
  const auth = useAuth()
  const [rooms, setRooms] = useState([])
  const [live, setLive] = useState([])
  const [boards, setBoards] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    // Saved games and boards belong to an account. Signed out there is nothing
    // to fetch, and asking anyway would just be a pair of 401s on every tick.
    if (!auth.user) {
      setRooms([])
      setLive([])
      setBoards([])
      setLoaded(auth.ready)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const [r, b] = await Promise.all([
          fetch(`${getRelayOrigin()}/rooms`, { credentials: "include" }).then((x) => x.json()),
          fetch(`${getRelayOrigin()}/boards`, { credentials: "include" }).then((x) => x.json()),
        ])
        if (cancelled) return
        setRooms(r.rooms ?? [])
        setLive(r.live ?? [])
        setBoards(b.boards ?? [])
        setOffline(false)
      } catch {
        if (!cancelled) setOffline(true)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    const id = setInterval(load, 8000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [auth.user, auth.ready])

  const liveCodes = new Set(live.map((l) => l.code))
  const orphanLive = live.filter((l) => !rooms.some((r) => r.code === l.code))
  const hasRooms = rooms.length > 0 || orphanLive.length > 0

  return (
    <div className="relative min-h-dvh">
      <Backdrop veins={8} glow={4} />

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[min(92vw,max(64rem,74vw))] flex-col justify-center px-4 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col items-center text-center">
          {/* One fluid size: the ring is drawn in `em`, so the whole wordmark
              tracks the viewport rather than sitting at a fixed 96px in the
              middle of a 4K panel. */}
          <Brand size="clamp(3.25rem, 7vw, 11rem)" />
          <VeinLine className="mt-2 w-[min(22rem,60%)]" height={18} />
          <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-muted">
            A quiz board for a room with a screen and a pile of phones. Write it, put it on the wall, let everyone buzz in.
          </p>
        </header>

        {auth.ready && (
          <div className="mt-6 flex items-center justify-center gap-3 text-xs">
            {auth.user ? (
              <>
                <span className="text-muted">
                  Signed in as <span className="text-ink">{auth.user.name}</span>
                </span>
                <button className="text-faint transition-colors hover:text-bad" onClick={auth.logout}>
                  sign out
                </button>
              </>
            ) : (
              <span className="text-faint">Hosting needs an account — players just need the code.</span>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-3 2xl:gap-5">
          <Door
            href="/host"
            eyebrow="I'm running it"
            title={auth.user ? "Host a game" : "Sign in to host"}
            body="Write the board, then run the night from one desk."
            primary
          />
          <Door href="/display" eyebrow="This is the TV" title="Big screen" body="The board everyone watches. Needs a room code." />
          <JoinDoor />
        </div>

        {(offline || isLoopbackPage()) && (
          <div className="mt-4 space-y-2">
            {offline && (
              <Notice tone="bad">
                Can't reach the relay on port 4332. Is <code className="font-body text-ink">npm run dev</code> still running?
              </Notice>
            )}
            {isLoopbackPage() && (
              <Notice tone="warn">
                You're on <b className="text-gold">localhost</b> — phones can't reach that. Open this page on the machine's LAN address before
                handing out the code.
              </Notice>
            )}
          </div>
        )}

        {auth.user && loaded && hasRooms && (
          <Section title="Your games" action={<a className="btn py-1 text-xs" href="/host?new=1">+ New game</a>}>
            <ul className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
              {orphanLive.map((l) => (
                <RoomRow
                  key={l.code}
                  room={{ ...l, players: [], progress: null }}
                  live
                  onGone={() => setLive((ls) => ls.filter((x) => x.code !== l.code))}
                />
              ))}
              {rooms.map((r) => (
                <RoomRow key={r.code} room={r} live={liveCodes.has(r.code)} onGone={() => setRooms((rs) => rs.filter((x) => x.code !== r.code))} />
              ))}
            </ul>
          </Section>
        )}

        {auth.user && loaded && boards.length > 0 && (
          <Section title="Boards you've written">
            <ul className="flex flex-wrap gap-2">
              {boards.slice(0, 12).map((b) => (
                <li key={b.id}>
                  <a
                    href={`/host?board=${encodeURIComponent(b.id)}`}
                    className="flex items-center gap-2 rounded-lg border border-edge bg-panel-2/60 px-3 py-2 text-xs transition-colors hover:border-gold-dim hover:bg-panel-2"
                  >
                    <span className="max-w-[14rem] truncate text-ink">{b.title}</span>
                    <span className="shrink-0 rounded bg-black/40 px-1.5 py-px text-[0.7rem] text-faint">{b.clues}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <footer className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
          <span>Everything runs on your own machine.</span>
          <a className="transition-colors hover:text-gold" href="/control">
            Remote controller →
          </a>
        </footer>
      </main>
    </div>
  )
}

function Section({ title, children, action = null }) {
  return (
    <section className="mt-10 space-y-3.5 2xl:mt-14">
      <div className="flex items-center gap-4">
        <h2 className="shrink-0 font-display text-lg text-gold 2xl:text-2xl">{title}</h2>
        <VeinLine className="hidden min-w-0 flex-1 sm:block" height={12} opacity={0.7} />
        {action}
      </div>
      {children}
    </section>
  )
}

function Notice({ tone, children }) {
  const skin = tone === "bad" ? "border-bad/40 bg-bad/10 text-bad" : "border-gold-dim/40 bg-gold/[0.06] text-muted"
  return <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${skin}`}>{children}</div>
}

function Door({ href, eyebrow, title, body, primary = false }) {
  return (
    <a
      href={href}
      className={`group relative flex flex-col gap-1.5 overflow-hidden rounded-xl border p-4 transition-all duration-200 2xl:p-6 ${
        primary
          ? "border-gold-deep/55 bg-gradient-to-b from-onyx/95 to-void/90 hover:border-gold hover:shadow-[0_0_32px_rgba(242,201,107,0.18)]"
          : "border-edge bg-panel/70 hover:border-gold-dim/70 hover:bg-panel-2/70"
      }`}
    >
      <CornerVein className={primary ? "opacity-70" : "opacity-30 transition-opacity group-hover:opacity-60"} />
      <span className="label relative">{eyebrow}</span>
      <span className={`relative font-display text-xl leading-tight 2xl:text-2xl ${primary ? "brass-sm" : "text-ink"}`}>{title}</span>
      <span className="relative text-xs leading-snug text-muted">{body}</span>
      <span className="relative mt-1 text-xs text-faint transition-colors group-hover:text-gold">Open →</span>
    </a>
  )
}

/** Joining is the only door that needs input, so it holds its own form. */
function JoinDoor() {
  const [code, setCode] = useState("")
  const ready = code.trim().length >= 3
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) location.href = `/play?code=${encodeURIComponent(code.trim())}`
      }}
      className="group relative flex flex-col gap-1.5 overflow-hidden rounded-xl border border-edge bg-panel/70 p-4 transition-colors focus-within:border-gold-dim/70 2xl:p-6"
    >
      <CornerVein className="opacity-30" />
      <span className="label relative">I'm playing</span>
      <span className="relative font-display text-xl leading-tight 2xl:text-2xl text-ink">Join a game</span>
      {/* `w-0 flex-1` rather than the field's default full width — otherwise the
          input refuses to shrink and pushes Go out past the card's edge. */}
      <div className="relative mt-auto flex gap-2 pt-1">
        <input
          className="field w-0 flex-1 text-center font-display text-lg uppercase tracking-[0.2em]"
          maxLength={4}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="CODE"
          aria-label="Room code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
        <button className="btn btn-gold shrink-0 px-4" disabled={!ready}>
          Go
        </button>
      </div>
    </form>
  )
}

function RoomRow({ room, live, onGone }) {
  const [busy, setBusy] = useState(false)
  const players = room.players ?? []
  const top = [...players].sort((a, b) => b.score - a.score).slice(0, 3)
  const pct = room.progress?.total ? Math.round((room.progress.played / room.progress.total) * 100) : null

  const remove = async () => {
    const warning = live ? "It is running right now — everyone in it will be disconnected. " : ""
    if (!confirm(`Delete game ${room.code}? ${warning}Scores go with it. This cannot be undone.`)) return
    setBusy(true)
    await fetch(`${getRelayOrigin()}/rooms/${room.code}`, { method: "DELETE", credentials: "include" }).catch(() => {})
    setBusy(false)
    onGone?.()
  }

  return (
    <li
      className={`relative overflow-hidden rounded-xl border p-3.5 transition-opacity ${
        live ? "border-good/40 bg-good/[0.06]" : "border-edge bg-panel/70"
      } ${busy ? "pointer-events-none opacity-40" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-display brass-sm text-lg leading-none tracking-[0.18em]">{room.code}</span>
        {live && (
          <span className="shrink-0 rounded-full border border-good/50 px-1.5 py-px text-[0.65rem] uppercase tracking-wider text-good">live</span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-ink" title={room.title}>
          {room.title}
        </span>
      </div>

      {pct != null && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/50">
            <div className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-[0.7rem] tabular-nums text-faint">
            {room.progress.played}/{room.progress.total}
          </span>
        </div>
      )}

      {top.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          {top.map((p) => (
            <span key={p.name} className="truncate">
              {p.name} <span className="font-value text-gold">{p.score}</span>
            </span>
          ))}
          {players.length > top.length && <span className="text-faint">+{players.length - top.length} more</span>}
        </div>
      )}

      <div className="mt-3 flex gap-1.5">
        <a className="btn btn-gold min-w-0 flex-1 truncate py-1.5 text-center text-xs" href={`/host?code=${room.code}`}>
          {live ? "Rejoin as host" : "Resume"}
        </a>
        <a className="btn shrink-0 px-2.5 py-1.5 text-xs" href={`/display?code=${room.code}`} title="Open the big screen for this room">
          TV
        </a>
        <button
          className="btn shrink-0 px-2.5 py-1.5 text-xs hover:border-bad hover:text-bad"
          onClick={remove}
          title={live ? "End and delete this game" : "Delete this saved game"}
          aria-label={`Delete game ${room.code}`}
        >
          ✕
        </button>
      </div>
    </li>
  )
}
