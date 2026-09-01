/**
 * The rules of Noggin, as pure(-ish) functions over a room object.
 *
 * Everything here is deliberately free of sockets, timers and disk so it can be
 * driven straight from `node --test`. The relay owns transport; this file owns
 * "what is true right now". Mutators return an array of *effects* — transient
 * things the display animates on (a buzz, a correct answer, a daily double
 * splash) that aren't derivable from the state snapshot alone.
 */

/** Phases the room can be in. The display keys its whole layout off this. */
export const PHASE = {
  LOBBY: "lobby", // players joining, board not yet revealed
  BOARD: "board", // grid on screen, host picking
  WAGER: "wager", // daily double — controlling player is setting a wager
  CLUE: "clue", // clue on screen; buzzer may or may not be armed
  REVEAL: "reveal", // answer shown
  INTERMISSION: "intermission", // between rounds
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
  /** How long the room reads a clue before the buzzer can legally open. */
  readSeconds: 0,
  /** Lifelines each player starts with. */
  lifelines: { phone: 1 },
  /** A wrong answer subtracts the clue value as well as failing to add it. */
  penaltyForWrong: true,
}

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
    dailyDouble: false,
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

export function makeBoard() {
  return {
    id: uid("b"),
    title: "Untitled Game",
    updatedAt: Date.now(),
    rounds: [
      makeRound("Round 1", [200, 400, 600, 800, 1000]),
      makeRound("Round 2", [400, 800, 1200, 1600, 2000]),
    ],
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
          dailyDouble: !!cl?.dailyDouble,
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
      /** playerId -> epoch ms until which they may not buzz. */
      lockedUntil: {},
      /** Players who have already answered this clue and got it wrong. */
      spent: [],
    },
    /** { kind, endsAt, duration } — one visible countdown at a time. */
    timer: null,
    /** { type, playerId, endsAt } while a lifeline is running. */
    lifeline: null,
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
  }
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export const currentRound = (room) => room.board.rounds[room.roundIndex] ?? room.board.rounds[0]

export function activeClue(room) {
  if (!room.active) return null
  const round = currentRound(room)
  return round?.categories[room.active.catIndex]?.clues[room.active.clueIndex] ?? null
}

/** What the clue is worth right now — a daily double overrides the tile value. */
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
  room.revealed = false
  room.wager = null
  room.timer = null
  room.lifeline = null
  resetBuzzerState(room)

  if (clue.dailyDouble) {
    room.phase = PHASE.WAGER
    room.wager = { playerId: null, amount: null }
    return [{ kind: "daily-double", catIndex, clueIndex }]
  }

  room.phase = PHASE.CLUE
  return [{ kind: "clue-open", catIndex, clueIndex }]
}

/** Daily double: name who controls the board and what they're risking. */
export function setWager(room, playerId, amount) {
  if (room.phase !== PHASE.WAGER) return []
  if (!room.players.has(playerId)) return []
  const capped = Math.max(0, Math.min(num(amount, 0), maxWager(room, playerId)))
  room.wager = { playerId, amount: capped }
  room.phase = PHASE.CLUE
  // Nobody else may buzz on a daily double — it is that player's clue alone.
  room.buzzer.winner = playerId
  room.buzzer.armed = false
  return [{ kind: "wager-set", playerId, amount: capped }]
}

export function armBuzzer(room, now = Date.now()) {
  if (room.phase !== PHASE.CLUE) return []
  if (room.wager) return [] // daily double: no race to run
  room.buzzer.armed = true
  room.buzzer.opened = true
  room.buzzer.openedAt = now
  room.buzzer.winner = null
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

/** Wipe the race but keep the clue up — "everyone try again". */
export function resetBuzzer(room) {
  resetBuzzerState(room)
  return [{ kind: "buzzer-reset" }]
}

function resetBuzzerState(room) {
  room.buzzer = { armed: false, opened: false, openedAt: 0, order: [], winner: null, lockedUntil: {}, spent: [] }
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
  room.buzzer.order.push({ playerId, ms })

  // The gate is already shut: someone won, or the host locked it. Record the
  // press so a photo finish is visible, but losing a race by 60ms is not an
  // offence and must not be punished like jumping the gun.
  if (!room.buzzer.armed) return [{ kind: "buzz-late", playerId, ms }]

  room.buzzer.winner = playerId
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
  room.timer = null

  if (correct) {
    player.score += amount
    room.buzzer.armed = false
    room.buzzer.winner = playerId
    room.phase = PHASE.REVEAL
    room.revealed = true
    markPlayed(room)
    return [{ kind: "correct", playerId, amount, score: player.score }]
  }

  if (room.settings.penaltyForWrong) player.score -= amount
  room.buzzer.spent.push(playerId)
  room.buzzer.winner = null

  const effects = [{ kind: "wrong", playerId, amount, score: player.score }]

  // A daily double is a solo bet — a miss ends the clue rather than reopening it.
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
    effects.push({ kind: "buzzer-open", answerSeconds: room.settings.answerSeconds })
  } else {
    room.buzzer.armed = false
  }
  return effects
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
  player.score += num(delta, 0)
  return [{ kind: "score", playerId, score: player.score }]
}

export function setScore(room, playerId, score) {
  const player = room.players.get(playerId)
  if (!player) return []
  player.score = num(score, 0)
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
export function projectState(room, role) {
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
          ...(privileged ? { prompt: clue.prompt, answer: clue.answer, media: clue.media, dailyDouble: clue.dailyDouble } : {}),
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
    dailyDouble: active.dailyDouble,
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
    wager: room.wager,
    revealed: room.revealed,
    timer: room.timer,
    lifeline: room.lifeline,
    buzzer: {
      armed: room.buzzer.armed,
      openedAt: room.buzzer.openedAt,
      winner: room.buzzer.winner,
      spent: room.buzzer.spent,
      order: room.buzzer.order,
      lockedUntil: room.buzzer.lockedUntil,
    },
    players: [...room.players.values()]
      .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, lifelines: p.lifelines }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  }
}
