/**
 * localStorage that cannot take the page down with it.
 *
 * Safari in Private Browsing exposes `localStorage` and then *throws* on
 * `setItem`. Unguarded, that throw happened inside a React effect — which
 * unmounts the tree — so a player who joined on a Safari private tab watched
 * their buzzer disappear the instant they were seated. Storage here is a
 * convenience (remembering a seat, a room code); nothing in the game depends on
 * it, so every operation degrades to a no-op rather than propagating.
 *
 * Reads are equally defensive: a locked-down browser can throw on `getItem`
 * too, and some return corrupt JSON from a previous version of the app.
 */

export function readStore(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : raw
  } catch {
    return fallback
  }
}

export function readJson(key, fallback = null) {
  const raw = readStore(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export const writeJson = (key, value) => writeStore(key, JSON.stringify(value))

export function removeStore(key) {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
