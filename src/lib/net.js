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
 * The controller link. Carries the room and the key the host just minted, so
 * whoever scans it lands straight on the console with no code to type.
 */
export async function controllerUrl(code, key) {
  const { protocol, hostname, port } = window.location
  let host = hostname
  if (LOOPBACK.has(hostname)) host = (await lanHost()) ?? hostname
  return `${protocol}//${host}${port ? `:${port}` : ""}/control?code=${code}&key=${encodeURIComponent(key)}`
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
