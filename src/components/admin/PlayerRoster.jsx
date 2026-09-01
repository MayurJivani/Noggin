import { useState } from "react"

/**
 * The people in the room. Scores are editable inline because at some point
 * someone will be awarded points for an answer the host didn't anticipate, and
 * arguing with the software in front of an audience is not an option.
 */
export function PlayerRoster({ players, send, buzzer, lifeline, requests, stake }) {
  return (
    <div className="panel flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="label">Players · {players.length}</span>
        {players.length > 0 && (
          <button className="text-[10px] text-faint hover:text-bad" onClick={() => players.forEach((p) => send("score:set", { playerId: p.id, score: 0 }))}>
            zero all
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {players.length === 0 && <div className="px-1 py-6 text-center text-[12px] text-faint">Waiting for phones to join…</div>}
        {players.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            send={send}
            buzzer={buzzer}
            lifeline={lifeline}
            requested={requests.includes(p.id)}
            stake={stake}
          />
        ))}
      </div>
    </div>
  )
}

function PlayerRow({ player, send, buzzer, lifeline, requested, stake }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(player.score))

  const holdsBuzz = buzzer.winner === player.id
  const spent = buzzer.spent.includes(player.id)
  const race = buzzer.order.find((e) => e.playerId === player.id)
  const onLifeline = lifeline?.playerId === player.id

  const commit = () => {
    setEditing(false)
    const n = Number(draft)
    if (Number.isFinite(n) && n !== player.score) send("score:set", { playerId: player.id, score: Math.trunc(n) })
  }

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 transition-colors ${
        holdsBuzz ? "border-live bg-live/10" : onLifeline ? "border-amethyst bg-royal/25" : spent ? "border-edge/60 opacity-55" : "border-edge"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${player.connected ? "bg-good" : "bg-faint"}`} title={player.connected ? "connected" : "away"} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{player.name}</span>

        {race && <span className="shrink-0 font-body text-[10px] text-faint">{race.ms}ms</span>}
        {requested && <span className="shrink-0 text-[10px] text-live animate-glow">☎ asking</span>}

        {editing ? (
          <input
            autoFocus
            className="field w-20 py-0.5 text-right font-value text-[15px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
              if (e.key === "Escape") setEditing(false)
            }}
          />
        ) : (
          <button
            className={`shrink-0 font-value text-[17px] tabular-nums ${player.score < 0 ? "text-bad" : "text-gold"}`}
            onClick={() => {
              setDraft(String(player.score))
              setEditing(true)
            }}
            title="Click to set exactly"
          >
            {player.score}
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        <button className="btn px-1.5 py-0.5 text-[10px]" onClick={() => send("score:adjust", { playerId: player.id, delta: stake || 100 })}>
          +{stake || 100}
        </button>
        <button className="btn px-1.5 py-0.5 text-[10px]" onClick={() => send("score:adjust", { playerId: player.id, delta: -(stake || 100) })}>
          −{stake || 100}
        </button>

        <button
          className={`btn px-1.5 py-0.5 text-[10px] ${requested ? "btn-gold" : ""}`}
          disabled={(player.lifelines?.phone ?? 0) <= 0 || !!lifeline}
          onClick={() => send("lifeline:grant", { playerId: player.id, lifeline: "phone" })}
          title="Start Phone a Friend"
        >
          ☎ {player.lifelines?.phone ?? 0}
        </button>
        {(player.lifelines?.phone ?? 0) === 0 && (
          <button
            className="btn px-1.5 py-0.5 text-[10px]"
            onClick={() => send("lifeline:restore", { playerId: player.id, lifeline: "phone" })}
            title="Give the lifeline back"
          >
            ↺
          </button>
        )}

        <button
          className="btn ml-auto px-1.5 py-0.5 text-[10px] hover:border-bad hover:text-bad"
          onClick={() => confirm(`Remove ${player.name}?`) && send("player:kick", { playerId: player.id })}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
