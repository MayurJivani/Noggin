import { useEffect, useRef, useState } from "react"
import { getRelayOrigin } from "../../lib/mediaUrl"

/**
 * Which of your games this desk is currently driving.
 *
 * A host runs more than one night, and often more than one room in an evening —
 * a practice game, the real one, a tiebreak. The desk used to remember exactly
 * one code and offer no way to leave it, so a second game meant clearing
 * localStorage. This lists every room you own and mints new ones on demand.
 */
export function RoomSwitcher({ code, onSwitch, onNew, onDelete, refreshKey }) {
  const [open, setOpen] = useState(false)
  const [rooms, setRooms] = useState([])
  const [live, setLive] = useState([])
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    fetch(`${getRelayOrigin()}/rooms`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        setRooms(j.rooms ?? [])
        setLive(j.live ?? [])
      })
      .catch(() => {})
  }, [open, refreshKey])

  // Click-away and Escape, because this hangs over the board.
  useEffect(() => {
    if (!open) return
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false)
    }
    const key = (e) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", key)
    }
  }, [open])

  const liveCodes = new Set(live.map((l) => l.code))
  // A room that is live but never saved still belongs in the list.
  const all = [...live.filter((l) => !rooms.some((r) => r.code === l.code)).map((l) => ({ ...l, players: [], live: true })), ...rooms]

  return (
    <div className="relative" ref={box}>
      <button
        className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 transition-colors hover:border-gold-dim"
        onClick={() => setOpen((v) => !v)}
        title="Switch or start a game"
      >
        <span className="text-right">
          <span className="label block leading-none">Room</span>
          <span className="font-display brass-sm block text-lg leading-tight tracking-[0.2em]">{code ?? "…"}</span>
        </span>
        <span className="text-[0.65rem] text-faint">▾</span>
      </button>

      {open && (
        <div className="panel absolute right-0 z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] p-2 shadow-2xl shadow-black/70">
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {all.length === 0 && <div className="px-2 py-3 text-center text-xs text-faint">This is your only game.</div>}
            {all.map((r) => {
              const isLive = r.live || liveCodes.has(r.code)
              const current = r.code === code
              return (
                <div
                  key={r.code}
                  className={`flex items-center gap-1 rounded-lg border px-1 transition-colors ${
                    current ? "border-gold-deep bg-royal/40" : "border-edge hover:border-gold-dim"
                  }`}
                >
                  <button
                    disabled={current}
                    onClick={() => {
                      setOpen(false)
                      onSwitch(r.code)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-1.5 text-left disabled:cursor-default"
                  >
                    <span className="font-display brass-sm shrink-0 text-sm tracking-[0.15em]">{r.code}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{r.title}</span>
                    {isLive && <span className="shrink-0 rounded-full border border-good/50 px-1.5 text-[0.6rem] text-good">live</span>}
                    {current && <span className="shrink-0 text-[0.6rem] text-faint">here</span>}
                  </button>
                  <button
                    className="shrink-0 px-2 py-1 text-xs text-faint transition-colors hover:text-bad"
                    title={isLive ? "End and delete this game" : "Delete this saved game"}
                    aria-label={`Delete game ${r.code}`}
                    onClick={async () => {
                      const warning = isLive ? "It is running right now — everyone in it will be disconnected. " : ""
                      if (!confirm(`Delete game ${r.code}? ${warning}Scores go with it. This cannot be undone.`)) return
                      setOpen(false)
                      await onDelete(r.code, current)
                    }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

          <button
            className="btn btn-gold mt-2 w-full py-2 text-xs"
            onClick={() => {
              setOpen(false)
              onNew()
            }}
          >
            + Start a new game
          </button>
        </div>
      )}
    </div>
  )
}
