import { useState } from "react"
import { podiumUrl } from "../../lib/net"
import { holdsBuzz, isCalling, isSpent, raceOf } from "../../lib/sides"

/**
 * The people in the room, and the sides they play for.
 *
 * Scores are editable inline because at some point someone will be awarded
 * points for an answer the host didn't anticipate, and arguing with the
 * software in front of an audience is not an option.
 *
 * On team night the panel inverts: the team is the row that scores, and the
 * people are chips underneath it. That is the right way round because it is the
 * team the host is ruling on — but the individual names still have to be there,
 * since "whose phone was that?" is a question the buzzer keeps raising.
 */
const REASONS = {
  correct: "correct",
  wrong: "wrong",
  nitro: "Noggin’ Nitro",
  "final-correct": "final",
  "final-wrong": "final",
  adjust: "by hand",
  set: "set by hand",
  carried: "carried in",
}

function ScoreHistory({ history }) {
  const rows = [...(history ?? [])].reverse()
  if (!rows.length) return <div className="mt-1.5 px-1 text-[10px] text-faint">Nothing scored yet.</div>
  return (
    <ol className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto rounded border border-edge bg-black/25 px-2 py-1.5">
      {rows.map((e, i) => (
        <li key={i} className="flex items-baseline gap-2 text-[10px]">
          <span className={`w-12 shrink-0 text-right font-value tabular-nums ${e.delta < 0 ? "text-bad" : "text-good"}`}>
            {e.delta > 0 ? "+" : ""}
            {e.delta}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {e.detail ? `${e.detail} · ` : ""}
            {REASONS[e.reason] ?? e.reason}
          </span>
          <span className="shrink-0 font-value tabular-nums text-faint">{e.score}</span>
        </li>
      ))}
    </ol>
  )
}

export function PlayerRoster({ players, teams, send, buzzer, lifeline, requests, stake, code }) {
  if (teams) return <TeamRoster players={players} teams={teams} send={send} buzzer={buzzer} lifeline={lifeline} requests={requests} stake={stake} code={code} />

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
            code={code}
          />
        ))}
      </div>
    </div>
  )
}

// ── Team night ───────────────────────────────────────────────────────────────

function TeamRoster({ players, teams, send, buzzer, lifeline, requests, stake, code }) {
  const loose = players.filter((p) => !p.teamId)

  return (
    <div className="panel flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-edge px-3 py-2">
        <span className="label">Teams · {teams.length}</span>
        <span className="text-[10px] text-faint">{players.length} playing</span>
        <div className="ml-auto flex gap-1">
          <button
            className="btn px-1.5 py-0.5 text-[10px]"
            title="Deal everyone out evenly, in the order they joined"
            onClick={() => send("team:autofill", { count: teams.length || 2 })}
          >
            ⇄ Even up
          </button>
          <button className="btn px-1.5 py-0.5 text-[10px]" title="Add a team" onClick={() => send("team:create")}>
            + Team
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            teams={teams}
            players={players}
            send={send}
            buzzer={buzzer}
            lifeline={lifeline}
            requests={requests}
            stake={stake}
            code={code}
          />
        ))}

        {/* Anyone the relay could not seat — a team was deleted out from under
            them, or they joined before there were any. They cannot buzz for a
            side until they are on one, so this is deliberately loud. */}
        {loose.length > 0 && (
          <div className="rounded-lg border border-dashed border-bad/50 px-2 py-1.5">
            <div className="text-[10px] text-bad">Not on a team yet</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {loose.map((p) => (
                <MemberChip key={p.id} player={p} teams={teams} send={send} buzzer={buzzer} requested={requests.includes(p.id)} />
              ))}
            </div>
          </div>
        )}

        {teams.length === 0 && <div className="px-1 py-6 text-center text-[12px] text-faint">No teams yet — add one.</div>}
      </div>
    </div>
  )
}

function TeamCard({ team, teams, players, send, buzzer, lifeline, requests, stake, code }) {
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [draft, setDraft] = useState(String(team.score))
  const [nameDraft, setNameDraft] = useState(team.name)

  const holds = holdsBuzz(team, buzzer)
  const spent = isSpent(team, buzzer)
  const onCall = isCalling(team, lifeline)
  const race = raceOf(team, buzzer)
  const members = players.filter((p) => team.members.includes(p.id))
  const asking = members.some((p) => requests.includes(p.id))

  const commit = () => {
    setEditing(false)
    const n = Number(draft)
    if (Number.isFinite(n) && n !== team.score) send("score:set", { playerId: team.id, score: Math.trunc(n) })
  }

  return (
    <div
      style={!holds && !onCall && !spent ? { borderColor: `${team.color}55` } : undefined}
      className={`rounded-lg border px-2.5 py-2 transition-colors ${
        holds ? "border-live bg-live/10" : onCall ? "border-amethyst bg-royal/25" : spent ? "border-edge/60 opacity-55" : "border-edge"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: team.color }} />

        {renaming ? (
          <input
            autoFocus
            className="field min-w-0 flex-1 py-0.5 text-[13px]"
            maxLength={20}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (nameDraft.trim() && nameDraft !== team.name) send("team:rename", { teamId: team.id, name: nameDraft.trim() })
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
              if (e.key === "Escape") {
                setNameDraft(team.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold"
            title="Rename"
            onClick={() => {
              setNameDraft(team.name)
              setRenaming(true)
            }}
          >
            {team.name}
          </button>
        )}

        {race && <span className="shrink-0 font-body text-[10px] text-faint">{race.ms}ms</span>}
        {asking && <span className="shrink-0 text-[10px] text-live animate-glow">☎ asking</span>}

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
          <>
            <button
              className="shrink-0 px-1 text-[10px] text-faint transition-colors hover:text-gold"
              title="Where this score came from"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? "▾" : "▸"}
            </button>
            <button
              className={`shrink-0 font-value text-[17px] tabular-nums ${team.score < 0 ? "text-bad" : "text-gold"}`}
              onClick={() => {
                setDraft(String(team.score))
                setEditing(true)
              }}
              title="Click to set exactly"
            >
              {team.score}
            </button>
          </>
        )}
      </div>

      {showHistory && <ScoreHistory history={team.history} />}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <button className="btn px-1.5 py-0.5 text-[10px]" onClick={() => send("score:adjust", { playerId: team.id, delta: stake || 100 })}>
          +{stake || 100}
        </button>
        <button className="btn px-1.5 py-0.5 text-[10px]" onClick={() => send("score:adjust", { playerId: team.id, delta: -(stake || 100) })}>
          −{stake || 100}
        </button>
        {/* One purse per team, so the button lives on the team — but a lifeline
            is a phone call and somebody has to make it, so it is granted to a
            member. The first one on the sheet is as good an answer as any. */}
        <button
          className={`btn px-1.5 py-0.5 text-[10px] ${asking ? "btn-gold" : ""}`}
          disabled={(team.lifelines?.phone ?? 0) <= 0 || !!lifeline || members.length === 0}
          onClick={() => send("lifeline:grant", { playerId: members.find((p) => requests.includes(p.id))?.id ?? members[0]?.id, lifeline: "phone" })}
          title="Start Phone a Friend for this team"
        >
          ☎ {team.lifelines?.phone ?? 0}
        </button>
        {(team.lifelines?.phone ?? 0) === 0 && members[0] && (
          <button
            className="btn px-1.5 py-0.5 text-[10px]"
            onClick={() => send("lifeline:restore", { playerId: members[0].id, lifeline: "phone" })}
            title="Give the lifeline back"
          >
            ↺
          </button>
        )}
        <button
          className="btn ml-auto px-1.5 py-0.5 text-[10px]"
          title="Open this team's podium screen"
          onClick={async () => window.open(await podiumUrl(code, team.name), "_blank", "noreferrer")}
        >
          ▭
        </button>
        <button
          className="btn px-1.5 py-0.5 text-[10px] hover:border-bad hover:text-bad"
          title="Delete this team — its players stay in the game"
          onClick={() => confirm(`Delete ${team.name}? Its ${members.length} player(s) will need a new side.`) && send("team:delete", { teamId: team.id })}
        >
          ✕
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {members.map((p) => (
          <MemberChip key={p.id} player={p} teams={teams} send={send} buzzer={buzzer} requested={requests.includes(p.id)} />
        ))}
        {members.length === 0 && <span className="px-1 text-[10px] text-faint">nobody on this team</span>}
      </div>
    </div>
  )
}

/**
 * One phone, on a team.
 *
 * The select is the whole moving mechanism — no drag, because half of this is
 * driven on a tablet and a drag target the size of a name chip is a coin flip.
 */
function MemberChip({ player, teams, send, buzzer, requested }) {
  const holds = buzzer.winner === player.id
  return (
    <span
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
        holds ? "border-live text-live" : "border-edge text-muted"
      }`}
    >
      <span className={`h-1 w-1 shrink-0 rounded-full ${player.connected ? "bg-good" : "bg-faint"}`} title={player.connected ? "connected" : "away"} />
      <span className="max-w-[8rem] truncate">{player.name}</span>
      {requested && <span className="text-live">☎</span>}
      <select
        className="cursor-pointer border-0 bg-transparent text-[10px] text-faint outline-none hover:text-gold"
        value={player.teamId ?? ""}
        title="Move to another team"
        onChange={(e) => send("team:assign", { playerId: player.id, teamId: e.target.value || null })}
      >
        <option value="">—</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        className="text-faint transition-colors hover:text-bad"
        title={`Remove ${player.name}`}
        onClick={() => confirm(`Remove ${player.name}?`) && send("player:kick", { playerId: player.id })}
      >
        ✕
      </button>
    </span>
  )
}

// ── Everyone for themselves ──────────────────────────────────────────────────

function PlayerRow({ player, send, buzzer, lifeline, requested, stake, code }) {
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [draft, setDraft] = useState(String(player.score))

  const holdsBuzzer = buzzer.winner === player.id
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
        holdsBuzzer ? "border-live bg-live/10" : onLifeline ? "border-amethyst bg-royal/25" : spent ? "border-edge/60 opacity-55" : "border-edge"
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
          <>
            <button
              className="shrink-0 px-1 text-[10px] text-faint transition-colors hover:text-gold"
              title="Where this score came from"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? "▾" : "▸"}
            </button>
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
          </>
        )}
      </div>

      {/* "Why am I on 400?" is the most common question at a quiz, and until now
          the only answer was the number itself. */}
      {showHistory && <ScoreHistory history={player.history} />}

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
          className="btn ml-auto px-1.5 py-0.5 text-[10px]"
          title="Open this player's podium screen — put it on the tablet in front of them"
          onClick={async () => window.open(await podiumUrl(code, player.name), "_blank", "noreferrer")}
        >
          ▭
        </button>
        <button
          className="btn px-1.5 py-0.5 text-[10px] hover:border-bad hover:text-bad"
          onClick={() => confirm(`Remove ${player.name}?`) && send("player:kick", { playerId: player.id })}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
