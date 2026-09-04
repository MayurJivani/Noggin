/**
 * Sides: whoever is being scored, whether that is a person or a team.
 *
 * The relay projects `state.teams` in exactly the shape of `state.players` —
 * `{ id, name, score, connected, lifelines, history }` — plus a `members` list.
 * So every screen that draws a scoreboard can ask for `rows(state)` and be
 * right on both kinds of night, instead of carrying a second layout for the one
 * where people are in teams.
 *
 * The buzzer is the only thing that stays stubbornly per-phone, because a
 * person presses it. The helpers below close that gap: a team holds the buzz
 * when any of its members does.
 */

/** What the scoreboard is a list of. Teams when they are on, otherwise people. */
export const rows = (state) => state?.teams ?? state?.players ?? []

/** True when the room is playing in teams. */
export const inTeams = (state) => !!state?.teams

const owns = (row, id) => (row?.members ? row.members.includes(id) : row?.id === id)

export const holdsBuzz = (row, buzzer) => !!buzzer?.winner && owns(row, buzzer.winner)

export const isSpent = (row, buzzer) =>
  row?.members ? row.members.some((id) => buzzer?.spent?.includes(id)) : !!buzzer?.spent?.includes(row?.id)

export const isCalling = (row, lifeline) => !!lifeline && owns(row, lifeline.playerId)

/** The wager on a nitro, if it belongs to this row. */
export function wagerOf(row, wager) {
  if (!wager || wager.amount == null) return null
  if (wager.teamId && row?.id === wager.teamId) return wager.amount
  if (wager.playerId && owns(row, wager.playerId)) return wager.amount
  return null
}

/** How far behind the winner this row buzzed, or null if it was not in the race. */
export function raceOf(row, buzzer) {
  if (!buzzer?.order?.length) return null
  return buzzer.order.find((e) => owns(row, e.playerId)) ?? null
}

/**
 * A name for an id that might be a player's or a team's.
 *
 * Effects carry whichever the relay was acting on, and a screen showing "who
 * just got that right" should say the team on team night.
 */
export function nameOf(state, id) {
  if (!id) return null
  const team = state?.teams?.find((t) => t.id === id)
  if (team) return team.name
  const player = state?.players?.find((p) => p.id === id)
  if (!player) return null
  if (!state.teams) return player.name
  const owner = state.teams.find((t) => t.members.includes(player.id))
  // On team night the room cares which side scored, but the person who buzzed
  // is the one they are looking at — so say both.
  return owner ? `${player.name} · ${owner.name}` : player.name
}

/** The row a given player belongs to — their team, or their own entry. */
export function rowFor(state, playerId) {
  if (!playerId) return null
  return rows(state).find((r) => owns(r, playerId)) ?? null
}
