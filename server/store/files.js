/**
 * The no-database backend: one JSON file per board, one per saved room.
 *
 * This is what runs when `DATABASE_URL` is unset, which is the common case —
 * somebody cloning this to run a quiz on Friday should not have to stand up
 * Postgres first. Writes are atomic (write-then-rename) because a half-written
 * board discovered at showtime is worse than no board at all.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const BOARD_DIR = path.resolve(process.env.NOGGIN_DATA_DIR ?? path.join(ROOT, "data", "boards"))
const ROOM_DIR = path.resolve(process.env.NOGGIN_ROOM_DIR ?? path.join(ROOT, "data", "rooms"))

mkdirSync(BOARD_DIR, { recursive: true })
mkdirSync(ROOM_DIR, { recursive: true })

/**
 * Ids and room codes arrive from clients, so they are sanitised into the
 * filename *and* stored back on the record. Sanitising only the filename leaves
 * a board claiming an id it cannot be fetched by.
 */
export function safeKey(raw) {
  return String(raw ?? "")
    .replace(/[^\w-]+/g, "")
    .slice(0, 64)
}

function fileFor(dir, key) {
  const safe = safeKey(key)
  if (!safe) return null
  const full = path.resolve(dir, `${safe}.json`)
  return path.dirname(full) === dir ? full : null
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

/** Every readable record in a directory, newest first by mtime. */
function readAll(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    const file = path.join(dir, name)
    const value = readJson(file)
    if (value) out.push({ value, at: statSync(file).mtimeMs })
  }
  return out.sort((a, b) => b.at - a.at).map((r) => r.value)
}

export function createFileStore() {
  return {
    kind: "files",
    describe: () => `files (${path.relative(ROOT, BOARD_DIR)}, ${path.relative(ROOT, ROOM_DIR)})`,

    async saveBoard(board) {
      const id = safeKey(board?.id)
      const file = fileFor(BOARD_DIR, id)
      if (!file) return null
      const saved = { ...board, id, updatedAt: Date.now() }
      writeJson(file, saved)
      return saved
    },

    async loadBoard(id) {
      const file = fileFor(BOARD_DIR, id)
      return file && existsSync(file) ? readJson(file) : null
    },

    async deleteBoard(id) {
      const file = fileFor(BOARD_DIR, id)
      if (!file || !existsSync(file)) return false
      rmSync(file)
      return true
    },

    async listBoards() {
      return readAll(BOARD_DIR).map(boardSummary)
    },

    async saveRoom(snapshot) {
      const code = safeKey(snapshot?.code).toUpperCase()
      const file = fileFor(ROOM_DIR, code)
      if (!file) return null
      const saved = { ...snapshot, code, savedAt: Date.now() }
      writeJson(file, saved)
      return saved
    },

    async loadRoom(code) {
      const file = fileFor(ROOM_DIR, String(code ?? "").toUpperCase())
      return file && existsSync(file) ? readJson(file) : null
    },

    async deleteRoom(code) {
      const file = fileFor(ROOM_DIR, String(code ?? "").toUpperCase())
      if (!file || !existsSync(file)) return false
      rmSync(file)
      return true
    },

    async listRooms() {
      return readAll(ROOM_DIR).map(roomSummary)
    },

    async close() {},
  }
}

/** Shared with the Postgres backend so both list the same shape. */
export function boardSummary(b) {
  return {
    id: b.id,
    title: b.title ?? "Untitled Game",
    updatedAt: b.updatedAt ?? 0,
    rounds: b.rounds?.length ?? 0,
    clues: (b.rounds ?? []).reduce(
      (n, r) => n + (r.categories ?? []).reduce((m, c) => m + (c.clues ?? []).filter((cl) => cl.prompt?.trim() || cl.media).length, 0),
      0,
    ),
  }
}

export function roomSummary(r) {
  return {
    code: r.code,
    title: r.title ?? r.board?.title ?? "Untitled Game",
    phase: r.phase ?? "lobby",
    roundIndex: r.roundIndex ?? 0,
    players: (r.players ?? []).map((p) => ({ name: p.name, score: p.score })),
    savedAt: r.savedAt ?? 0,
    /** How far through the board this game got, for the resume list. */
    progress: progressOf(r.board),
  }
}

function progressOf(board) {
  let total = 0
  let played = 0
  for (const round of board?.rounds ?? []) {
    for (const cat of round.categories ?? []) {
      for (const clue of cat.clues ?? []) {
        total++
        if (clue.status === "played") played++
      }
    }
  }
  return { played, total }
}
