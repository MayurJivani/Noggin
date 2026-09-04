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
const USER_DIR = path.resolve(process.env.NOGGIN_USER_DIR ?? path.join(ROOT, "data", "users"))
/** Sessions are one small file, rewritten whole — there are never many. */
const SESSION_FILE = path.join(USER_DIR, "sessions.json")

mkdirSync(BOARD_DIR, { recursive: true })
mkdirSync(ROOM_DIR, { recursive: true })
mkdirSync(USER_DIR, { recursive: true })

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
  mkdirSync(path.dirname(file), { recursive: true })
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

/**
 * Every readable record in a directory, newest first by mtime.
 *
 * The directory is re-made if it has gone missing. It is created once at
 * import, which is fine until something removes it underneath a running
 * process — a cleared volume, a stray `rm -rf data` — after which every read
 * threw ENOENT for the life of the process.
 */
function readAll(dir) {
  const out = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    mkdirSync(dir, { recursive: true })
    return out
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name === "sessions.json") continue
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

    async listBoards(ownerId) {
      return readAll(BOARD_DIR)
        .filter((b) => ownedBy(b, ownerId))
        .map(boardSummary)
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

    async listRooms(ownerId) {
      return readAll(ROOM_DIR)
        .filter((r) => ownedBy(r, ownerId))
        .map(roomSummary)
    },

    // ── Accounts ─────────────────────────────────────────────────────────────

    async createUser(user) {
      const file = fileFor(USER_DIR, user.id)
      if (!file) return null
      // Email is the natural key, and two files cannot enforce that between
      // themselves — so the uniqueness check happens here, before the write.
      if (await this.findUserByEmail(user.email)) return null
      writeJson(file, user)
      return user
    },

    async findUserByEmail(email) {
      const wanted = String(email ?? "").toLowerCase()
      return readAll(USER_DIR).find((u) => u.email === wanted) ?? null
    },

    async findUserById(id) {
      const file = fileFor(USER_DIR, id)
      return file && existsSync(file) ? readJson(file) : null
    },

    async countUsers() {
      return readAll(USER_DIR).length
    },

    /** Only the fields a reset touches. Everything else is read-only from here. */
    async updateUser(id, patch) {
      const file = fileFor(USER_DIR, id)
      if (!file || !existsSync(file)) return null
      const user = readJson(file)
      if (!user) return null
      for (const key of ["passwordHash", "recoveryHash", "name"]) {
        if (patch[key] !== undefined) user[key] = patch[key]
      }
      writeJson(file, user)
      return user
    },

    /**
     * Turn out every session this account has.
     *
     * A password reset that leaves the old sessions alive has not reset
     * anything — whoever prompted the reset is still signed in somewhere.
     */
    async deleteSessionsForUser(userId) {
      const all = readJson(SESSION_FILE) ?? {}
      let n = 0
      for (const [hash, row] of Object.entries(all)) {
        if (row.userId === userId) {
          delete all[hash]
          n++
        }
      }
      if (n) writeJson(SESSION_FILE, all)
      return n
    },

    async createSession(tokenHash, userId, expiresAt) {
      const all = readJson(SESSION_FILE) ?? {}
      all[tokenHash] = { userId, expiresAt }
      writeJson(SESSION_FILE, sweepExpired(all))
      return true
    },

    async findSession(tokenHash) {
      const all = readJson(SESSION_FILE) ?? {}
      const row = all[tokenHash]
      if (!row) return null
      if (row.expiresAt <= Date.now()) return null
      return row
    },

    async deleteSession(tokenHash) {
      const all = readJson(SESSION_FILE) ?? {}
      if (!all[tokenHash]) return false
      delete all[tokenHash]
      writeJson(SESSION_FILE, all)
      return true
    },

    async close() {},
  }
}

/**
 * A record belongs to you if you own it. Records written before accounts
 * existed have no owner and belong to nobody — they are not silently handed to
 * whoever logs in first.
 */
function ownedBy(record, ownerId) {
  return !!ownerId && record?.ownerId === ownerId
}

/** Expired sessions are dropped on write rather than swept on a timer. */
function sweepExpired(all) {
  const now = Date.now()
  const out = {}
  for (const [k, v] of Object.entries(all)) if (v?.expiresAt > now) out[k] = v
  return out
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
