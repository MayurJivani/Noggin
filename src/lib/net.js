import { getRelayOrigin } from "./mediaUrl"

/**
 * A join link is only useful if a phone can actually open it. If the host is
 * sitting on http://localhost:4331 then every QR it prints is dead on arrival,
 * so ask the relay which LAN address it can see and rewrite the host part.
 */

let lanPromise = null

/** The page's own origin, with a loopback host swapped for something a phone
 *  or a spare tablet on the wifi can actually open. */
async function originForLan() {
  const { protocol, hostname, port } = window.location
  const host = LOOPBACK.has(hostname) ? ((await lanHost()) ?? hostname) : hostname
  return `${protocol}//${host}${port ? `:${port}` : ""}`
}

export function lanHost() {
  if (!lanPromise) {
    lanPromise = fetch(`${getRelayOrigin()}/net`)
      .then((r) => r.json())
      .then((j) => j.ips?.[0] ?? null)
      .catch(() => null)
  }
  return lanPromise
}

/**
 * Write a board to the relay, and say honestly whether it landed.
 *
 * This exists because both callers got the same thing wrong in the same way.
 * `fetch` rejects only when the request never completed, so a 401 from an
 * expired session, a 403 on somebody else's board id and a 400 on a malformed
 * one all *resolve* — and both the builder's autosave and the desk's push read
 * that as success. A host wrote a board over an evening, watched the dot say
 * "saved" after every keystroke, and came back the next day to nothing.
 *
 * One function, because "did it save" is one question and two screens were
 * answering it differently. `fetchImpl` is injectable so the answer can be
 * tested without a relay.
 *
 * @returns {Promise<string|null>} null when stored, else why not.
 */
export async function putBoard(origin, board, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${origin}/boards/${board.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...board, updatedAt: Date.now() }),
    })
    if (res.ok) return null
    // The relay says why in a JSON body. Worth repeating: "401 sign in" tells a
    // host what to do, where "could not save" leaves them guessing.
    const why = await res.json().catch(() => null)
    return why?.error ? `${res.status} ${why.error}` : `HTTP ${res.status}`
  } catch (err) {
    return err?.message || "the relay could not be reached"
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export function isLoopbackPage() {
  return typeof window !== "undefined" && LOOPBACK.has(window.location.hostname)
}

/** @returns {Promise<string>} an absolute /play link a phone on the LAN can open */
export async function playerUrl(code) {
  const { protocol, hostname, port } = window.location
  let host = hostname
  if (LOOPBACK.has(hostname)) host = (await lanHost()) ?? hostname
  return `${protocol}//${host}${port ? `:${port}` : ""}/play?code=${code}`
}

/**
 * Links for a second privileged screen. Both carry the room and the key the
 * host just minted, so whoever scans one lands straight on it with no code to
 * type — and both are the same key, because the two are a layout difference
 * rather than a permission one.
 *
 * `cards` is the tablet the host reads from; `control` is the in-depth desk.
 */
export async function cardsUrl(code, key) {
  return `${await originForLan()}/cards?code=${code}&key=${encodeURIComponent(key)}`
}

export async function controllerUrl(code, key) {
  return `${await originForLan()}/control?code=${code}&key=${encodeURIComponent(key)}`
}

/**
 * The survey link, for people who are not playing.
 *
 * Public on purpose — it is handed to colleagues and group chats days before
 * the game, and asking them to sign in for one word would collect nothing.
 */
export async function surveyUrl(code) {
  return `${await originForLan()}/survey?code=${code}`
}

/**
 * The spectator link, for people watching from somewhere else.
 *
 * The same view as the big screen, minus the two things that only the room's
 * own screen should do — see `src/pages/watch.astro`.
 */
export async function watchUrl(code) {
  return `${await originForLan()}/watch?code=${code}`
}

/** The all-players scoreboard, for a second monitor or the control desk. */
export async function scoresUrl(code) {
  return `${await originForLan()}/scores?code=${code}`
}

/** Every player's podium on one screen, for a monitor in front of the seats. */
export async function podiumsUrl(code) {
  return `${await originForLan()}/podium?code=${code}`
}

/** One player's podium screen, for the tablet in front of them. */
export async function podiumUrl(code, name) {
  return `${await originForLan()}/podium?code=${code}&name=${encodeURIComponent(name)}`
}

/** Same, for the big screen — handy when the projector machine isn't the host. */
export async function displayUrl(code) {
  const { protocol, hostname, port } = window.location
  let host = hostname
  if (LOOPBACK.has(hostname)) host = (await lanHost()) ?? hostname
  return `${protocol}//${host}${port ? `:${port}` : ""}/display?code=${code}`
}
