/**
 * The Postgres backend. Same driver Chorus uses (postgres-js), no ORM — the
 * whole schema is two tables of jsonb, and `server/schema.sql` is short enough
 * to read in one sitting.
 *
 * Boards and rooms are documents: always read and written whole, by one host at
 * a time. Shredding them into category and clue tables would buy joins nobody
 * performs and cost a migration every time a clue grows a field. The columns
 * beside `data` exist so the pickers can list without parsing every document.
 */
import postgres from "postgres"
import { boardSummary, roomSummary, safeKey } from "./files.js"

export async function createPostgresStore(url) {
  const sql = postgres(url, { max: 8, onnotice: () => {} })

  // Fail here rather than at the first save. A host who set DATABASE_URL and
  // forgot to run schema.sql should be told at boot, not halfway through a game.
  const [{ ok }] = await sql`
    SELECT to_regclass('public.noggin_boards')   IS NOT NULL
       AND to_regclass('public.noggin_rooms')    IS NOT NULL
       AND to_regclass('public.noggin_users')    IS NOT NULL
       AND to_regclass('public.noggin_sessions') IS NOT NULL AS ok
  `
  if (!ok) {
    await sql.end({ timeout: 5 }).catch(() => {})
    throw new Error('tables missing — run:  psql "$DATABASE_URL" -f server/schema.sql')
  }

  return {
    kind: "postgres",
    describe: () => `postgres (${url.replace(/\/\/[^@]*@/, "//***@")})`,

    async saveBoard(board) {
      const id = safeKey(board?.id)
      if (!id) return null
      const saved = { ...board, id, updatedAt: Date.now() }
      await sql`
        INSERT INTO noggin_boards (id, owner_id, title, data, updated_at)
        VALUES (${id}, ${saved.ownerId ?? null}, ${saved.title ?? "Untitled Game"}, ${sql.json(saved)}, now())
        ON CONFLICT (id) DO UPDATE
          SET owner_id = EXCLUDED.owner_id, title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()
      `
      return saved
    },

    async loadBoard(id) {
      const key = safeKey(id)
      if (!key) return null
      const rows = await sql`SELECT data FROM noggin_boards WHERE id = ${key}`
      return rows[0]?.data ?? null
    },

    async deleteBoard(id) {
      const key = safeKey(id)
      if (!key) return false
      const rows = await sql`DELETE FROM noggin_boards WHERE id = ${key} RETURNING id`
      return rows.length > 0
    },

    async listBoards(ownerId) {
      if (!ownerId) return []
      const rows = await sql`
        SELECT data FROM noggin_boards WHERE owner_id = ${ownerId} ORDER BY updated_at DESC LIMIT 200
      `
      return rows.map((r) => boardSummary(r.data))
    },

    async saveRoom(snapshot) {
      const code = safeKey(snapshot?.code).toUpperCase()
      if (!code) return null
      const saved = { ...snapshot, code, savedAt: Date.now() }
      await sql`
        INSERT INTO noggin_rooms (code, owner_id, title, phase, round_index, players, data, saved_at)
        VALUES (
          ${code},
          ${saved.ownerId ?? null},
          ${saved.title ?? saved.board?.title ?? "Untitled Game"},
          ${saved.phase ?? "lobby"},
          ${saved.roundIndex ?? 0},
          ${saved.players?.length ?? 0},
          ${sql.json(saved)},
          now()
        )
        ON CONFLICT (code) DO UPDATE
          SET owner_id = EXCLUDED.owner_id,
              title = EXCLUDED.title,
              phase = EXCLUDED.phase,
              round_index = EXCLUDED.round_index,
              players = EXCLUDED.players,
              data = EXCLUDED.data,
              saved_at = now()
      `
      return saved
    },

    async loadRoom(code) {
      const key = safeKey(code).toUpperCase()
      if (!key) return null
      const rows = await sql`SELECT data FROM noggin_rooms WHERE code = ${key}`
      return rows[0]?.data ?? null
    },

    async deleteRoom(code) {
      const key = safeKey(code).toUpperCase()
      if (!key) return false
      const rows = await sql`DELETE FROM noggin_rooms WHERE code = ${key} RETURNING code`
      return rows.length > 0
    },

    async listRooms(ownerId) {
      if (!ownerId) return []
      const rows = await sql`
        SELECT data FROM noggin_rooms WHERE owner_id = ${ownerId} ORDER BY saved_at DESC LIMIT 100
      `
      return rows.map((r) => roomSummary(r.data))
    },

    // ── Accounts ─────────────────────────────────────────────────────────────

    async createUser(user) {
      // ON CONFLICT DO NOTHING rather than a read-then-write: the unique index
      // on email is the only thing that can settle a race between two signups.
      const rows = await sql`
        INSERT INTO noggin_users (id, email, name, password_hash)
        VALUES (${user.id}, ${user.email}, ${user.name}, ${user.passwordHash})
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `
      return rows.length ? user : null
    },

    async findUserByEmail(email) {
      const rows = await sql`
        SELECT id, email, name, password_hash FROM noggin_users WHERE email = ${String(email ?? "").toLowerCase()}
      `
      return rows[0] ? { id: rows[0].id, email: rows[0].email, name: rows[0].name, passwordHash: rows[0].password_hash } : null
    },

    async findUserById(id) {
      const rows = await sql`SELECT id, email, name FROM noggin_users WHERE id = ${String(id ?? "")}`
      return rows[0] ?? null
    },

    async countUsers() {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM noggin_users`
      return n
    },

    async createSession(tokenHash, userId, expiresAt) {
      await sql`
        INSERT INTO noggin_sessions (token_hash, user_id, expires_at)
        VALUES (${tokenHash}, ${userId}, ${new Date(expiresAt)})
        ON CONFLICT (token_hash) DO NOTHING
      `
      // Opportunistic cleanup — cheap, indexed, and saves needing a cron.
      await sql`DELETE FROM noggin_sessions WHERE expires_at < now()`
      return true
    },

    async findSession(tokenHash) {
      const rows = await sql`
        SELECT user_id, expires_at FROM noggin_sessions
        WHERE token_hash = ${tokenHash} AND expires_at > now()
      `
      return rows[0] ? { userId: rows[0].user_id, expiresAt: new Date(rows[0].expires_at).getTime() } : null
    },

    async deleteSession(tokenHash) {
      const rows = await sql`DELETE FROM noggin_sessions WHERE token_hash = ${tokenHash} RETURNING token_hash`
      return rows.length > 0
    },

    async close() {
      await sql.end({ timeout: 5 }).catch(() => {})
    },
  }
}
