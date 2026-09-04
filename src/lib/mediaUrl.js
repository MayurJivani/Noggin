/**
 * Noggin's file server and WebSocket share one origin (port 4332 by default).
 * URLs must never pin "localhost" from the host machine — every phone in the
 * room resolves the same path against *its own* page hostname.
 */

const RELAY_PORT = 4332
/** Where Astro's dev server lives. Seeing this port means we are in dev. */
const DEV_PORT = "4331"

function wsUrlToHttp(wsUrl) {
  if (wsUrl.startsWith("wss://")) return "https://" + wsUrl.slice(6)
  if (wsUrl.startsWith("ws://")) return "http://" + wsUrl.slice(5)
  return wsUrl
}

function httpUrlToWs(httpUrl) {
  if (httpUrl.startsWith("https://")) return "wss://" + httpUrl.slice(8)
  if (httpUrl.startsWith("http://")) return "ws://" + httpUrl.slice(7)
  return httpUrl
}

/**
 * HTTP origin of the relay (upload, /files, /boards, /rooms, /net).
 *
 * Two deployments, two answers:
 *
 * - **Dev** runs Astro on 4331 and the relay on 4332, so the page has to reach
 *   across to the other port.
 * - **Production** is one container behind one reverse proxy: the relay serves
 *   the built site *and* the API *and* the socket on a single origin. Guessing
 *   `hostname:4332` there would point at a port nothing exposes.
 *
 * Seeing the dev port is what tells the two apart, and `PUBLIC_WS_URL` still
 * overrides both for tunnels and odd proxy setups.
 */
export function getRelayOrigin() {
  if (import.meta.env.PUBLIC_WS_URL) return wsUrlToHttp(import.meta.env.PUBLIC_WS_URL)
  if (typeof window !== "undefined") {
    // Match the page's scheme so an https tunnel doesn't trip mixed-content blocking.
    const scheme = window.location.protocol === "https:" ? "https" : "http"
    if (window.location.port === DEV_PORT) return `${scheme}://${window.location.hostname}:${RELAY_PORT}`
    return window.location.origin
  }
  return `http://localhost:${RELAY_PORT}`
}

export function getWsUrl() {
  if (import.meta.env.PUBLIC_WS_URL) return import.meta.env.PUBLIC_WS_URL
  return httpUrlToWs(getRelayOrigin())
}

/**
 * What goes into a board: path-only, so every client resolves against a host it
 * can actually reach. Absolute URLs (a linked image from the web) pass through.
 */
export function stripToRelayPath(url) {
  if (!url) return url
  try {
    const u = new URL(url, getRelayOrigin())
    if (u.pathname.startsWith("/files/")) return u.pathname + u.search
  } catch {
    /* ignore */
  }
  return url
}

/** Final `src` for this device. */
export function resolveMediaUrl(url) {
  if (!url) return null
  if (url.startsWith("/")) return getRelayOrigin() + url
  return url
}

/** Upload a File to the relay. Returns a path-only URL suitable for a board. */
export async function uploadMedia(file, onProgress) {
  const res = await fetch(`${getRelayOrigin()}/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    credentials: "include",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `upload failed (${res.status})`)
  onProgress?.(1)
  const { url } = await res.json()
  return url
}

/** Guess how a file wants to be presented on the board. */
export function kindOf(file) {
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("image/")) return "image"
  // Some browsers hand over an empty `type` for a drag from certain file
  // managers, so the extension is the fallback rather than the first resort.
  if (/\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name)) return "video"
  return /\.(mp3|m4a|aac|ogg|oga|wav|flac)$/i.test(file.name) ? "audio" : "image"
}
