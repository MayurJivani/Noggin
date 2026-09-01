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
    SELECT to_regclass('public.noggin_boards') IS NOT NULL
       AND to_regclass('public.noggin_rooms')  IS NOT NULL AS ok
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
        INSERT INTO noggin_boards (id, title, data, updated_at)
        VALUES (${id}, ${saved.title ?? "Untitled Game"}, ${sql.json(saved)}, now())
        ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()
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

    async listBoards() {
      const rows = await sql`SELECT data FROM noggin_boards ORDER BY updated_at DESC LIMIT 200`
      return rows.map((r) => boardSummary(r.data))
    },

    async saveRoom(snapshot) {
      const code = safeKey(snapshot?.code).toUpperCase()
      if (!code) return null
      const saved = { ...snapshot, code, savedAt: Date.now() }
      await sql`
        INSERT INTO noggin_rooms (code, title, phase, round_index, players, data, saved_at)
        VALUES (
          ${code},
          ${saved.title ?? saved.board?.title ?? "Untitled Game"},
          ${saved.phase ?? "lobby"},
          ${saved.roundIndex ?? 0},
          ${saved.players?.length ?? 0},
          ${sql.json(saved)},
          now()
        )
        ON CONFLICT (code) DO UPDATE
          SET title = EXCLUDED.title,
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

    async listRooms() {
      const rows = await sql`SELECT data FROM noggin_rooms ORDER BY saved_at DESC LIMIT 100`
      return rows.map((r) => roomSummary(r.data))
    },

    async close() {
      await sql.end({ timeout: 5 }).catch(() => {})
    },
  }
}
