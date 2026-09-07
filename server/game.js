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
  SURVEY: "survey", // "we asked a hundred people" — a board of hidden answers
  TIEBREAK: "tiebreak", // level at the top: sudden death, buzzer, no points
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
   * Judge the race on reaction time rather than on arrival time.
   *
   * Off by default, because it changes what "first" means and a host should
   * opt into that knowingly. See the Lag section.
   */
  pingCorrection: false,
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
  /**
   * Streamer mode: keep the room code off the screens a camera can see.
   *
   * A game on a stream has a join code readable by everybody watching, and a QR
   * that is *more* scannable on a stream than in the room — a viewer can pause
   * the video and take their time over it. Both come off the big screen, the
   * scoreboard and the podiums; the host desk, the cue cards and the controller
   * keep showing the code, because the people driving still need it.
   *
   * The code is withheld in `projectState` rather than hidden in CSS. An
   * overlay is not a redaction: a broadcaster capturing a browser source can
   * inspect it, a screenshot tool can read what is merely transparent, and the
   * next component to render `state.code` would leak it again. Not sending it
   * is the only version that stays true.
   *
   * What it does not do is stop someone already in the room reading it over a
   * shoulder, and it cannot: the display's own URL still carries the code, and
   * so it must, or the page could not have joined. This hides the code from the
   * *stream*, which is the threat it is named for.
   */
  streamer: false,
}

/**
 * Team colours, in the order they are handed out.
 *
 * Named rather than free-form because they have to read from the back of a room
 * on a projector — these are all light enough to sit on the marble and far
 * enough apart to tell at a glance.
 */
export const TEAM_PALETTE = ["#f2c96b", "#7ad1a8", "#8fb8ff", "#e08ac0", "#f09a5a", "#a86ce0", "#6fd6e0", "#d6d36a"]

/**
 * The floor under any bet, whatever the scoreboard says.
 *
 * Both wagers in the game use it. Without a floor the two mechanics meant to
 * let somebody catch up — the nitro and the final — were smallest exactly when
 * a player most needed them, and a side on nothing could not use either at all.
 */
const WAGER_FLOOR = 1000

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

// ── Lag ──────────────────────────────────────────────────────────────────────

/**
 * Correcting for the connection, when the host asks for it.
 *
 * A press arrives at the relay having made a full round trip: the buzzer opened
 * at T, the player did not *see* it open until T + downstream, they reacted,
 * and the press then took upstream to come back. So the arrival time is
 * `reaction + rtt`, and someone on hotel wifi at 300ms is racing someone on the
 * router at 30ms with a 270ms head start against them. That is not a quiz, it
 * is a broadband test.
 *
 * Subtracting each player's own round trip compares reactions instead. Two
 * things make it honest:
 *
 * - **The relay measures the lag itself**, with protocol-level pings — see
 *   `server/index.js`. The number a phone reports about itself is never used
 *   here, because a client that could claim to be slow would learn to.
 * - **The credit is capped.** Someone genuinely on 2s is not going to have a
 *   fair race whatever we do, and an uncapped credit would hand them the win
 *   for pressing a second late.
 *
 * It cannot be made perfect. Latency is not constant, and a player who stalls
 * their own connection can still buy some credit. It is a party correction, not
 * a tournament one.
 */
const LAG_CREDIT_CAP_MS = 500

/**
 * How long a race is held open once someone presses.
 *
 * The catch with correcting: the fast player's press *arrives* first even when
 * the slow player pressed first. Awarding the buzz on arrival would undo the
 * whole correction, so the race stays open briefly — long enough that a press
 * which deserves to win can still get there.
 */
const SETTLE_CAP_MS = 400

/** A player's measured round trip, capped. 0 when nothing has been measured. */
function lagOf(room, playerId) {
  if (!room.settings.pingCorrection) return 0
  const lag = room.players.get(playerId)?.lag
  return Number.isFinite(lag) ? Math.min(Math.max(0, lag), LAG_CREDIT_CAP_MS) : 0
}

/** How long to hold the race open: the worst connection in the room, capped. */
export function settleWindow(room) {
  if (!room.settings.pingCorrection) return 0
  let worst = 0
  for (const p of room.players.values()) {
    if (!p.connected || !Number.isFinite(p.lag)) continue
    worst = Math.max(worst, Math.min(p.lag, LAG_CREDIT_CAP_MS))
  }
  return Math.min(worst, SETTLE_CAP_MS)
}

/** Lowest corrected time wins; a dead heat falls back to who actually arrived. */
const byCorrected = (a, b) => a.adjusted - b.adjusted || a.ms - b.ms

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

/**
 * "We asked a hundred people" — its own round, after everything else.
 *
 * A board of hidden answers with points on them, a buzzer race for the right to
 * guess, and a strike when you are wrong. It comes *last*, after the final and
 * after any tie-break, because it is a scramble rather than a reckoning: a
 * blind wager cannot rescue somebody 2000 behind, and eight answers on a board
 * can, so it is the round that keeps a decided game alive to the end.
 *
 * The answers can be written by hand or built from what real people said — see
 * `tallyResponses`. That is the whole conceit of the format, and the reason the
 * survey link exists.
 */
export const MAX_SURVEY_QUESTIONS = 5

export function makeSurveyQuestion() {
  return { id: uid("sq"), category: "", prompt: "", answers: [] }
}

export function makeSurvey() {
  return { enabled: false, collecting: true, questions: [makeSurveyQuestion()] }
}

/**
 * The one kept back in case the final leaves two people level.
 *
 * Not a round and not scored — it exists to answer "who won", which is the one
 * question a quiz has to answer and the one a tie leaves open. Optional: with
 * nothing written the host can still run the buzzer and read something out.
 */
export function makeTiebreak() {
  return { prompt: "", media: null, answer: "", answerMedia: null }
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
    survey: makeSurvey(),
    tiebreak: makeTiebreak(),
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

  board.survey = {
    enabled: !!raw.survey?.enabled,
    collecting: raw.survey?.collecting !== false,
    questions: (Array.isArray(raw.survey?.questions) ? raw.survey.questions : []).slice(0, MAX_SURVEY_QUESTIONS).map((q) => ({
      id: typeof q?.id === "string" ? q.id : uid("sq"),
      category: str(q?.category, 60),
      prompt: str(q?.prompt, 600),
      answers: (Array.isArray(q?.answers) ? q.answers : []).slice(0, 10).map((a) => ({
        text: str(a?.text, 80),
        points: Math.max(0, num(a?.points, 0)),
      })),
    })),
  }

  board.final = {
    category: str(raw.final?.category, 60),
    prompt: str(raw.final?.prompt, 600),
    media: media(raw.final?.media),
    answer: str(raw.final?.answer, 300),
    answerMedia: media(raw.final?.answerMedia),
    seconds: Math.max(5, Math.min(num(raw.final?.seconds, 30), 600)),
    enabled: !!raw.final?.enabled,
  }

  board.tiebreak = {
    prompt: str(raw.tiebreak?.prompt, 600),
    media: media(raw.tiebreak?.media),
    answer: str(raw.tiebreak?.answer, 300),
    answerMedia: media(raw.tiebreak?.answerMedia),
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
    /**
     * Who is currently driving, keyed by connection.
     *
     * A host desk, a set of cue cards and a controller are three screens with
     * the same authority, and until now none of them could see the others. Two
     * people arm the buzzer within a second of each other, both assume it did
     * not work, and lock it again between them. Filled in by the relay, which
     * is the only thing that knows about sockets.
     */
    operators: new Map(),
    /** The last thing an operator did, so the other screens can see it. */
    lastAction: null,
    /** { revealed, awards, strikes, said } while the survey round runs. */
    survey: null,
    /** What the public survey link has collected. See `addResponse`. */
    responses: [],
    /** { contenders, spent } while a tie is being played off. */
    tiebreak: null,
    /**
     * Which of the end-game rounds have been played.
     *
     * Needed because "has it happened yet" is not answerable from the phase: a
     * game sits in `ended` both before the final and after it. See `pending`.
     */
    played: { final: false, survey: false },
    /**
     * Sides that have won a seat in the survey on a play-off.
     *
     * Kept apart from the scores because that is exactly what it is: a seat
     * earned by answering, not by being ahead. Two sides level at the cut are
     * still level after one of them wins the run-off, and the scoreboard must
     * keep saying so.
     */
    qualified: [],
    /** Who actually won, once a tie has been settled. See `openTiebreak`. */
    winner: null,
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
      /** Epoch by which the corrected race is decided. See `settleWindow`. */
      settleUntil: null,
    },
    /** { openedAt, hits } while the host is testing the buzzers. */
    check: null,
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

/**
 * Biggest wager a side may make on a nitro.
 *
 * The same shape as the final's: a floor everybody gets, and above it the
 * *magnitude* of your score. Two things changed from the old rule, and both
 * were the same oversight.
 *
 * The old floor was the round's top tile, which on a board of 200s left a
 * player on nothing risking 200 on the one clue designed to swing a game —
 * technically a bet, practically a formality. And the old cap was `score`
 * rather than `|score|`, so being in the red gave you the floor and no more:
 * the further behind you fell, the less the catch-up mechanic could catch you
 * up. The board's top tile is still the floor when it is the bigger number, so
 * a high-value round is unaffected.
 */
export function maxWager(room, id) {
  const round = currentRound(room)
  const top = Math.max(...(round?.values ?? []), 0)
  const score = scorer(room, id)?.score ?? 0
  return Math.max(WAGER_FLOOR, top, Math.abs(score))
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
  // Whatever the host was testing, they are done testing it.
  room.check = null
  return [{ kind: "game-start" }]
}

// ── Sound-checking the buzzers ───────────────────────────────────────────────

/**
 * Prove every phone works before the first clue.
 *
 * "Is everyone in?" and "does everyone's button actually reach the relay?" are
 * different questions, and only the first was answerable — a phone can be sat
 * in the lobby with a seat and a name and still be on a dead socket, a locked
 * screen, or an in-app browser that swallows the press. That is discovered on
 * clue one, in front of everybody, which is the worst possible moment.
 *
 * A test press is deliberately inert: it is not a race entry, nothing scores,
 * nobody is spent, and it works *outside* a clue precisely because that is when
 * you want to check. All it records is that the press arrived.
 */
export function startCheck(room, now = Date.now()) {
  if (room.phase === PHASE.CLUE || room.phase === PHASE.WAGER || room.phase === PHASE.REVEAL || room.phase === PHASE.FINAL) return []
  room.check = { openedAt: now, hits: {} }
  return [{ kind: "check-start" }]
}

export function stopCheck(room) {
  if (!room.check) return []
  room.check = null
  return [{ kind: "check-stop" }]
}

/**
 * Who got there first in the sound check, and by how much.
 *
 * Ranked exactly as a real race would be — including the lag credit when ping
 * correction is on — because a check that ranked on raw arrival would tell the
 * host the opposite of what the game is about to do, and they would find that
 * out on the first clue that mattered. `ms` is what the relay saw, `adjusted`
 * is what it would judge on, and `behind` is the gap to the winner, which is
 * the only number anyone actually reads.
 *
 * A press is not a race entry and scores nothing. This is the same ordering
 * applied to a rehearsal, so the rehearsal is worth something.
 */
export function checkOrder(room) {
  if (!room.check) return []
  const pressed = Object.entries(room.check.hits).map(([id, hit]) => ({
    id,
    ms: hit.at - room.check.openedAt,
    adjusted: hit.at - room.check.openedAt - lagOf(room, id),
    count: hit.count,
  }))
  pressed.sort(byCorrected)
  const first = pressed[0]?.adjusted ?? 0
  return pressed.map((p, i) => ({ ...p, place: i + 1, behind: Math.max(0, Math.round(p.adjusted - first)) }))
}

export function checkBuzz(room, playerId, now = Date.now()) {
  if (!room.check || !room.players.has(playerId)) return []
  const prev = room.check.hits[playerId]
  room.check.hits[playerId] = { at: now, count: (prev?.count ?? 0) + 1 }
  // First press is the news; the rest are someone enjoying the button.
  return prev ? [] : [{ kind: "check-hit", playerId }]
}

/** Everyone seated has pressed at least once. */
export function checkComplete(room) {
  if (!room.check || room.players.size === 0) return false
  return [...room.players.keys()].every((id) => room.check.hits[id])
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
  // and would be wrong to hand to this one — and a test left running would
  // swallow every press of the clue that just went up.
  room.paused = null
  room.check = null
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
  // Sudden death and the survey round race on the same buzzer; only who may
  // press it, and what they win, differs.
  const races = room.phase === PHASE.CLUE || room.phase === PHASE.TIEBREAK || room.phase === PHASE.SURVEY
  if (!races || room.paused) return []
  if (room.wager) return [] // a nitro belongs to one side: no race to run
  room.buzzer.armed = true
  room.buzzer.opened = true
  room.buzzer.openedAt = now
  room.buzzer.winner = null
  room.buzzer.winnerMs = null
  // Each arming is its own race. Leaving the previous order in place would bar
  // anyone already in it from pressing again.
  room.buzzer.order = []
  room.buzzer.settleUntil = null
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
  room.buzzer = { armed: false, opened: false, openedAt: 0, order: [], winner: null, winnerMs: null, lockedUntil: {}, spent: [], settleUntil: null }
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
  // A sound-check press goes nowhere near the race. See `startCheck`.
  if (room.check) return checkBuzz(room, playerId, now)

  const player = room.players.get(playerId)
  if (!player) return []
  if (room.phase === PHASE.TIEBREAK) {
    // Everyone else is watching. A buzzer that still worked for them would
    // decide the game by accident.
    if (!inTiebreak(room, playerId)) return []
  } else if (room.phase === PHASE.SURVEY) {
    // The survey is a two-hander. Same reasoning as the play-off: a phone that
    // still worked for a knocked-out side would win points in a round it is
    // not in.
    if (!inSurvey(room, playerId)) return []
  } else if (room.phase !== PHASE.CLUE) return []
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
  // What the press is judged on. Without correction these are the same number.
  const adjusted = Math.max(0, ms - lagOf(room, playerId))

  // The gate is already shut: someone won, or the host locked it. Losing a race
  // by 60ms is not an offence and must not be punished like jumping the gun —
  // but only a press close behind the winner was ever in the race. Anything
  // later is someone fiddling while the host deliberates, and filing it with a
  // fifteen-second time makes the list of contenders useless.
  if (!room.buzzer.armed) {
    const contender = room.buzzer.winnerMs != null && adjusted - room.buzzer.winnerMs <= LATE_GRACE_MS
    if (!contender) return []
    room.buzzer.order.push({ playerId, ms, adjusted })
    return [{ kind: "buzz-late", playerId, ms: adjusted }]
  }

  room.buzzer.order.push({ playerId, ms, adjusted })

  /*
    With correction on, the first press to *arrive* is not necessarily the
    winner, so the race stays open for a moment. The buzzer remains armed —
    everyone else can still get in — and `resolveBuzz` picks the best corrected
    time when the window closes.
  */
  const settle = settleWindow(room)
  if (settle > 0) {
    if (!room.buzzer.settleUntil) room.buzzer.settleUntil = now + settle
    return [{ kind: "buzz-pending", playerId, ms: adjusted }]
  }

  return award(room, { playerId, ms: adjusted }, now)
}

/** Hand the floor to a press and start the answer clock. */
function award(room, best, now) {
  room.buzzer.winner = best.playerId
  room.buzzer.winnerMs = best.ms
  room.buzzer.armed = false
  room.buzzer.settleUntil = null
  if (room.settings.answerSeconds > 0) {
    room.timer = { kind: "answer", duration: room.settings.answerSeconds, endsAt: now + room.settings.answerSeconds * 1000 }
  }
  return [{ kind: "buzz-in", playerId: best.playerId, ms: best.ms }]
}

/**
 * Close a corrected race and declare the winner.
 *
 * Called by the relay when the settling window expires. The order is re-sorted
 * by corrected time so the host's list of contenders shows the finish that was
 * actually judged, rather than the order the packets happened to arrive in.
 */
export function resolveBuzz(room, now = Date.now()) {
  if (!room.buzzer.settleUntil) return []
  room.buzzer.settleUntil = null
  if (room.phase !== PHASE.CLUE || !room.buzzer.order.length) return []

  room.buzzer.order.sort(byCorrected)
  const best = room.buzzer.order[0]
  return award(room, { playerId: best.playerId, ms: best.adjusted }, now)
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
    room.buzzer.settleUntil = null
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
  // Sudden death has an answer to turn over too, but no tile to mark played and
  // no phase to move on to — it is not over until somebody has taken it.
  if (room.phase === PHASE.TIEBREAK) {
    room.revealed = true
    room.buzzer.armed = false
    room.timer = null
    return [{ kind: "reveal" }]
  }
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

/**
 * What is still owed, in the order it is owed.
 *
 * The running order is a rule, and it used to live nowhere: the engine let any
 * of these open at any time and the *desk* decided which button to show, so
 * the order was whatever two screens happened to agree on. That produced three
 * wrong games. The final could be opened at the first intermission, skipping
 * every round after it. Once the last round finished the phase went straight to
 * `ended`, where the desk's "Play the final" button was not rendered at all —
 * so the compulsory round became unreachable from the host's own screen. And a
 * tie-break was offered before the survey, which settles a tie using scores the
 * survey is about to change.
 *
 * One function now answers "what next", and every screen and guard reads it.
 *
 *   rounds → final (if enabled) → survey (if enabled) → tie-break (if level)
 *
 * The final is compulsory when the board has one: it does not matter that the
 * leader is out of reach on paper, because the show plays it anyway and a
 * player on a negative score is still owed the chance to be turned over.
 * `null` here means nothing is owed and the game may end — which is the only
 * moment a tie is worth breaking, because it is the only moment the scores are
 * final.
 */
export function pending(room) {
  if (room.board.final?.enabled && !room.played?.final) return "final"
  if (room.board.survey?.enabled && !room.played?.survey) {
    // A seat in the survey has to be settled before the survey can start.
    return surveyCut(room).contested.length ? "tiebreak-cut" : "survey"
  }
  return null
}

/** How many sides the survey round is played by. */
export const SURVEY_SEATS = 2

/**
 * Who goes through to the survey, and who has to play for it.
 *
 * The survey is a two-hander, so the final is also a cut. That makes a tie at
 * the *boundary* matter in a way a tie anywhere else does not: level at the top
 * is a question for the end of the night, but level for the last seat has to be
 * answered before the round can start at all.
 *
 * `contested` is the run-off field. It awards one seat at a time and is meant
 * to be asked again — three sides level for two seats needs two play-offs, and
 * looping here is simpler and more correct than trying to seat them all at once.
 */
export function surveyCut(room) {
  const all = sides(room)
  const none = { through: all.map((u) => u.id), contested: [], seats: 0 }
  if (all.length <= SURVEY_SEATS) return none

  // Seats already won in a run-off are not up for grabs again.
  const won = room.qualified.filter((id) => all.some((u) => u.id === id))
  const seats = SURVEY_SEATS - won.length
  if (seats <= 0) return { through: won, contested: [], seats: 0 }

  const rest = all.filter((u) => !won.includes(u.id)).sort((a, b) => b.score - a.score)
  const cutScore = rest[seats - 1]?.score
  const above = rest.filter((u) => u.score > cutScore).map((u) => u.id)
  const atCut = rest.filter((u) => u.score === cutScore).map((u) => u.id)
  const left = seats - above.length

  if (atCut.length > left) return { through: [...won, ...above], contested: atCut, seats: left }
  return { through: [...won, ...above, ...atCut], contested: [], seats: 0 }
}

/**
 * The standing the game is decided on, which changes once a survey is played.
 *
 * Before it, the quiz score across every side. After it, the *survey* points of
 * the two sides who played the survey — because that is what the round is for.
 * Two things follow, and both are the point rather than side effects: a side
 * knocked out at the cut cannot finish level with the winner of a round it
 * never took part in, and a big quiz lead does not carry into a round designed
 * to be winnable from behind.
 */
export function standing(room) {
  const all = sides(room)
  const seats = room.played?.survey ? room.survey?.contenders : null
  if (!seats?.length) return all.map((u) => ({ unit: u, value: u.score }))
  const points = room.survey?.points ?? {}
  const kept = all.filter((u) => seats.includes(u.id))
  const pool = kept.length ? kept : all
  return pool.map((u) => ({ unit: u, value: points[u.id] ?? 0 }))
}

/** Whether there is another round of the board still to play. */
const moreRounds = (room) => room.roundIndex < room.board.rounds.length - 1

/**
 * The board is finished, whatever the phase says.
 *
 * A game with an end-game round still owed sits in `intermission` rather than
 * `ended` — deliberately, so the game-over cue does not fire over a room with
 * the last clue to play. But that left everything gated on `ended` unreachable
 * on a board whose only end-game round *is* the survey: the play-off for the
 * cut refused to open and the survey was never offered, both because the game
 * had correctly declined to call itself over.
 */
const boardDone = (room) => room.phase === PHASE.ENDED || (room.phase === PHASE.INTERMISSION && !moreRounds(room))

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
    /*
      The board being finished is not the game being over — not while a final
      or a survey is still owed. Going to `ended` here fired the game-over
      cue over a room that still had the last clue to play, and left the desk
      showing a winner it was about to change its mind about.
    */
    const done = !moreRounds(room) && !pending(room)
    room.phase = done ? PHASE.ENDED : PHASE.INTERMISSION
    return [{ kind: done ? "game-end" : "round-complete", roundIndex: room.roundIndex }]
  }

  room.phase = PHASE.BOARD
  return [{ kind: "clue-close" }]
}

export function nextRound(room) {
  if (!moreRounds(room)) {
    // Out of board, but not necessarily out of game. Refusing rather than
    // ending is what stops "next round" being a way to skip the final.
    if (pending(room)) return []
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
  room.check = null
  room.survey = null
  room.tiebreak = null
  room.winner = null
  room.played = { final: false, survey: false }
  room.qualified = []
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
/**
 * The largest bet a side may place.
 *
 * A floor of a thousand, and above that your own score. The floor is the whole
 * point: a player on nothing — or on minus four hundred after a bad round —
 * previously had nothing to stake and so was not in the final at all, which
 * ends their night one round early while everyone else plays. Giving them a
 * thousand to bet keeps them in it and keeps them able to win it, which is what
 * a last round is for.
 *
 * The magnitude is what matters, not the sign: a side on -2500 may stake up to
 * 2500. They are already behind, and a cautious cap would only make being
 * behind permanent.
 */
export const maxFinalWager = (score) => Math.max(WAGER_FLOOR, Math.abs(score))

/**
 * Everyone plays the final. Nobody is left out.
 *
 * This used to be `score > 0`, on the reasoning that a broke player has nothing
 * to stake — true under the old rule and no longer, now that `maxWager` gives
 * everyone at least a thousand. The exclusion was also self-reinforcing: the
 * only round that could have got them back was the one they were barred from.
 *
 * A side, not a seat: in team mode the team bets once, writes once and is
 * turned over once, whichever member does the typing.
 */
export const finalEligible = (room) => sides(room)

export function openFinal(room) {
  if (room.phase === PHASE.CLUE || room.phase === PHASE.WAGER) return []
  if (!room.board.final?.enabled) return []
  // Once only, and not before the board is done with. Opening it at the first
  // intermission used to abandon every round after it.
  if (room.played?.final) return []
  if (moreRounds(room)) return []
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
  if (!unit) return []
  const capped = Math.max(0, Math.min(num(amount, 0), maxFinalWager(unit.score)))
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
    room.played.final = true
    room.phase = PHASE.ENDED
    // Still `game-end` even with a survey to come: it is the end of the final,
    // the room reacts to it, and the survey announces itself.
    effects.push({ kind: "game-end" })
  } else {
    room.final.revealIndex += 1
    effects.push({ kind: "final-reveal", playerId: room.final.order[room.final.revealIndex] })
  }
  return effects
}

// ── The survey round ─────────────────────────────────────────────────────────

/**
 * "We asked a hundred people."
 *
 * A board of hidden answers with points on them. Whoever buzzes first gets to
 * say one; the host either finds it on the board — which opens it and pays them
 * — or marks a strike and the buzzer goes back out to everyone.
 *
 * The rule that makes it work as an ending: **it is a scramble, not a
 * reckoning.** A blind wager cannot rescue someone 2000 behind, but eight
 * answers on a board can, so a game that was over stays live to the last slot.
 *
 * Deliberately *not* modelled: control of the board, play-or-pass, and the
 * steal. They are most of Family Feud's rulebook and all of its bookkeeping,
 * and in a living room they turn a fast round into an argument about procedure.
 * Every answer is its own race instead.
 */
/**
 * Asking a hundred people, for real.
 *
 * The format's whole conceit is that the board came from somewhere. A public
 * link — no account, no room code typed, no seat taken — lets the host collect
 * answers from anyone over the days before, and then build the board out of
 * what people actually said.
 *
 * Responses are capped hard because this is the one door in the app that is
 * open to the internet by design. A cap on the total and on the length is
 * cheaper and more honest than trying to work out who is behind each one.
 */
const MAX_RESPONSES = 1000

export function addResponse(room, questionId, text, now = Date.now()) {
  const survey = room.board.survey
  if (!survey?.enabled || !survey.collecting) return null
  // An answer has to belong to a question that exists, or the tally would
  // quietly collect replies to something nobody was asked.
  if (!survey.questions.some((q) => q.id === questionId)) return null

  const clean = str(text, 60).trim()
  if (!clean) return null
  room.responses ??= []
  if (room.responses.length >= MAX_RESPONSES) return null
  room.responses.push({ q: questionId, text: clean, at: now })
  return { count: room.responses.filter((r) => r.q === questionId).length }
}

/**
 * Fold responses into what people meant rather than what they typed.
 *
 * "bin bags", "Bin Bags" and "binbags." are one answer, and a tally that
 * treated them as three would put the top answer fourth. Deliberately shallow —
 * case, punctuation, spacing and a leading article. Anything cleverer (plurals,
 * synonyms) would start merging things that are genuinely different, and the
 * host is about to read the list anyway.
 */
export const surveyKey = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/^(a|an|the)\s+/, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Which way of writing it goes on the board.
 *
 * This ends up in a slot the whole room reads, so it should look like something
 * a person would write. In order: the spellings that needed no article
 * stripped — "Batteries" over "the batteries" — then the commonest, then the
 * shortest. Ties fall back to insertion order, which is stable, so the same
 * responses always produce the same board.
 */
function bestSpelling(key, spellings) {
  const scored = [...spellings.entries()].map(([text, count]) => ({
    text,
    count,
    // Already in its normal form, rather than reached by stripping an article.
    exact: text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ") === key,
  }))
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.count - a.count || a.text.length - b.text.length)
  return scored[0].text
}

export function tallyResponses(room, questionId) {
  const groups = new Map()
  for (const r of room.responses ?? []) {
    if (r.q !== questionId) continue
    const key = surveyKey(r.text)
    if (!key) continue
    const g = groups.get(key) ?? { key, count: 0, spellings: new Map() }
    g.count += 1
    // The label is what goes on the board, so it should be how most people
    // wrote it — not whichever version happened to arrive first. "the
    // batteries" is a poor thing to put in a slot when nine people said
    // "batteries".
    g.spellings.set(r.text, (g.spellings.get(r.text) ?? 0) + 1)
    groups.set(key, g)
  }

  return [...groups.values()]
    .map((g) => ({ key: g.key, count: g.count, label: bestSpelling(g.key, g.spellings) }))
    // Equal counts break on the *normalised* key, so the order does not depend
    // on anybody's capitalisation.
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function openSurvey(room) {
  // Last of the scoring rounds, and after the final — a survey played before it
  // would just be another round, and one played twice would pay twice.
  if (room.phase !== PHASE.ENDED && room.phase !== PHASE.INTERMISSION) return []
  if (pending(room) !== "survey") return []

  room.phase = PHASE.SURVEY
  room.timer = null
  room.active = null
  room.wager = null
  room.revealed = false
  resetBuzzerState(room)
  room.survey = {
    index: 0,
    revealed: [],
    awards: {},
    strikes: [],
    said: null,
    /** The two sides playing it. See `surveyCut`. */
    contenders: surveyCut(room).through,
    /**
     * The survey's own scoreboard, kept apart from the game's.
     *
     * Survey points are not quiz points: they do not go on the board, they do
     * not move anybody's total, and they decide one thing only — which of the
     * two contenders wins the night. Adding them to `score` would have let a
     * hundred-point answer rewrite a game somebody won over two rounds.
     */
    points: {},
  }
  return [{ kind: "survey-open", contenders: room.survey.contenders }]
}

/**
 * What the player who buzzed says it is.
 *
 * Typed on their phone rather than shouted, because the host's job here is a
 * matching problem — is this thing on the list — and matching something you
 * misheard across a noisy room is how the wrong slot gets opened. It also
 * settles the arguments: the words are on the screen.
 */
export function saySurvey(room, playerId, text) {
  if (room.phase !== PHASE.SURVEY) return []
  // Only whoever holds the buzz. Everyone typing at once would be a chat.
  if (!room.buzzer.winner || !sameSide(room, room.buzzer.winner, playerId)) return []
  const unit = scorer(room, playerId)
  room.survey.said = { unitId: unit?.id ?? null, playerId, text: str(text, 80) }
  return [{ kind: "survey-said", playerId }]
}

/** The question on screen right now. */
export const currentQuestion = (room) =>
  room.phase === PHASE.SURVEY ? (room.board.survey?.questions?.[room.survey?.index ?? 0] ?? null) : null

export function revealSurvey(room, index, target = room.buzzer.winner) {
  if (room.phase !== PHASE.SURVEY) return []
  const slot = currentQuestion(room)?.answers?.[index]
  if (!slot || room.survey.revealed.includes(index)) return []

  room.survey.revealed.push(index)
  room.buzzer.armed = false
  room.timer = null
  room.survey.said = null

  // The host can open a slot with nobody holding the buzz — reading out the
  // ones nobody got, at the end. That pays no one, which is correct.
  const unit = target ? scorer(room, target) : null
  if (unit) {
    room.survey.awards[index] = unit.id
    // Survey points, not quiz points — a separate column that decides this
    // round and nothing else. The scoreboard the room has been watching all
    // night is left exactly where the final left it.
    room.survey.points[unit.id] = (room.survey.points[unit.id] ?? 0) + slot.points
  }
  room.buzzer.winner = null

  const done = room.survey.revealed.length >= (currentQuestion(room)?.answers.length ?? 0)
  const effects = [
    { kind: "survey-hit", index, points: slot.points, unitId: unit?.id ?? null, score: unit ? room.survey.points[unit.id] : null },
  ]
  if (done) effects.push({ kind: "survey-cleared" })
  return effects
}

/** Wrong. A cross on the board, and the buzzer goes back out to everyone. */
export function strikeSurvey(room, target = room.buzzer.winner, now = Date.now()) {
  if (room.phase !== PHASE.SURVEY) return []
  const unit = target ? scorer(room, target) : null
  room.survey.strikes.push({ unitId: unit?.id ?? null, at: now })
  room.survey.said = null

  // Straight back out: nobody is spent, because on this board a wrong answer
  // costs you the buzz and nothing else — there are still slots to find.
  resetBuzzerState(room)
  room.buzzer.armed = true
  room.buzzer.opened = true
  room.buzzer.openedAt = now
  room.timer = null
  return [{ kind: "survey-strike", unitId: unit?.id ?? null }]
}

/**
 * On to the next question, with a fresh board and a clean slate of strikes.
 *
 * Points already won stay won — each question is its own board, not its own
 * game.
 */
export function nextQuestion(room) {
  if (room.phase !== PHASE.SURVEY) return []
  const last = (room.board.survey?.questions?.length ?? 0) - 1
  if (room.survey.index >= last) return []

  // The board resets; the points and the field carry across questions.
  room.survey = {
    ...room.survey,
    index: room.survey.index + 1,
    revealed: [],
    awards: {},
    strikes: [],
    said: null,
  }
  resetBuzzerState(room)
  room.timer = null
  return [{ kind: "survey-next", index: room.survey.index }]
}

/** That's the round. Straight to the end, where a tie may still be waiting. */
export function closeSurvey(room) {
  if (room.phase !== PHASE.SURVEY) return []
  room.played.survey = true
  room.phase = PHASE.ENDED
  resetBuzzerState(room)
  room.timer = null
  room.survey.said = null
  return [{ kind: "game-end" }]
}

// ── The tie-break ────────────────────────────────────────────────────────────

/**
 * Level at the top, with nothing left to play.
 *
 * A quiz has to answer one question and a tie leaves it open, so this is sudden
 * death: the tied sides and nobody else, one clue, first correct answer takes
 * it. Everyone else watches, which is the point — they are not in it, and a
 * buzzer that still worked for them would decide the game by accident.
 *
 * **Nothing is scored.** The scores were tied and they stay tied; what the
 * tie-break produces is a *winner*, which is a different fact and is recorded
 * as one. Awarding a point instead would leave the board saying something that
 * did not happen, and someone would notice.
 */
export function leaders(room) {
  // Whatever the game is currently decided on — see `standing`.
  const table = standing(room)
  if (!table.length) return []
  const top = Math.max(...table.map((r) => r.value))
  return table.filter((r) => r.value === top).map((r) => r.unit)
}

/** True when the game cannot be called on the scores alone. */
export const isTied = (room) => leaders(room).length > 1

/**
 * Sudden death, for one of two reasons.
 *
 * `"winner"` is the one this started as: level at the top with nothing left to
 * play, and a quiz has to answer one question. `"cut"` is the other — level for
 * the last seat in the survey, which has to be settled *before* that round
 * rather than after, because the round cannot start two-handed until it knows
 * which two hands.
 *
 * The two differ only in what winning buys. Neither moves a score: a play-off
 * decides an order, not an amount.
 */
export function openTiebreak(room, purpose = null) {
  // Only from a finished board: a tie mid-round is just the current state of
  // play, and playing it off would be deciding a race nobody has run yet.
  if (!boardDone(room)) return []
  const cut = surveyCut(room)
  const forCut = purpose === "cut" || (purpose == null && cut.contested.length > 0)
  const contenders = forCut ? cut.contested : leaders(room)
  if (contenders.length < 2) return []

  room.phase = PHASE.TIEBREAK
  room.winner = null
  room.revealed = false
  room.timer = null
  room.active = null
  room.wager = null
  resetBuzzerState(room)
  room.tiebreak = {
    contenders: contenders.map((u) => (typeof u === "string" ? u : u.id)),
    spent: [],
    round: 1,
    purpose: forCut ? "cut" : "winner",
    /** How many seats this run-off is for. Only meaningful for a cut. */
    seats: forCut ? cut.seats : 1,
  }
  return [{ kind: "tiebreak-open", contenders: room.tiebreak.contenders, purpose: room.tiebreak.purpose }]
}

/** Is this player's side in the play-off? Everyone else is a spectator. */
export function inTiebreak(room, playerId) {
  if (!room.tiebreak) return false
  const unit = scorer(room, playerId)
  return !!unit && room.tiebreak.contenders.includes(unit.id) && !room.tiebreak.spent.includes(unit.id)
}

/**
 * Rule on the sudden-death answer.
 *
 * Right takes the game. Wrong puts that side out and leaves it to the others —
 * and if it puts the last one out, nobody has won it and the host runs another.
 */
export function judgeTiebreak(room, correct, target = judgeTarget(room)) {
  if (room.phase !== PHASE.TIEBREAK) return []
  const unit = scorer(room, target)
  if (!unit) return []

  room.timer = null
  room.buzzer.armed = false
  room.buzzer.winner = null

  if (correct) {
    room.revealed = true
    room.phase = PHASE.ENDED
    return [...takeTiebreak(room, unit), { kind: "game-end" }]
  }

  if (!room.tiebreak.spent.includes(unit.id)) room.tiebreak.spent.push(unit.id)
  const left = room.tiebreak.contenders.filter((id) => !room.tiebreak.spent.includes(id))

  // One left standing is not a winner — they have not answered anything. The
  // host runs it again rather than the game awarding it by elimination.
  if (left.length === 0) {
    room.revealed = true
    return [{ kind: "tiebreak-missed" }]
  }
  return [{ kind: "wrong", unitId: unit.id }]
}

/** Another go: same contenders, clean slate, because nobody got the last one. */
/** Whether this phone's side is one of the two playing the survey. */
export function inSurvey(room, playerId) {
  const seats = room.survey?.contenders
  if (!seats?.length) return true
  const unit = scorer(room, playerId)
  return !!unit && seats.includes(unit.id)
}

export function tiebreakAgain(room, now = Date.now()) {
  if (room.phase !== PHASE.TIEBREAK) return []
  room.tiebreak.spent = []
  room.tiebreak.round += 1
  room.revealed = false
  resetBuzzerState(room)
  room.buzzer.armed = true
  room.buzzer.opened = true
  room.buzzer.openedAt = now
  return [{ kind: "tiebreak-again", round: room.tiebreak.round }]
}

/**
 * Call it by hand.
 *
 * Sometimes the room settles it another way — a coin, a closest-to, a
 * concession — and the host needs to record the outcome without pretending a
 * buzzer decided it.
 */
export function awardTiebreak(room, unitId) {
  if (room.phase !== PHASE.TIEBREAK) return []
  const unit = scorer(room, unitId)
  if (!unit || !room.tiebreak.contenders.includes(unit.id)) return []
  room.phase = PHASE.ENDED
  room.buzzer.armed = false
  return [...takeTiebreak(room, unit), { kind: "game-end" }]
}

/**
 * What taking a play-off actually buys, which is the only thing the two kinds
 * disagree about.
 *
 * A seat, or the game. Neither pays anything: the scores are the scores, and a
 * side that wins a run-off is still level with the side it beat — which is why
 * the cut is recorded in `qualified` rather than by nudging a score, and why a
 * winner is recorded in `winner` rather than by awarding a point.
 */
function takeTiebreak(room, unit) {
  if (room.tiebreak.purpose === "cut") {
    if (!room.qualified.includes(unit.id)) room.qualified.push(unit.id)
    record(unit, 0, "tiebreak-through", "Play-off")
    return [{ kind: "tiebreak-through", unitId: unit.id }]
  }
  room.winner = unit.id
  record(unit, 0, "tiebreak-win", "Tie-break")
  return [{ kind: "tiebreak-won", unitId: unit.id }]
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
    winner: room.winner ?? null,
    /*
      Which end-game rounds are spent.

      Without this a resumed game forgets it has played its final and offers it
      again — and since the final pays out wagers, playing it twice pays twice.
    */
    played: { final: !!room.played?.final, survey: !!room.played?.survey },
    qualified: [...(room.qualified ?? [])],
    // Collected before the game, often days before — losing them to a restart
    // would lose the round.
    responses: room.responses ?? [],
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
  room.winner = typeof snapshot.winner === "string" ? snapshot.winner : null
  room.played = { final: !!snapshot.played?.final, survey: !!snapshot.played?.survey }
  room.qualified = (Array.isArray(snapshot.qualified) ? snapshot.qualified : []).filter((id) => typeof id === "string")
  room.responses = (Array.isArray(snapshot.responses) ? snapshot.responses : [])
    .slice(0, MAX_RESPONSES)
    .map((r) => ({ q: typeof r?.q === "string" ? r.q : "", text: str(r?.text, 60), at: num(r?.at, 0) }))
    .filter((r) => r.text)
  room.roundIndex = Math.max(0, Math.min(num(snapshot.roundIndex, 0), room.board.rounds.length - 1))
  room.phase = Object.values(PHASE).includes(snapshot.phase) ? snapshot.phase : PHASE.LOBBY
  // Never resume into a clue: `snapshotRoom` refuses to save one, but a
  // hand-edited or older snapshot must not be able to strand the display on a
  // clue the room has no memory of.
  if (room.phase === PHASE.CLUE || room.phase === PHASE.WAGER || room.phase === PHASE.REVEAL) room.phase = PHASE.BOARD
  // A play-off in flight is as transient as a buzzer race. Coming back to one
  // three days later would be resuming a moment, not a game.
  if (room.phase === PHASE.TIEBREAK || room.phase === PHASE.SURVEY) room.phase = PHASE.ENDED

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

  /*
    In sudden death the clue on screen is the tie-break's. Presenting it through
    the same `clue` field means the big screen, the cue cards and the phones all
    draw it with the machinery they already have, under the same redaction.
  */
  const tb = room.phase === PHASE.TIEBREAK ? room.board.tiebreak : null

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
  const clue = tb
    ? {
        id: "tiebreak",
        value: 0,
        prompt: mirrored ? tb.prompt : "",
        media: mirrored ? tb.media : null,
        nitro: false,
        answer: showAnswer && mirrored ? tb.answer : null,
        answerMedia: showAnswer && mirrored ? tb.answerMedia : null,
        catIndex: -1,
        clueIndex: -1,
        category: "Tie-break",
      }
    : active && {
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

  /*
    Streamer mode, enforced here.

    `hidden` rather than an empty string, so a screen can tell "I am not allowed
    this" from "it has not arrived yet" and say something useful instead of
    rendering a blank where a code should be. Operators are exempt — they are
    the ones reading it out.
  */
  const showCode = privileged || !room.settings.streamer

  return {
    code: showCode ? room.code : null,
    codeHidden: !showCode,
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
    // Only the people driving need to know who else is. A player seeing the
    // host's name attached to every ruling is noise, and on the big screen it
    // would be worse than noise.
    operators: privileged ? [...room.operators.values()] : undefined,
    lastAction: privileged ? (room.lastAction ?? null) : undefined,
    canUndo: privileged && !!room.lastJudgement,
    everyoneSpent: everyoneSpent(room),
    // The buzzer sound-check. Everyone sees it: a player needs to know their
    // press landed, and the big screen showing "testing" beats it showing a
    // lobby while the host is plainly doing something.
    check: room.check
      ? { since: room.check.openedAt, hits: room.check.hits, complete: checkComplete(room), order: checkOrder(room) }
      : null,
    /*
      The play-off. `tied` is offered whenever the game is over and level, so
      the desk can propose one without every screen recomputing the leaders.
    */
    tiebreak: room.tiebreak && room.phase === PHASE.TIEBREAK ? { ...room.tiebreak, hasClue: !!room.board.tiebreak?.prompt } : null,
    /*
      A tie is only worth breaking once the scores are final.

      Offered before the survey, a tie-break settles the game on numbers the
      survey is about to change — so the play-off is decided, and then the
      round after it moves somebody past the winner. `pending` gates it.
    */
    tied: boardDone(room) && !room.winner && !pending(room) && isTied(room) ? leaders(room).map((u) => u.id) : null,
    /**
     * What the running order says comes next: "final", "tiebreak-cut",
     * "survey", or nothing.
     */
    next: pending(room),
    /** Which end-game rounds are spent, so a screen can word itself correctly. */
    played: { final: !!room.played?.final, survey: !!room.played?.survey },
    /**
     * The run-off for a place in the survey, when the cut is level.
     *
     * Distinct from `tied`, which is the play-off for the game itself. They can
     * never both be offered — one settles who plays a round, the other settles
     * who won the night.
     */
    cut: (() => {
      if (pending(room) !== "tiebreak-cut") return null
      const { through, contested, seats } = surveyCut(room)
      return { through, contested, seats }
    })(),
    /** Set once a tie has been settled — the scores stay level, someone won. */
    winner: room.winner ?? null,
    final: projectFinal(room, privileged, viewerId),
    survey: room.board.survey?.enabled ? projectSurvey(room, privileged) : null,
    wager: room.wager,
    revealed: room.revealed,
    timer: room.timer,
    lifeline: room.lifeline,
    buzzer: {
      armed: room.buzzer.armed,
      openedAt: room.buzzer.openedAt,
      winner: room.buzzer.winner,
      spent: room.buzzer.spent,
      /** Set while a corrected race is still open. See `settleWindow`. */
      settleUntil: room.buzzer.settleUntil,
      // Margins behind the winner read better than absolute times: "+40ms" is
      // the thing being adjudicated, "1240ms" is trivia about the host's pace.
      // The margin is on corrected times, because those are what was judged.
      order: room.buzzer.order.map((e) => ({
        ...e,
        behind: room.buzzer.winnerMs == null ? 0 : (e.adjusted ?? e.ms) - room.buzzer.winnerMs,
      })),
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
          // Self-reported round-trip, for the phone's own benefit.
          rtt: p.rtt ?? null,
          // What the relay measured, with its own pings. This is the number
          // ping correction runs on, precisely because the phone cannot
          // choose it.
          lag: Number.isFinite(p.lag) ? p.lag : null,
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
 * The survey round, per role.
 *
 * A hidden slot sends its *shape* and nothing else — no text, no points. The
 * room is guessing at them, and a slot that shipped its answer alongside a
 * `hidden` flag would be a round decided by whoever opened devtools. Only the
 * question being played is sent at all; the other four are still to come.
 */
function projectSurvey(room, privileged) {
  const survey = room.board.survey
  const questions = survey.questions ?? []
  const live = room.phase === PHASE.SURVEY
  const q = live ? (questions[room.survey.index] ?? null) : null

  return {
    enabled: true,
    offered: boardDone(room) && pending(room) === "survey",
    live,
    collecting: !!survey.collecting,
    count: questions.length,
    index: live ? room.survey.index : 0,
    /** Enough for the desk to say "3 of 5" without shipping the questions. */
    category: q?.category ?? "",
    prompt: live ? (q?.prompt ?? "") : "",
    strikes: room.survey?.strikes ?? [],
    said: room.survey?.said ?? null,
    /** The two sides playing it, once it has started. */
    contenders: room.survey?.contenders ?? null,
    /**
     * The survey's own scoreboard, which is not the game's.
     *
     * Sent as its own column so no screen is tempted to add it to a score. The
     * quiz total is what got you into this round; these points are what win it.
     */
    points: room.survey?.points ?? {},
    slots: q?.answers.length ?? 0,
    cleared: !!q && room.survey.revealed.length >= q.answers.length,
    last: live && room.survey.index >= questions.length - 1,
    answers: (q?.answers ?? []).map((a, i) => {
      const open = privileged || !!room.survey?.revealed.includes(i)
      return {
        index: i,
        open: !!room.survey?.revealed.includes(i),
        text: open ? a.text : null,
        points: open ? a.points : null,
        by: room.survey?.awards[i] ?? null,
      }
    }),
    // The builder needs every question, its answers, and what came back for
    // each — none of which anybody else may see.
    questions: privileged
      ? questions.map((qq) => ({
          id: qq.id,
          category: qq.category,
          prompt: qq.prompt,
          answers: qq.answers,
          responses: (room.responses ?? []).filter((r) => r.q === qq.id).length,
          tally: tallyResponses(room, qq.id),
        }))
      : undefined,
    responses: (room.responses ?? []).length,
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
    // Everyone, now that everyone plays — see `finalEligible`. The old filter
    // dropped anyone on nothing, which is exactly who the floor exists for.
    players: sides(room)
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
