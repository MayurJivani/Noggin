/**
 * Persistence, behind one async API.
 *
 * Postgres when `DATABASE_URL` is set, JSON files otherwise. The fallback is
 * not a hedge — it is the difference between "clone it and run a quiz tonight"
 * and "clone it, install Postgres, and then run a quiz". The relay never knows
 * which one it got.
 */
import { createFileStore } from "./files.js"
import { createPostgresStore } from "./postgres.js"

export { safeKey } from "./files.js"

let store = null

export async function initStore() {
  if (store) return store
  const url = process.env.DATABASE_URL

  if (url) {
    try {
      store = await createPostgresStore(url)
      console.log(`[noggin] store: ${store.describe()}`)
      return store
    } catch (err) {
      // Falling back keeps the night going, but loudly — a host who configured
      // Postgres and silently got files would only find out when the boards
      // they expected weren't there.
      console.error(`[noggin] postgres unavailable (${err.message})`)
      console.error("[noggin] falling back to file storage")
    }
  }

  store = createFileStore()
  console.log(`[noggin] store: ${store.describe()}`)
  return store
}

/**
 * The live handle. Every call is async, so a route can await it without caring
 * which backend answered.
 */
export function getStore() {
  if (!store) throw new Error("store not initialised — call initStore() first")
  return store
}
