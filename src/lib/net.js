import { getRelayOrigin } from "./mediaUrl"

/**
 * A join link is only useful if a phone can actually open it. If the host is
 * sitting on http://localhost:4331 then every QR it prints is dead on arrival,
 * so ask the relay which LAN address it can see and rewrite the host part.
 */

let lanPromise = null

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

/** Same, for the big screen — handy when the projector machine isn't the host. */
export async function displayUrl(code) {
  const { protocol, hostname, port } = window.location
  let host = hostname
  if (LOOPBACK.has(hostname)) host = (await lanHost()) ?? hostname
  return `${protocol}//${host}${port ? `:${port}` : ""}/display?code=${code}`
}
