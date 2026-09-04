/**
 * The rules of Noggin, as pure(-ish) functions over a room object.
 *
 * Everything here is deliberately free of sockets, timers and disk so it can be
 * driven straight from `node --test`. The relay owns transport; this file owns
 * "what is true right now". Mutators return an array of *effects* — transient
 * things the display animates on (a buzz, a correct answer, a Nitro
 * splash) that aren't derivable from the state snapshot alone.
 */

/** Phases the room can be in. The display keys its whole layout off this. */
export const PHASE = {
  LOBBY: "lobby", // players joining, board not yet revealed
  BOARD: "board", // grid on screen, host picking
  WAGER: "wager", // Noggin' Nitro — the player who found it is setting a wager
  CLUE: "clue", // clue on screen; buzzer may or may not be armed
  REVEAL: "reveal", // answer shown
  INTERMISSION: "intermission", // between rounds
  FINAL: "final", // the last clue: wager, write, reveal
  ENDED: "ended",
}

export const CLUE_STATUS = { OPEN: "open", PLAYED: "played" }

/** Lifelines a player can hold. Adding one here is enough for the UI to list it. */
export const LIFELINES = {
  phone: { id: "phone", label: "Phone a Friend", seconds: 30 },
}

export const DEFAULTS = {
  /** Buzzing before the host arms the buzzer costs you this long. */
  earlyPenaltyMs: 500,
  /** How long a player has to answer once they've buzzed in. 0 = untimed. */
  answerSeconds: 8,
  /**
   * Open the buzzer by itself when a clue goes up, instead of waiting for the
   * host to arm it. Off by default — arming is the host's cue that the room is
   * ready, and taking it away surprises anyone used to the classic flow.
   */
  autoArm: false,
  /**
   * With `autoArm`, how long the room gets to read before the buzzer opens.
   * Zero opens it the instant the clue appears, which favours whoever is
   * fastest rather than whoever knows it.
   */
  readSeconds: 0,
  /** Lifelines each player starts with. */
  lifelines: { phone: 1 },
  /** A wrong answer subtracts the clue value as well as failing to add it. */
  penaltyForWrong: true,
  /**
   * Mirror the clue onto players' phones.
   *
   * On by default — it is how the person at the back who cannot see the TV
   * plays at all. A host who wants every eye on the big screen turns it off,
   * and then the phones are not *hiding* the clue, they are never sent it.
   */
  mirrorClue: true,
  /**
   * Several phones sharing one score and one buzz. See the Teams section.
   * Off by default: a party of five plays as five, and turning this on when
   * nobody asked for it would silently merge everyone's scores.
   */
  teams: false,
}

/**
 * Team colours, in the order they are handed out.
 *
 * Named rather than free-form because they have to read from the back of a room
 * on a projector — these are all light enough to sit on the marble and far
 * enough apart to tell at a glance.
 */
export const TEAM_PALETTE = ["#f2c96b", "#7ad1a8", "#8fb8ff", "#e08ac0", "#f09a5a", "#a86ce0", "#6fd6e0", "#d6d36a"]

/** How many score changes to remember per player. */
const HISTORY_LIMIT = 30

/**
 * How long after the winning press a later one still counts as part of the race.
 *
 * Without this, every press between the winner and the host's ruling was filed
 * as a race entry timed from when the buzzer opened — so a player idly pressing
 * while the host deliberated showed up as "15000ms", which is true and useless.
 * A photo finish is decided in tenths; anything beyond this is not a contender.
 */
const LATE_GRACE_MS = 1500

let seq = 0
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ── Board construction ───────────────────────────────────────────────────────

export function makeClue(value = 200) {
  return {
    id: uid("c"),
    value,
    prompt: "",
    /** { kind: 'image'|'audio', url, alt? } shown *with* the prompt. */
    media: null,
    answer: "",
    /** Media revealed alongside the answer, e.g. "who sang this?" -> the artwork. */
    answerMedia: null,
    nitro: false,
    status: CLUE_STATUS.OPEN,
  }
}

export function makeCategory(title = "", values = [200, 400, 600, 800, 1000]) {
  return { id: uid("cat"), title, clues: values.map(makeClue) }
}

export function makeRound(name = "Round 1", values = [200, 400, 600, 800, 1000], categories = 5) {
  return {
    id: uid("r"),
    name,
    values,
    categories: Array.from({ length: categories }, () => makeCategory("", values)),
  }
}

/**
 * The last clue. Everyone plays it at once, in writing, having bet first —
 * which is why it lives beside the rounds rather than in one.
 */
export function makeFinal() {
  return { category: "", prompt: "", media: null, answer: "", answerMedia: null, seconds: 30, enabled: false }
}

export function makeBoard() {
  return {
    id: uid("b"),
    title: "Untitled Game",
    updatedAt: Date.now(),
    rounds: [
      makeRound("Round 1", [200, 400, 600, 800, 1000]),
      makeRound("Round 2", [400, 800, 1200, 1600, 2000]),
    ],
    final: makeFinal(),
  }
}

/**
 * Trust nothing that arrives over the wire. The host builder is a browser tab
 * and browser tabs get edited; a malformed board must not be able to wedge a
 * live room mid-show, so coerce it into shape instead of rejecting it.
 */
export function normaliseBoard(raw) {
  const board = makeBoard()
  if (!raw || typeof raw !== "object") return board
  board.id = typeof raw.id === "string" ? raw.id : board.id
  board.title = str(raw.title, 80) || "Untitled Game"
  board.updatedAt = Date.now()

  board.final = {
    category: str(raw.final?.category, 60),
    prompt: str(raw.final?.prompt, 600),
    media: media(raw.final?.media),
    answer: str(raw.final?.answer, 300),
    answerMedia: media(raw.final?.answerMedia),
    seconds: Math.max(5, Math.min(num(raw.final?.seconds, 30), 600)),
    enabled: !!raw.final?.enabled,
  }

  const rounds = Array.isArray(raw.rounds) ? raw.rounds.slice(0, 8) : []
  if (!rounds.length) return board

  board.rounds = rounds.map((r, ri) => {
    const values = Array.isArray(r?.values) && r.values.length ? r.values.map(num).slice(0, 12) : [200, 400, 600, 800, 1000]
    const cats = Array.isArray(r?.categories) ? r.categories.slice(0, 8) : []
    return {
      id: typeof r?.id === "string" ? r.id : uid("r"),
      name: str(r?.name, 40) || `Round ${ri + 1}`,
      values,
      categories: (cats.length ? cats : [makeCategory("", values)]).map((c) => ({
        id: typeof c?.id === "string" ? c.id : uid("cat"),
        title: str(c?.title, 60),
        clues: (Array.isArray(c?.clues) ? c.clues : []).slice(0, 12).map((cl, i) => ({
          id: typeof cl?.id === "string" ? cl.id : uid("c"),
          value: num(cl?.value, values[i] ?? 200),
          prompt: str(cl?.prompt, 600),
          media: media(cl?.media),
          answer: str(cl?.answer, 300),
          answerMedia: media(cl?.answerMedia),
          // Boards written before the rename say `dailyDouble`; read both so a
          // saved game does not lose its marked tiles.
          nitro: !!(cl?.nitro ?? cl?.dailyDouble),
          status: cl?.status === CLUE_STATUS.PLAYED ? CLUE_STATUS.PLAYED : CLUE_STATUS.OPEN,
        })),
      })),
    }
  })
  return board
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "")
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback)

const MEDIA_KINDS = new Set(["image", "audio", "video"])

function media(m) {
  if (!m || typeof m !== "object") return null
  const kind = MEDIA_KINDS.has(m.kind) ? m.kind : null
  const url = typeof m.url === "string" ? m.url.slice(0, 500) : ""
  if (!kind || !url) return null
  return { kind, url, alt: str(m.alt, 120) }
}

/** True when nothing is left to play on this round. */
export function roundComplete(round) {
  return round.categories.every((c) => c.clues.every((cl) => cl.status === CLUE_STATUS.PLAYED))
}

// ── Room construction ────────────────────────────────────────────────────────

export function createRoom(code, settings = {}) {
  return {
    code,
    createdAt: Date.now(),
    board: makeBoard(),
    settings: { ...DEFAULTS, ...settings },
    phase: PHASE.LOBBY,
    roundIndex: 0,
    /** id -> player */
    players: new Map(),
    /** id -> team. Only consulted while `settings.teams` is on. */
    teams: new Map(),
    /** { at, timer } while the room is frozen. See `pauseGame`. */
    paused: null,
    /** Whether the big screen is running the music bed. */
    music: false,
    /** {catIndex, clueIndex} of the clue on screen, or null. */
    active: null,
    /** Daily double bookkeeping for the clue on screen. */
    wager: null,
    buzzer: {
      armed: false,
      /** Has the buzzer been open at all during this race? Distinguishes
       *  "jumped the gun" from "lost the race by 60ms", which are very
       *  different things to do to a player. */
      opened: false,
      openedAt: 0,
      /** [{ playerId, ms }] in arrival order — the host sees who was close. */
      order: [],
      /** Player currently holding the buzz, or null. */
      winner: null,
      /** How long after opening the winner pressed, so margins can be shown. */
      winnerMs: null,
      /** playerId -> epoch ms until which they may not buzz. */
      lockedUntil: {},
      /** Players who have already answered this clue and got it wrong. */
      spent: [],
    },
    /** { kind, endsAt, duration } — one visible countdown at a time. */
    timer: null,
    /** { type, playerId, endsAt } while a lifeline is running. */
    lifeline: null,
    /** Enough of the last ruling to take it back. See `undoJudgement`. */
    lastJudgement: null,
    /** Live state of the final clue. See the Final round section. */
    final: null,
    revealed: false,
  }
}

export function makePlayer(id, name) {
  return {
    id,
    name,
    score: 0,
    connected: true,
    joinedAt: Date.now(),
    /** Which team they play for, or null. Ignored unless `settings.teams`. */
    teamId: null,
    lifelines: { ...DEFAULTS.lifelines },
    /** Every score change, newest last. See `record`. */
    history: [],
  }
}

export function makeTeam(id, name, colorIndex = 0) {
  return {
    id,
    name,
    color: TEAM_PALETTE[colorIndex % TEAM_PALETTE.length],
    score: 0,
    lifelines: { ...DEFAULTS.lifelines },
    history: [],
  }
}

/**
 * Note a score change against the player it happened to.
 *
 * "Why am I on 400?" is the single most common question at a quiz, and until
 * now the only answer was a number with no story behind it. Each entry carries
 * what it was for, so the roster can show the working.
 */
function record(player, delta, reason, detail = null) {
  if (!delta) return
  player.history ??= []
  player.history.push({ at: Date.now(), delta, score: player.score, reason, detail })
  if (player.history.length > HISTORY_LIMIT) player.history.shift()
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export const currentRound = (room) => room.board.rounds[room.roundIndex] ?? room.board.rounds[0]

export function activeClue(room) {
  if (!room.active) return null
  const round = currentRound(room)
  return round?.categories[room.active.catIndex]?.clues[room.active.clueIndex] ?? null
}

/** What the clue is worth right now — a nitro overrides the tile value. */
export function stake(room) {
  const clue = activeClue(room)
  if (!clue) return 0
  if (room.wager && Number.isFinite(room.wager.amount)) return room.wager.amount
  return clue.value
}

/** Biggest wager a side may make: its score, or the round's top tile if broke. */
export function maxWager(room, id) {
  const round = currentRound(room)
  const top = Math.max(...round.values, 0)
  const score = scorer(room, id)?.score ?? 0
  return Math.max(score, top)
}

// ── Teams ────────────────────────────────────────────────────────────────────

/**
 * Several phones, one score, one buzz.
 *
 * The trick that keeps this from forking every rule in the file is that a team
 * is shaped exactly like a player where it matters: it has a `score`, a
 * `lifelines` purse and a `history`. So nothing below asks "are we in team
 * mode?" before adding points — it asks `scorer()` whose ledger this is, and
 * gets back either the player or the team standing behind them.
 *
 * The buzzer is the other half. A team must not be able to buy five attempts by
 * fielding five phones, so anywhere the buzzer says "this player", it means
 * "this player's side": one entry in the race, one shot at the clue, one
 * lockout.
 */

/** Whose ledger a player's points land on. Accepts a player id or a team id. */
export function scorer(room, id) {
  if (!id) return null
  const player = room.players.get(id)
  if (player) {
    if (!room.settings.teams) return player
    // An unassigned player in team mode is a team of one rather than a hole in
    // the scoring — better a lone entry on the board than points going nowhere.
    return (player.teamId && room.teams.get(player.teamId)) || player
  }
  return room.settings.teams ? (room.teams.get(id) ?? null) : null
}

export const teamOf = (room, playerId) => {
  if (!room.settings.teams) return null
  const p = room.players.get(playerId)
  return (p?.teamId && room.teams.get(p.teamId)) || null
}

export const membersOf = (room, teamId) => [...room.players.values()].filter((p) => p.teamId === teamId)

/** Everyone who shares a buzz with this player — their team, or just them. */
export function sideIds(room, playerId) {
  const team = teamOf(room, playerId)
  return team ? membersOf(room, team.id).map((p) => p.id) : [playerId]
}

/** Do these two players share a side? True for a player and themselves. */
export function sameSide(room, a, b) {
  if (a === b) return true
  const ta = teamOf(room, a)
  return !!ta && ta === teamOf(room, b)
}

/** The sides currently in play: teams when they are on, otherwise players. */
export const sides = (room) => (room.settings.teams ? [...room.teams.values()] : [...room.players.values()])

export function createTeam(room, name) {
  const id = uid("t")
  const team = makeTeam(id, str(name, 20) || `Team ${room.teams.size + 1}`, room.teams.size)
  team.lifelines = { ...room.settings.lifelines }
  room.teams.set(id, team)
  return team
}

export function renameTeam(room, teamId, name) {
  const team = room.teams.get(teamId)
  if (!team) return []
  team.name = str(name, 20) || team.name
  return [{ kind: "teams" }]
}

/**
 * Remove a team. Its members are not removed — they come off the sheet and
 * play for themselves until they are put somewhere else, because a phone that
 * suddenly cannot buzz is a worse outcome than an odd-looking scoreboard.
 */
export function deleteTeam(room, teamId) {
  if (!room.teams.has(teamId)) return []
  room.teams.delete(teamId)
  for (const p of room.players.values()) if (p.teamId === teamId) p.teamId = null
  return [{ kind: "teams" }]
}

export function assignTeam(room, playerId, teamId) {
  const player = room.players.get(playerId)
  if (!player) return []
  player.teamId = teamId && room.teams.has(teamId) ? teamId : null
  return [{ kind: "teams" }]
}

/** The team with the fewest people on it — where a newcomer goes. */
export function smallestTeam(room) {
  let best = null
  let bestN = Infinity
  for (const t of room.teams.values()) {
    const n = membersOf(room, t.id).length
    if (n < bestN) {
      bestN = n
      best = t
    }
  }
  return best
}

/** Seat anyone who has no team, without disturbing anyone who has one. */
export function seatStragglers(room) {
  if (!room.settings.teams || room.teams.size === 0) return
  for (const p of room.players.values()) {
    if (p.teamId && room.teams.has(p.teamId)) continue
    p.teamId = smallestTeam(room)?.id ?? null
  }
}

/**
 * Deal everyone out into `count` teams, in the order they joined.
 *
 * Deliberately not random: the host is looking at the roster while they press
 * this, and a shuffle that moves people they have already placed reads as the
 * button having gone wrong.
 */
export function autoTeams(room, count) {
  const want = Math.max(2, Math.min(num(count, 2), 8))
  while (room.teams.size > want) deleteTeam(room, [...room.teams.keys()].pop())
  while (room.teams.size < want) createTeam(room)
  const ids = [...room.teams.keys()]
  const roster = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
  roster.forEach((p, i) => {
    p.teamId = ids[i % ids.length]
  })
  return [{ kind: "teams" }]
}

/**
 * Turn team play on or off.
 *
 * Switching on mid-game carries what people have already won onto the side they
 * now play for — but only into a team that has not scored yet, so flipping the
 * setting twice does not re-add everything a team has since earned.
 */
export function setTeamMode(room, on) {
  const want = !!on
  if (want === !!room.settings.teams) return []
  room.settings.teams = want
  if (!want) return [{ kind: "teams", on: false }]

  if (room.teams.size === 0) {
    createTeam(room, "Team 1")
    createTeam(room, "Team 2")
  }
  seatStragglers(room)
  for (const team of room.teams.values()) {
    if (team.score !== 0 || team.history.length) continue
    const carried = membersOf(room, team.id).reduce((n, p) => n + p.score, 0)
    if (carried) {
      team.score = carried
      record(team, carried, "carried")
    }
  }
  return [{ kind: "teams", on: true }]
}

// ── Mutators ─────────────────────────────────────────────────────────────────
// Each returns an array of effects: { kind, ... }. Empty array = nothing to animate.

export function startGame(room) {
  if (room.phase !== PHASE.LOBBY && room.phase !== PHASE.INTERMISSION) return []
  room.phase = PHASE.BOARD
  room.roundIndex = room.phase === PHASE.INTERMISSION ? room.roundIndex : 0
  return [{ kind: "game-start" }]
}

export function selectClue(room, catIndex, clueIndex) {
  if (room.phase !== PHASE.BOARD) return []
  const round = currentRound(room)
  const clue = round?.categories[catIndex]?.clues[clueIndex]
  if (!clue || clue.status === CLUE_STATUS.PLAYED) return []

  room.active = { catIndex, clueIndex }
  room.lastJudgement = null
  room.revealed = false
  room.wager = null
  room.timer = null
  room.lifeline = null
  // Putting a clue up *is* resuming. The banked clock belonged to the last one
  // and would be wrong to hand to this one.
  room.paused = null
  resetBuzzerState(room)

  if (clue.nitro) {
    room.phase = PHASE.WAGER
    room.wager = { playerId: null, amount: null }
    return [{ kind: "nitro", catIndex, clueIndex }]
  }

  room.phase = PHASE.CLUE
  const effects = [{ kind: "clue-open", catIndex, clueIndex }]

  if (room.settings.autoArm) {
    const wait = Math.max(0, num(room.settings.readSeconds, 0))
    if (wait > 0) {
      // The relay fires this and arms; a countdown on the big screen tells the
      // room how long it has, so nobody is caught mid-sentence.
      room.timer = { kind: "arm", duration: wait, endsAt: Date.now() + wait * 1000 }
      effects.push({ kind: "arm-pending", seconds: wait })
    } else {
      effects.push(...armBuzzer(room))
    }
  }
  return effects
}

/**
 * Nitro: name who found it and what they are risking.
 *
 * `id` is a player normally and a team in team mode, because in team mode the
 * clue belongs to the side rather than to whichever member happened to pick the
 * tile — the team confers and one of them says it.
 */
export function setWager(room, id, amount) {
  if (room.phase !== PHASE.WAGER) return []
  const unit = scorer(room, id)
  if (!unit) return []
  const isTeam = room.settings.teams && room.teams.has(id)
  const capped = Math.max(0, Math.min(num(amount, 0), maxWager(room, id)))
  room.wager = { playerId: isTeam ? null : id, teamId: isTeam ? id : (teamOf(room, id)?.id ?? null), amount: capped }
  room.phase = PHASE.CLUE
  // Nobody else may buzz on a nitro — it is that side's clue alone. A team has
  // no single holder, so the floor is simply theirs and the host rules on it.
  room.buzzer.winner = isTeam ? null : id
  room.buzzer.armed = false
  return [{ kind: "wager-set", playerId: isTeam ? null : id, teamId: isTeam ? id : null, amount: capped }]
}

export function armBuzzer(room, now = Date.now()) {
  if (room.phase !== PHASE.CLUE || room.paused) return []
  if (room.wager) return [] // a nitro belongs to one side: no race to run
  room.buzzer.armed = true
  room.buzzer.opened = true
  room.buzzer.openedAt = now
  room.buzzer.winner = null
  room.buzzer.winnerMs = null
  // Each arming is its own race. Leaving the previous order in place would bar
  // anyone already in it from pressing again.
  room.buzzer.order = []
  const secs = room.settings.answerSeconds
  room.timer = null
  return [{ kind: "buzzer-open", answerSeconds: secs }]
}

export function lockBuzzer(room) {
  room.buzzer.armed = false
  room.timer = null
  return [{ kind: "buzzer-lock" }]
}

/** Wipe the race but keep the clue up, leaving the buzzer shut. */
export function resetBuzzer(room) {
  resetBuzzerState(room)
  return [{ kind: "buzzer-reset" }]
}

/**
 * Give the clue back to everyone, including whoever has already missed it.
 *
 * Arming alone cannot do this: a player who has answered is `spent` for the
 * rest of the clue, so once everybody has had a go the buzzer could be opened
 * and still nobody could press it. This is the "go on then, one more try"
 * button — it clears the record of who is out and opens the buzzer in one
 * move, because doing it in two left a state where neither half worked.
 */
export function reopenBuzzer(room, now = Date.now()) {
  if (room.phase !== PHASE.CLUE || room.paused) return []
  if (room.wager) return [] // a nitro belongs to one side
  resetBuzzerState(room)
  room.buzzer.armed = true
  room.buzzer.opened = true
  room.buzzer.openedAt = now
  room.timer = null
  return [{ kind: "buzzer-reopen" }]
}

/** True when nobody left can press the button on this clue. */
export function everyoneSpent(room) {
  if (room.phase !== PHASE.CLUE || room.players.size === 0) return false
  return [...room.players.keys()].every((id) => room.buzzer.spent.includes(id))
}

function resetBuzzerState(room) {
  room.buzzer = { armed: false, opened: false, openedAt: 0, order: [], winner: null, winnerMs: null, lockedUntil: {}, spent: [] }
}

/**
 * A player pressed the button.
 *
 * Three ways this ends: you win the buzz, you're too late and land in the
 * order list behind someone, or you jumped the gun and eat a short lockout.
 * The last one is what stops a player from simply mashing the button from the
 * moment the clue appears.
 */
export function buzz(room, playerId, now = Date.now()) {
  const player = room.players.get(playerId)
  if (!player || room.phase !== PHASE.CLUE) return []
  // A frozen room takes no presses. The clue is still on screen and the button
  // is still under a thumb, so this has to be refused here rather than trusted
  // to every client remembering to grey itself out.
  if (room.paused) return []
  // Side, not seat. Five phones on one team is one entry in the race, one shot
  // at the clue and one lockout — otherwise the biggest team simply wins.
  if (sideIds(room, playerId).some((id) => room.buzzer.spent.includes(id))) return []
  if ((room.buzzer.lockedUntil[playerId] ?? 0) > now) return []
  if (room.buzzer.order.some((e) => sameSide(room, e.playerId, playerId))) return []

  // Never opened on this clue — this is a genuine jump, and it costs.
  if (!room.buzzer.opened) {
    room.buzzer.lockedUntil[playerId] = now + room.settings.earlyPenaltyMs
    return [{ kind: "buzz-early", playerId, until: room.buzzer.lockedUntil[playerId] }]
  }

  const ms = Math.max(0, now - room.buzzer.openedAt)

  // The gate is already shut: someone won, or the host locked it. Losing a race
  // by 60ms is not an offence and must not be punished like jumping the gun —
  // but only a press close behind the winner was ever in the race. Anything
  // later is someone fiddling while the host deliberates, and filing it with a
  // fifteen-second time makes the list of contenders useless.
  if (!room.buzzer.armed) {
    const contender = room.buzzer.winnerMs != null && ms - room.buzzer.winnerMs <= LATE_GRACE_MS
    if (!contender) return []
    room.buzzer.order.push({ playerId, ms })
    return [{ kind: "buzz-late", playerId, ms }]
  }

  room.buzzer.order.push({ playerId, ms })
  room.buzzer.winner = playerId
  room.buzzer.winnerMs = ms
  room.buzzer.armed = false
  if (room.settings.answerSeconds > 0) {
    room.timer = { kind: "answer", duration: room.settings.answerSeconds, endsAt: now + room.settings.answerSeconds * 1000 }
  }
  return [{ kind: "buzz-in", playerId, ms }]
}

/**
 * Host rules on the answer. `playerId` defaults to whoever holds the buzz, so
 * the common case is a single keypress.
 */
export function judge(room, correct, target = judgeTarget(room)) {
  if (room.phase !== PHASE.CLUE) return []
  // The ledger being credited, which in team mode is not the thing being
  // judged: a player buzzes, their team is paid.
  const unit = scorer(room, target)
  if (!unit) return []
  const playerId = room.players.has(target) ? target : null

  const amount = stake(room)

  // Everything a ruling touches, kept so it can be taken back. Hosts mis-tap
  // ✓ and ✕ constantly — they are two adjacent buttons pressed under pressure
  // while talking — and "fix it by hand afterwards" means editing a score, a
  // spent-player list and a clue's status separately, in front of an audience.
  room.lastJudgement = {
    target,
    playerId,
    correct,
    amount,
    score: unit.score,
    phase: room.phase,
    revealed: room.revealed,
    clueStatus: activeClue(room)?.status,
    active: room.active && { ...room.active },
    buzzer: cloneBuzzer(room.buzzer),
    timer: room.timer,
  }

  room.timer = null

  if (correct) {
    unit.score += amount
    record(unit, amount, room.wager ? "nitro" : "correct", clueLabel(room))
    room.buzzer.armed = false
    room.buzzer.winner = playerId
    room.phase = PHASE.REVEAL
    room.revealed = true
    markPlayed(room)
    return [{ kind: "correct", playerId, unitId: unit.id, amount, score: unit.score }]
  }

  if (room.settings.penaltyForWrong) {
    unit.score -= amount
    record(unit, -amount, "wrong", clueLabel(room))
  }
  // The whole side is out, not just the phone that answered — otherwise a team
  // works through its members until one of them guesses right.
  for (const id of spentSide(room, target)) if (!room.buzzer.spent.includes(id)) room.buzzer.spent.push(id)
  room.buzzer.winner = null

  const effects = [{ kind: "wrong", playerId, unitId: unit.id, amount, score: unit.score }]

  // A nitro is a solo bet — a miss ends the clue rather than reopening it.
  if (room.wager) {
    room.phase = PHASE.REVEAL
    room.revealed = true
    markPlayed(room)
    return effects
  }

  // Everyone else gets another shot, so re-open rather than closing out.
  const remaining = [...room.players.keys()].filter((id) => !room.buzzer.spent.includes(id))
  if (remaining.length) {
    room.buzzer.armed = true
    room.buzzer.opened = true
    room.buzzer.openedAt = Date.now()
    // Fresh race — see armBuzzer.
    room.buzzer.order = []
    room.buzzer.winnerMs = null
    effects.push({ kind: "buzzer-open", answerSeconds: room.settings.answerSeconds })
  } else {
    room.buzzer.armed = false
  }
  return effects
}

/**
 * Who a bare ✓/✕ applies to.
 *
 * Whoever holds the buzz, normally. On a team nitro there is no holder — the
 * clue belongs to the side and any of them may say it — so the wagering team
 * stands in, which is what makes a one-keypress ruling still work there.
 */
export const judgeTarget = (room) => room.buzzer.winner ?? room.wager?.teamId ?? room.wager?.playerId ?? null

/** Every seat that is out of the clue once this target has answered wrong. */
function spentSide(room, target) {
  if (room.players.has(target)) return sideIds(room, target)
  return room.settings.teams ? membersOf(room, target).map((p) => p.id) : []
}

/** A short "where did this come from", for the history. */
function clueLabel(room) {
  const clue = activeClue(room)
  if (!clue) return null
  const round = currentRound(room)
  const cat = round?.categories[room.active?.catIndex]?.title
  return cat ? `${cat} ${clue.value}` : String(clue.value)
}

const cloneBuzzer = (b) => ({ ...b, order: b.order.map((e) => ({ ...e })), lockedUntil: { ...b.lockedUntil }, spent: [...b.spent] })

/**
 * Take back the last ruling.
 *
 * Only ever one deep: a host who needs to unwind two judgements has lost track
 * of the game anyway, and a longer history would need the board's own state
 * versioned to be honest about what it was restoring.
 */
export function undoJudgement(room) {
  const last = room.lastJudgement
  if (!last) return []

  const unit = scorer(room, last.target ?? last.playerId)
  if (!unit) {
    room.lastJudgement = null
    return []
  }

  unit.score = last.score
  if (unit.history?.length) unit.history.pop()
  room.phase = last.phase
  room.revealed = last.revealed
  room.active = last.active
  room.buzzer = cloneBuzzer(last.buzzer)
  room.timer = last.timer
  const clue = activeClue(room)
  if (clue && last.clueStatus) clue.status = last.clueStatus
  room.lastJudgement = null

  return [{ kind: "undo", playerId: last.playerId, unitId: unit.id, correct: last.correct, score: unit.score }]
}

/** Show the answer without anyone getting it — "nobody? it was …". */
export function revealAnswer(room) {
  if (room.phase !== PHASE.CLUE && room.phase !== PHASE.WAGER) return []
  room.phase = PHASE.REVEAL
  room.revealed = true
  room.buzzer.armed = false
  room.timer = null
  markPlayed(room)
  return [{ kind: "reveal" }]
}

function markPlayed(room) {
  const clue = activeClue(room)
  if (clue) clue.status = CLUE_STATUS.PLAYED
}

/** Back to the grid. Rolls into the next round once the board is cleared. */
export function closeClue(room) {
  if (room.phase !== PHASE.CLUE && room.phase !== PHASE.REVEAL && room.phase !== PHASE.WAGER) return []
  markPlayed(room)
  room.active = null
  room.wager = null
  room.revealed = false
  room.timer = null
  room.lifeline = null
  resetBuzzerState(room)

  if (roundComplete(currentRound(room))) {
    const last = room.roundIndex >= room.board.rounds.length - 1
    room.phase = last ? PHASE.ENDED : PHASE.INTERMISSION
    return [{ kind: last ? "game-end" : "round-complete", roundIndex: room.roundIndex }]
  }

  room.phase = PHASE.BOARD
  return [{ kind: "clue-close" }]
}

export function nextRound(room) {
  if (room.roundIndex >= room.board.rounds.length - 1) {
    room.phase = PHASE.ENDED
    return [{ kind: "game-end" }]
  }
  room.roundIndex += 1
  room.phase = PHASE.BOARD
  room.active = null
  resetBuzzerState(room)
  return [{ kind: "round-start", roundIndex: room.roundIndex }]
}

export function adjustScore(room, id, delta) {
  const unit = scorer(room, id)
  if (!unit) return []
  const by = num(delta, 0)
  unit.score += by
  record(unit, by, "adjust")
  return [{ kind: "score", playerId: id, unitId: unit.id, score: unit.score }]
}

export function setScore(room, id, score) {
  const unit = scorer(room, id)
  if (!unit) return []
  const target = num(score, 0)
  const by = target - unit.score
  unit.score = target
  record(unit, by, "set")
  return [{ kind: "score", playerId: id, unitId: unit.id, score: unit.score }]
}

export function startTimer(room, seconds, kind = "read", now = Date.now()) {
  const s = Math.max(1, Math.min(num(seconds, 30), 600))
  room.timer = { kind, duration: s, endsAt: now + s * 1000 }
  return [{ kind: "timer-start", seconds: s }]
}

export function stopTimer(room) {
  room.timer = null
  return [{ kind: "timer-stop" }]
}

/**
 * Phone a friend. The clock is the point of the lifeline, so it takes over the
 * room's single timer slot and the buzzer stays shut until it's done.
 */
export function grantLifeline(room, playerId, type = "phone", now = Date.now()) {
  const player = room.players.get(playerId)
  const spec = LIFELINES[type]
  if (!player || !spec) return []
  // A team shares one purse, so five phones do not mean five phone calls.
  const purse = scorer(room, playerId) ?? player
  if ((purse.lifelines[type] ?? 0) <= 0) return []

  purse.lifelines[type] -= 1
  room.lifeline = { type, playerId, teamId: teamOf(room, playerId)?.id ?? null, endsAt: now + spec.seconds * 1000 }
  room.timer = { kind: "lifeline", duration: spec.seconds, endsAt: room.lifeline.endsAt }
  room.buzzer.armed = false
  return [{ kind: "lifeline-start", type, playerId, seconds: spec.seconds }]
}

export function endLifeline(room) {
  if (!room.lifeline) return []
  const { type, playerId } = room.lifeline
  room.lifeline = null
  if (room.timer?.kind === "lifeline") room.timer = null
  return [{ kind: "lifeline-end", type, playerId }]
}

/** Give a spent lifeline back — hosts make mistakes. */
export function restoreLifeline(room, playerId, type) {
  const purse = scorer(room, playerId)
  if (!purse || !LIFELINES[type]) return []
  purse.lifelines[type] = (purse.lifelines[type] ?? 0) + 1
  return [{ kind: "lifeline-restore", playerId, type }]
}

// ── Pause ────────────────────────────────────────────────────────────────────

/**
 * Freeze the room.
 *
 * Quizzes stop. Someone gets a drink, an argument breaks out over the last
 * answer, the pizza arrives. Without this the host's only options were to let a
 * clock run out on a clue nobody is looking at, or to close it and lose the
 * tile — so a running countdown is banked rather than cancelled, and comes back
 * with exactly the time it had left.
 */
export function pauseGame(room, now = Date.now()) {
  if (room.paused) return []
  room.paused = {
    at: now,
    // The deadline lives on the relay and is keyed off `room.timer`, so
    // clearing the timer is what actually stops the clock.
    timer: room.timer ? { ...room.timer, left: Math.max(0, room.timer.endsAt - now) } : null,
  }
  room.timer = null
  room.buzzer.armed = false
  return [{ kind: "paused" }]
}

export function resumeGame(room, now = Date.now()) {
  if (!room.paused) return []
  const held = room.paused.timer
  room.paused = null
  if (held) room.timer = { kind: held.kind, duration: held.duration, endsAt: now + held.left }
  return [{ kind: "resumed" }]
}

export function resetGame(room) {
  for (const round of room.board.rounds) {
    for (const cat of round.categories) for (const clue of cat.clues) clue.status = CLUE_STATUS.OPEN
  }
  for (const p of room.players.values()) {
    p.score = 0
    p.lifelines = { ...room.settings.lifelines }
    p.history = []
  }
  for (const t of room.teams.values()) {
    t.score = 0
    t.lifelines = { ...room.settings.lifelines }
    t.history = []
  }
  room.paused = null
  room.phase = PHASE.LOBBY
  room.roundIndex = 0
  room.active = null
  room.wager = null
  room.revealed = false
  room.timer = null
  room.lifeline = null
  resetBuzzerState(room)
  return [{ kind: "reset" }]
}

// ── The final round ──────────────────────────────────────────────────────────

/**
 * The last clue works nothing like the rest of the game, which is why it gets
 * its own machinery rather than another phase of the clue flow: everyone plays
 * at once, in writing, having committed a bet before seeing the question.
 *
 * Three stages, in the order the show does them:
 *
 *   wager  – the category is public, the clue is not, and each player stakes
 *            part of their score in secret.
 *   clue   – the prompt goes up and a clock runs. Answers are typed and locked.
 *   reveal – the host walks the answers one at a time, poorest player first,
 *            because a leader revealed early spoils the arithmetic for the room.
 */

/**
 * Nobody plays the final on a non-positive score — there is nothing to stake.
 *
 * A side, not a seat: in team mode the team bets once, writes once and is
 * turned over once, whichever member does the typing.
 */
export const finalEligible = (room) => sides(room).filter((u) => u.score > 0)

export function openFinal(room) {
  if (room.phase === PHASE.CLUE || room.phase === PHASE.WAGER) return []
  if (!room.board.final?.enabled) return []
  room.phase = PHASE.FINAL
  room.active = null
  room.timer = null
  room.lastJudgement = null
  resetBuzzerState(room)
  room.final = {
    stage: "wager",
    wagers: {},
    answers: {},
    order: [],
    revealIndex: 0,
    judged: {},
  }
  return [{ kind: "final-open" }]
}

/** A bet, placed blind. Capped at what the side actually has to lose. */
export function setFinalWager(room, playerId, amount) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "wager") return []
  const unit = scorer(room, playerId)
  if (!unit || unit.score <= 0) return []
  const capped = Math.max(0, Math.min(num(amount, 0), unit.score))
  room.final.wagers[unit.id] = capped
  return [{ kind: "final-wager", playerId, unitId: unit.id }]
}

export function startFinal(room, now = Date.now()) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "wager") return []
  // Anyone who never bet is treated as having staked nothing, so one player
  // looking at their phone cannot hold the whole room up.
  for (const u of finalEligible(room)) room.final.wagers[u.id] ??= 0
  room.final.stage = "clue"
  const seconds = room.board.final.seconds || 30
  room.timer = { kind: "final", duration: seconds, endsAt: now + seconds * 1000 }
  return [{ kind: "final-start", seconds }]
}

/**
 * The written answer. One per side — in team mode whoever types last speaks for
 * the team, which is the same thing that happens with a pen and one answer slip.
 */
export function setFinalAnswer(room, playerId, text) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "clue") return []
  const unit = scorer(room, playerId)
  if (!unit || unit.score <= 0) return []
  if (room.final.answers[unit.id]?.locked) return []
  room.final.answers[unit.id] = { text: str(text, 200), at: Date.now(), locked: false, by: playerId }
  return [{ kind: "final-answer", playerId, unitId: unit.id }]
}

/** Time is up, or the host called it. Nothing more is accepted after this. */
export function lockFinal(room) {
  if (room.phase !== PHASE.FINAL) return []
  for (const a of Object.values(room.final.answers)) a.locked = true
  room.timer = null
  return [{ kind: "final-locked" }]
}

export function revealFinal(room) {
  if (room.phase !== PHASE.FINAL || room.final?.stage === "reveal") return []
  lockFinal(room)
  room.final.stage = "reveal"
  // Poorest first: revealing the leader early tells everyone the result before
  // the rest have had their moment.
  room.final.order = finalEligible(room)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .map((u) => u.id)
  room.final.revealIndex = 0
  return [{ kind: "final-reveal", playerId: room.final.order[0] ?? null }]
}

/** Rule on whoever is currently up, pay or dock the bet, and move along. */
export function judgeFinal(room, correct) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "reveal") return []
  const unitId = room.final.order[room.final.revealIndex]
  const unit = unitId && scorer(room, unitId)
  if (!unit) return []

  const wager = room.final.wagers[unitId] ?? 0
  unit.score += correct ? wager : -wager
  record(unit, correct ? wager : -wager, correct ? "final-correct" : "final-wrong", "Final")
  room.final.judged[unitId] = correct

  const effects = [{ kind: correct ? "final-correct" : "final-wrong", playerId: unitId, unitId, wager, score: unit.score }]

  if (room.final.revealIndex >= room.final.order.length - 1) {
    room.phase = PHASE.ENDED
    effects.push({ kind: "game-end" })
  } else {
    room.final.revealIndex += 1
    effects.push({ kind: "final-reveal", playerId: room.final.order[room.final.revealIndex] })
  }
  return effects
}

// ── Save / resume ────────────────────────────────────────────────────────────

/**
 * A room, frozen for later.
 *
 * Transient state is deliberately left out: the buzzer race, any running
 * countdown, an in-flight lifeline. A game picked up three days later resumes
 * at rest, not with a clock that expired on Tuesday. What survives is what
 * people would argue about — the board with its spent tiles, who was playing,
 * and what they had scored.
 */
export function snapshotRoom(room) {
  return {
    code: room.code,
    ownerId: room.ownerId ?? null,
    title: room.board.title,
    board: room.board,
    settings: room.settings,
    phase: room.phase === PHASE.CLUE || room.phase === PHASE.WAGER || room.phase === PHASE.REVEAL ? PHASE.BOARD : room.phase,
    roundIndex: room.roundIndex,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      teamId: p.teamId,
      lifelines: { ...p.lifelines },
      history: p.history ?? [],
    })),
    // Saved whether or not team mode is on, so turning it back off for a night
    // and on again the next does not lose the sides people were put into.
    teams: [...room.teams.values()].map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      score: t.score,
      lifelines: { ...t.lifelines },
      history: t.history ?? [],
    })),
    savedAt: Date.now(),
  }
}

/** Rebuild a room from a snapshot. Unknown or missing fields fall back to a new game. */
export function restoreRoom(code, snapshot) {
  const room = createRoom(code, snapshot?.settings ?? {})
  if (!snapshot) return room

  room.board = normaliseBoard(snapshot.board)
  room.roundIndex = Math.max(0, Math.min(num(snapshot.roundIndex, 0), room.board.rounds.length - 1))
  room.phase = Object.values(PHASE).includes(snapshot.phase) ? snapshot.phase : PHASE.LOBBY
  // Never resume into a clue: `snapshotRoom` refuses to save one, but a
  // hand-edited or older snapshot must not be able to strand the display on a
  // clue the room has no memory of.
  if (room.phase === PHASE.CLUE || room.phase === PHASE.WAGER || room.phase === PHASE.REVEAL) room.phase = PHASE.BOARD

  for (const t of snapshot.teams ?? []) {
    if (!t?.id) continue
    const team = makeTeam(String(t.id), str(t.name, 20) || "Team", room.teams.size)
    if (typeof t.color === "string") team.color = t.color.slice(0, 24)
    team.score = num(t.score, 0)
    team.lifelines = { ...room.settings.lifelines, ...(t.lifelines ?? {}) }
    team.history = Array.isArray(t.history) ? t.history.slice(-HISTORY_LIMIT) : []
    room.teams.set(team.id, team)
  }

  for (const p of snapshot.players ?? []) {
    if (!p?.id) continue
    const player = makePlayer(String(p.id), str(p.name, 16) || "Player")
    player.score = num(p.score, 0)
    player.teamId = typeof p.teamId === "string" && room.teams.has(p.teamId) ? p.teamId : null
    player.lifelines = { ...room.settings.lifelines, ...(p.lifelines ?? {}) }
    player.history = Array.isArray(p.history) ? p.history.slice(-HISTORY_LIMIT) : []
    // Nobody is connected yet — their phones have to rejoin.
    player.connected = false
    room.players.set(player.id, player)
  }
  return room
}

// ── Projection ───────────────────────────────────────────────────────────────

/**
 * What each role is allowed to see.
 *
 * The display is a TV in the same room as the players and `/play` is running on
 * their own phones — so answers are stripped from both until the host reveals
 * them. Anyone can open devtools; the fix is to not send the secret, not to
 * hide it in CSS.
 */
export function projectState(room, role, viewerId = null) {
  const privileged = role === "host" || role === "controller"
  const round = currentRound(room)
  const active = activeClue(room)

  const board = {
    id: room.board.id,
    title: room.board.title,
    roundCount: room.board.rounds.length,
    round: round && {
      name: round.name,
      values: round.values,
      categories: round.categories.map((cat) => ({
        id: cat.id,
        title: cat.title,
        clues: cat.clues.map((clue) => ({
          id: clue.id,
          value: clue.value,
          status: clue.status,
          // A tile that hasn't been played must not leak its contents.
          ...(privileged ? { prompt: clue.prompt, answer: clue.answer, media: clue.media, nitro: clue.nitro } : {}),
        })),
      })),
    },
  }

  const showAnswer = privileged || room.revealed
  /*
    Whether a phone gets the words at all.

    The host's setting is enforced here rather than in the player UI, so
    "off" means the clue was never sent — not that it is one devtools panel
    away. The category and the value still go, because a phone that shows
    nothing at all looks broken; and the big screen is unaffected, since it is
    the thing everyone is supposed to be reading.

    The final is deliberately exempt: it is played *on* the phones, by writing
    an answer, so withholding the clue there would not hide it — it would end
    the round. See `projectFinal`.
  */
  const mirrored = privileged || role !== "player" || room.settings.mirrorClue !== false
  const hidden = !mirrored || (room.phase === PHASE.WAGER && !privileged)
  const clue = active && {
    id: active.id,
    value: active.value,
    prompt: hidden ? "" : active.prompt,
    media: hidden ? null : active.media,
    nitro: active.nitro,
    answer: showAnswer && mirrored ? active.answer : null,
    answerMedia: showAnswer && mirrored ? active.answerMedia : null,
    catIndex: room.active.catIndex,
    clueIndex: room.active.clueIndex,
    category: round?.categories[room.active.catIndex]?.title ?? "",
  }

  /*
    The viewer's own side. A player's phone needs this to find itself in the
    final — where entries are keyed by whoever is being paid, which in team mode
    is not the id the phone knows itself by.
  */
  const unitId = viewerId ? (scorer(room, viewerId)?.id ?? viewerId) : null

  return {
    code: room.code,
    serverNow: Date.now(),
    paused: !!room.paused,
    music: !!room.music,
    unit: unitId,
    // The whole board, every round, unredacted — host and controller only. The
    // builder needs this to adopt a resumed game's board, which it cannot
    // rebuild from the projection above (that carries the current round alone).
    rawBoard: privileged ? room.board : undefined,
    phase: room.phase,
    roundIndex: room.roundIndex,
    settings: room.settings,
    board,
    clue,
    stake: stake(room),
    canUndo: privileged && !!room.lastJudgement,
    everyoneSpent: everyoneSpent(room),
    final: projectFinal(room, privileged, viewerId),
    wager: room.wager,
    revealed: room.revealed,
    timer: room.timer,
    lifeline: room.lifeline,
    buzzer: {
      armed: room.buzzer.armed,
      openedAt: room.buzzer.openedAt,
      winner: room.buzzer.winner,
      spent: room.buzzer.spent,
      // Margins behind the winner read better than absolute times: "+40ms" is
      // the thing being adjudicated, "1240ms" is trivia about the host's pace.
      order: room.buzzer.order.map((e) => ({ ...e, behind: room.buzzer.winnerMs == null ? 0 : e.ms - room.buzzer.winnerMs })),
      lockedUntil: room.buzzer.lockedUntil,
    },
    /*
      Sides, when they are on. Shaped like a player row on purpose: every screen
      that shows a scoreboard can render `state.teams ?? state.players` and be
      right either way, instead of growing a second layout for team night.
    */
    teams: room.settings.teams
      ? [...room.teams.values()]
          .map((t) => {
            const members = membersOf(room, t.id)
            return {
              id: t.id,
              name: t.name,
              color: t.color,
              score: t.score,
              // A team is "here" while any one of its phones is.
              connected: members.some((p) => p.connected),
              lifelines: t.lifelines,
              members: members.map((p) => p.id),
              memberNames: members.map((p) => p.name),
              history: (t.history ?? []).slice(-12),
            }
          })
          .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      : null,
    players: [...room.players.values()]
      .map((p) => {
        // The score a player is playing for, which in team mode is the team's.
        // Their own frozen tally is of no use to anyone on the night.
        const unit = scorer(room, p.id) ?? p
        return {
          id: p.id,
          name: p.name,
          teamId: room.settings.teams ? (p.teamId ?? null) : null,
          score: unit.score,
          connected: p.connected,
          lifelines: unit.lifelines,
          // The working behind the total. Everyone can see it — it is a
          // scoreboard, not a secret — but it is trimmed for the wire.
          history: (unit.history ?? []).slice(-12),
        }
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  }
}

/**
 * What each role may know about the final clue.
 *
 * A wager is a blind bet — showing one player another's before the reveal
 * hands them the whole strategy. An answer belongs to whoever wrote it until
 * the host turns it over. Both are therefore projected per viewer, not per
 * role, which is why this needs the player's own id.
 */
function projectFinal(room, privileged, viewerId) {
  const spec = room.board.final
  if (!spec?.enabled) return null

  const base = {
    enabled: true,
    category: spec.category,
    seconds: spec.seconds,
    stage: room.final?.stage ?? null,
  }
  if (!room.final) return base

  const showClue = privileged || room.final.stage === "clue" || room.final.stage === "reveal"
  const revealedIds = room.final.order.slice(0, room.final.revealIndex + 1)
  const isUp = (id) => room.final.stage === "reveal" && revealedIds.includes(id)

  return {
    ...base,
    prompt: showClue ? spec.prompt : "",
    media: showClue ? spec.media : null,
    // The answer waits for the reveal even on the big screen — it is the last
    // secret in the game and the room is looking straight at it.
    answer: privileged || room.final.stage === "reveal" ? spec.answer : null,
    answerMedia: privileged || room.final.stage === "reveal" ? spec.answerMedia : null,
    revealIndex: room.final.revealIndex,
    order: room.final.order,
    /** Who is being turned over right now. */
    current: room.final.order[room.final.revealIndex] ?? null,
    // Sides, not seats — see `finalEligible`. A teammate counts as "mine", so
    // everyone on a team can see the bet and the answer being written for them.
    players: sides(room)
      .filter((u) => u.score > 0 || room.final.wagers[u.id] != null)
      .map((u) => {
        const mine = u.id === (viewerId ? (scorer(room, viewerId)?.id ?? viewerId) : null)
        const open = privileged || isUp(u.id)
        return {
          id: u.id,
          name: u.name,
          score: u.score,
          color: u.color ?? null,
          // "They have bet" is public; the number is not.
          wagered: room.final.wagers[u.id] != null,
          answered: !!room.final.answers[u.id]?.text,
          wager: open || mine ? (room.final.wagers[u.id] ?? null) : null,
          answer: open || mine ? (room.final.answers[u.id]?.text ?? "") : null,
          judged: room.final.judged[u.id] ?? null,
        }
      }),
  }
}
