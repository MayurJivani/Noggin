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
}

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

function media(m) {
  if (!m || typeof m !== "object") return null
  const kind = m.kind === "audio" ? "audio" : m.kind === "image" ? "image" : null
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
    lifelines: { ...DEFAULTS.lifelines },
    /** Every score change, newest last. See `record`. */
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

/** Biggest wager a player may make: their score, or the round's top tile if broke. */
export function maxWager(room, playerId) {
  const round = currentRound(room)
  const top = Math.max(...round.values, 0)
  const score = room.players.get(playerId)?.score ?? 0
  return Math.max(score, top)
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

/** Nitro: name who found it and what they are risking. */
export function setWager(room, playerId, amount) {
  if (room.phase !== PHASE.WAGER) return []
  if (!room.players.has(playerId)) return []
  const capped = Math.max(0, Math.min(num(amount, 0), maxWager(room, playerId)))
  room.wager = { playerId, amount: capped }
  room.phase = PHASE.CLUE
  // Nobody else may buzz on a nitro — it is that player's clue alone.
  room.buzzer.winner = playerId
  room.buzzer.armed = false
  return [{ kind: "wager-set", playerId, amount: capped }]
}

export function armBuzzer(room, now = Date.now()) {
  if (room.phase !== PHASE.CLUE) return []
  if (room.wager) return [] // a nitro belongs to one player: no race to run
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
  if (room.phase !== PHASE.CLUE) return []
  if (room.wager) return [] // a nitro belongs to one player
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
  if (room.buzzer.spent.includes(playerId)) return []
  if ((room.buzzer.lockedUntil[playerId] ?? 0) > now) return []
  if (room.buzzer.order.some((e) => e.playerId === playerId)) return []

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
export function judge(room, correct, playerId = room.buzzer.winner) {
  if (room.phase !== PHASE.CLUE) return []
  const player = room.players.get(playerId)
  if (!player) return []

  const amount = stake(room)

  // Everything a ruling touches, kept so it can be taken back. Hosts mis-tap
  // ✓ and ✕ constantly — they are two adjacent buttons pressed under pressure
  // while talking — and "fix it by hand afterwards" means editing a score, a
  // spent-player list and a clue's status separately, in front of an audience.
  room.lastJudgement = {
    playerId,
    correct,
    amount,
    score: player.score,
    phase: room.phase,
    revealed: room.revealed,
    clueStatus: activeClue(room)?.status,
    active: room.active && { ...room.active },
    buzzer: cloneBuzzer(room.buzzer),
    timer: room.timer,
  }

  room.timer = null

  if (correct) {
    player.score += amount
    record(player, amount, room.wager ? "nitro" : "correct", clueLabel(room))
    room.buzzer.armed = false
    room.buzzer.winner = playerId
    room.phase = PHASE.REVEAL
    room.revealed = true
    markPlayed(room)
    return [{ kind: "correct", playerId, amount, score: player.score }]
  }

  if (room.settings.penaltyForWrong) {
    player.score -= amount
    record(player, -amount, "wrong", clueLabel(room))
  }
  room.buzzer.spent.push(playerId)
  room.buzzer.winner = null

  const effects = [{ kind: "wrong", playerId, amount, score: player.score }]

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

  const player = room.players.get(last.playerId)
  if (!player) {
    room.lastJudgement = null
    return []
  }

  player.score = last.score
  if (player.history?.length) player.history.pop()
  room.phase = last.phase
  room.revealed = last.revealed
  room.active = last.active
  room.buzzer = cloneBuzzer(last.buzzer)
  room.timer = last.timer
  const clue = activeClue(room)
  if (clue && last.clueStatus) clue.status = last.clueStatus
  room.lastJudgement = null

  return [{ kind: "undo", playerId: last.playerId, correct: last.correct, score: player.score }]
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

export function adjustScore(room, playerId, delta) {
  const player = room.players.get(playerId)
  if (!player) return []
  const by = num(delta, 0)
  player.score += by
  record(player, by, "adjust")
  return [{ kind: "score", playerId, score: player.score }]
}

export function setScore(room, playerId, score) {
  const player = room.players.get(playerId)
  if (!player) return []
  const target = num(score, 0)
  const by = target - player.score
  player.score = target
  record(player, by, "set")
  return [{ kind: "score", playerId, score: player.score }]
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
  if ((player.lifelines[type] ?? 0) <= 0) return []

  player.lifelines[type] -= 1
  room.lifeline = { type, playerId, endsAt: now + spec.seconds * 1000 }
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
  const player = room.players.get(playerId)
  if (!player || !LIFELINES[type]) return []
  player.lifelines[type] = (player.lifelines[type] ?? 0) + 1
  return [{ kind: "lifeline-restore", playerId, type }]
}

export function resetGame(room) {
  for (const round of room.board.rounds) {
    for (const cat of round.categories) for (const clue of cat.clues) clue.status = CLUE_STATUS.OPEN
  }
  for (const p of room.players.values()) {
    p.score = 0
    p.lifelines = { ...room.settings.lifelines }
  }
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

/** Nobody plays the final on a non-positive score — there is nothing to stake. */
export const finalEligible = (room) => [...room.players.values()].filter((p) => p.score > 0)

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

/** A bet, placed blind. Capped at what the player actually has to lose. */
export function setFinalWager(room, playerId, amount) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "wager") return []
  const player = room.players.get(playerId)
  if (!player || player.score <= 0) return []
  const capped = Math.max(0, Math.min(num(amount, 0), player.score))
  room.final.wagers[playerId] = capped
  return [{ kind: "final-wager", playerId }]
}

export function startFinal(room, now = Date.now()) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "wager") return []
  // Anyone who never bet is treated as having staked nothing, so one player
  // looking at their phone cannot hold the whole room up.
  for (const p of finalEligible(room)) room.final.wagers[p.id] ??= 0
  room.final.stage = "clue"
  const seconds = room.board.final.seconds || 30
  room.timer = { kind: "final", duration: seconds, endsAt: now + seconds * 1000 }
  return [{ kind: "final-start", seconds }]
}

export function setFinalAnswer(room, playerId, text) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "clue") return []
  const player = room.players.get(playerId)
  if (!player || player.score <= 0) return []
  if (room.final.answers[playerId]?.locked) return []
  room.final.answers[playerId] = { text: str(text, 200), at: Date.now(), locked: false }
  return [{ kind: "final-answer", playerId }]
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
    .map((p) => p.id)
  room.final.revealIndex = 0
  return [{ kind: "final-reveal", playerId: room.final.order[0] ?? null }]
}

/** Rule on whoever is currently up, pay or dock the bet, and move along. */
export function judgeFinal(room, correct) {
  if (room.phase !== PHASE.FINAL || room.final?.stage !== "reveal") return []
  const playerId = room.final.order[room.final.revealIndex]
  const player = playerId && room.players.get(playerId)
  if (!player) return []

  const wager = room.final.wagers[playerId] ?? 0
  player.score += correct ? wager : -wager
  record(player, correct ? wager : -wager, correct ? "final-correct" : "final-wrong", "Final")
  room.final.judged[playerId] = correct

  const effects = [{ kind: correct ? "final-correct" : "final-wrong", playerId, wager, score: player.score }]

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
      lifelines: { ...p.lifelines },
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

  for (const p of snapshot.players ?? []) {
    if (!p?.id) continue
    const player = makePlayer(String(p.id), str(p.name, 16) || "Player")
    player.score = num(p.score, 0)
    player.lifelines = { ...room.settings.lifelines, ...(p.lifelines ?? {}) }
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
  const clue = active && {
    id: active.id,
    value: active.value,
    prompt: room.phase === PHASE.WAGER && !privileged ? "" : active.prompt,
    media: room.phase === PHASE.WAGER && !privileged ? null : active.media,
    nitro: active.nitro,
    answer: showAnswer ? active.answer : null,
    answerMedia: showAnswer ? active.answerMedia : null,
    catIndex: room.active.catIndex,
    clueIndex: room.active.clueIndex,
    category: round?.categories[room.active.catIndex]?.title ?? "",
  }

  return {
    code: room.code,
    serverNow: Date.now(),
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
    players: [...room.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        lifelines: p.lifelines,
        // The working behind the total. Everyone can see it — it is a
        // scoreboard, not a secret — but it is trimmed for the wire.
        history: (p.history ?? []).slice(-12),
      }))
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
    players: [...room.players.values()]
      .filter((p) => p.score > 0 || room.final.wagers[p.id] != null)
      .map((p) => {
        const mine = p.id === viewerId
        const open = privileged || isUp(p.id)
        return {
          id: p.id,
          name: p.name,
          score: p.score,
          // "They have bet" is public; the number is not.
          wagered: room.final.wagers[p.id] != null,
          answered: !!room.final.answers[p.id]?.text,
          wager: open || mine ? (room.final.wagers[p.id] ?? null) : null,
          answer: open || mine ? (room.final.answers[p.id]?.text ?? "") : null,
          judged: room.final.judged[p.id] ?? null,
        }
      }),
  }
}
