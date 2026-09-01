/**
 * Noggin relay — one process serving both:
 *   HTTP :  POST /upload            raw body -> uploads/, returns { url: "/files/<name>" }
 *           GET  /files/<name>      range-capable image/audio streaming
 *           GET  /boards            saved board summaries
 *           GET  /boards/:id        one board
 *           PUT  /boards/:id        save (the builder autosaves here)
 *           DELETE /boards/:id
 *           GET  /net               LAN addresses, so the host can hand phones a link
 *   WS   :  room-scoped game sync — host desk, big screen, player phones
 *
 * The relay is the referee. Clients never decide who buzzed first or what a
 * clue is worth; they send intent and render whatever comes back. That is the
 * only way a race between five phones has a defensible answer.
 */
import { createServer } from "node:http"
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs"
import { networkInterfaces } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"

import * as G from "./game.js"
import { getStore, initStore, safeKey } from "./store/index.js"
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  hashToken,
  newControllerKey,
  newSessionToken,
  parseCookies,
  publicUser,
  sessionCookie,
  validateCredentials,
  verifyPassword,
} from "./auth.js"

const PORT = Number(process.env.NOGGIN_PORT ?? 4332)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const UPLOAD_DIR = path.resolve(process.env.NOGGIN_UPLOAD_DIR ?? path.join(ROOT, "uploads"))
/** How long a disconnected player keeps their seat and score. */
const PLAYER_GRACE_MS = Number(process.env.NOGGIN_PLAYER_GRACE_MS ?? 5 * 60_000)
const MAX_UPLOAD_BYTES = Number(process.env.NOGGIN_MAX_UPLOAD ?? 25 * 1024 * 1024)
/**
 * Signups are open only until the first account exists.
 *
 * This box is reachable from the internet. Leaving registration open forever
 * would mean anyone who found the URL could make an account, open rooms and
 * burn disk — so the first person through the door gets in, and after that it
 * takes an explicit opt-in to let anyone else.
 */
const ALLOW_SIGNUP = process.env.NOGGIN_ALLOW_SIGNUP === "1"

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

/**
 * The built site, when there is one.
 *
 * In dev, Astro serves the pages on 4331 and this is absent. In production the
 * relay serves `dist/` as well, so the whole app is one container on one port
 * behind one reverse proxy — which also means the browser can resolve the API
 * and the socket against its own origin instead of guessing a port.
 */
const DIST_DIR = path.resolve(process.env.NOGGIN_DIST_DIR ?? path.join(ROOT, "dist"))
const SERVE_STATIC = existsSync(DIST_DIR)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
}

const CORS_BASE = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

/**
 * CORS, with credentials.
 *
 * In production the relay serves the site itself, so every request is
 * same-origin and none of this applies. It exists for dev, where Astro is on
 * 4331 and the relay on 4332 — different origins, same machine.
 *
 * A session cookie means `Allow-Origin: *` is off the table: browsers refuse
 * the pairing, and reflecting *any* origin would let any website on the
 * internet make authenticated calls on a logged-in host's behalf. So the origin
 * is echoed only when its hostname matches the one this request arrived on —
 * the cross-port case, and nothing wider.
 */
function corsFor(req) {
  const origin = req.headers.origin
  if (!origin) return { ...CORS_BASE }
  let host
  try {
    host = new URL(origin).hostname
  } catch {
    return { ...CORS_BASE }
  }
  const self = String(req.headers.host ?? "").split(":")[0]
  if (host !== self) return { ...CORS_BASE }
  return { ...CORS_BASE, "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
}

/** Media and static files are public, and are fetched without credentials. */
const CORS = { ...CORS_BASE, "Access-Control-Allow-Origin": "*" }

/** Strip anything that could climb out of uploads/ or confuse a URL. */
function safeName(raw) {
  const base = path.basename(raw || "media")
  return base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(-120) || "media"
}

/**
 * Resolve a request into uploads/, or null. Belt and braces over safeName: the
 * check is on the resolved path, so it holds whatever the sanitiser lets past.
 */
function resolveUploadPath(raw) {
  const full = path.resolve(UPLOAD_DIR, safeName(raw))
  return path.dirname(full) === UPLOAD_DIR ? full : null
}

function lanAddresses() {
  const out = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address)
  }
  return out
}

/**
 * `req` is threaded through so each reply can carry the right CORS headers for
 * the origin that actually asked.
 */
const jsonFor = (req) => (res, code, body) => {
  res.writeHead(code, { ...corsFor(req), "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function serveFile(req, res, filePath) {
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    res.writeHead(404, CORS).end("not found")
    return
  }
  // A directory stats fine but streams as EISDIR — after the headers are out.
  if (!stat.isFile()) {
    res.writeHead(404, CORS).end("not found")
    return
  }

  const type = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
  const range = req.headers.range

  // Audio scrubbing (and Safari playing audio at all) needs 206 range replies.
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m?.[1] ? Number(m[1]) : 0
    let end = m?.[2] ? Number(m[2]) : stat.size - 1
    if (Number.isNaN(start) || start < 0) start = 0
    if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1
    if (start > end) {
      res.writeHead(416, { ...CORS, "Content-Range": `bytes */${stat.size}` }).end()
      return
    }
    res.writeHead(206, {
      ...CORS,
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    })
    createReadStream(filePath, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    ...CORS,
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  })
  createReadStream(filePath).pipe(res)
}

function handleUpload(req, res, url) {
  const json = jsonFor(req)
  const name = `${Date.now()}_${safeName(url.searchParams.get("name"))}`
  const dest = resolveUploadPath(name)
  if (!dest) return json(res, 400, { error: "bad filename" })

  const out = createWriteStream(dest)
  let written = 0
  let aborted = false

  req.on("data", (chunk) => {
    written += chunk.length
    // Someone dragging a 4GB wav onto a clue should fail fast, not fill the disk.
    if (written > MAX_UPLOAD_BYTES && !aborted) {
      aborted = true
      out.destroy()
      json(res, 413, { error: "file too large" })
      req.destroy()
    }
  })

  req.pipe(out)
  out.on("finish", () => {
    if (aborted) return
    json(res, 200, { url: `/files/${encodeURIComponent(name)}` })
    console.log(`[http] stored ${name} (${(written / 1024).toFixed(0)} KB)`)
  })
  out.on("error", (err) => {
    if (!aborted) json(res, 500, { error: err.message })
  })
  req.on("aborted", () => out.destroy())
}

/**
 * Map a request path onto a file in `dist/`, or null.
 *
 * Astro's static build writes `/host` as `host/index.html`, so a directory hit
 * falls through to its index. The containment check is on the *resolved* path,
 * so no amount of `..` in a URL can read outside the build.
 */
function resolveStatic(pathname) {
  if (!SERVE_STATIC) return null
  let rel
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\/+$/, "")
  } catch {
    return null
  }
  const full = rel ? path.resolve(DIST_DIR, rel) : DIST_DIR
  if (full !== DIST_DIR && !full.startsWith(DIST_DIR + path.sep)) return null

  try {
    const stat = statSync(full)
    if (stat.isFile()) return full
    if (stat.isDirectory()) {
      const index = path.join(full, "index.html")
      return statSync(index).isFile() ? index : null
    }
  } catch {
    /* not there */
  }
  return null
}

function serveStatic(req, res, file) {
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream"
  // Astro fingerprints everything under _astro/, so those can be cached hard.
  // HTML must not be, or a deploy leaves stale pages pinned in browsers.
  const immutable = file.includes(`${path.sep}_astro${path.sep}`)
  let size
  try {
    size = statSync(file).size
  } catch {
    res.writeHead(404, CORS).end("not found")
    return
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  })
  createReadStream(file).pipe(res)
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        reject(new Error("body too large"))
        return
      }
      chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

/**
 * Every request is wrapped, because an async handler that rejects sends no
 * response at all — the socket simply hangs until the browser gives up, which
 * looks like a dead server rather than a failed request. One bad store call
 * should cost one request, not the appearance of the whole relay being down.
 */
const http = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[noggin] request failed:", err.stack ?? err.message)
    if (res.headersSent) return res.destroy()
    res.writeHead(500, { ...corsFor(req), "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "server error" }))
  })
})

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const json = jsonFor(req)

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsFor(req)).end()
    return
  }

  if (req.method === "POST" && url.pathname === "/upload") return handleUpload(req, res, url)

  if (req.method === "GET" && url.pathname === "/net") {
    return json(res, 200, { ips: lanAddresses(), port: PORT })
  }

  const store = getStore()
  const me = await currentUser(req)

  if (url.pathname.startsWith("/auth/")) return handleAuth(req, res, url, me)

  // Everything below is somebody's own material. Without a session there is
  // nothing to show, and saying so plainly beats returning an empty list that
  // looks like "you have no games".
  if (url.pathname === "/boards" && req.method === "GET") {
    if (!me) return json(res, 401, { error: "sign in" })
    return json(res, 200, { boards: await store.listBoards(me.id) })
  }

  if (url.pathname.startsWith("/boards/")) {
    const id = decodeURIComponent(url.pathname.slice("/boards/".length))
    if (req.method === "GET") {
      const board = await store.loadBoard(id)
      if (!board) return json(res, 404, { error: "no such board" })
      if (!ownsRecord(board, me)) return json(res, 403, { error: "not yours" })
      return json(res, 200, { board })
    }
    if (req.method === "PUT") {
      if (!me) return json(res, 401, { error: "sign in" })
      try {
        const existing = await store.loadBoard(id)
        if (existing && !ownsRecord(existing, me)) return json(res, 403, { error: "not yours" })
        const board = G.normaliseBoard(JSON.parse(await readBody(req)))
        board.ownerId = me.id
        // The URL wins over whatever the body claims, but only once it has been
        // through the same sanitiser the storage layer uses — so what comes back
        // is an id the client can actually fetch again.
        board.id = safeKey(id)
        if (!board.id) return json(res, 400, { error: "bad board id" })
        const saved = await store.saveBoard(board)
        return saved ? json(res, 200, { board: saved }) : json(res, 400, { error: "bad board id" })
      } catch (err) {
        return json(res, 400, { error: err.message })
      }
    }
    if (req.method === "DELETE") {
      const board = await store.loadBoard(id)
      if (!board) return json(res, 200, { deleted: false })
      if (!ownsRecord(board, me)) return json(res, 403, { error: "not yours" })
      return json(res, 200, { deleted: await store.deleteBoard(id) })
    }
  }

  // Saved rooms — games put down mid-flight and picked up another night.
  if (url.pathname === "/rooms" && req.method === "GET") {
    if (!me) return json(res, 401, { error: "sign in" })
    const saved = await store.listRooms(me.id)
    const live = [...rooms.values()]
      .filter((r) => r.ownerId === me.id)
      .map((r) => ({
        code: r.code,
        title: r.board.title,
        phase: r.phase,
        players: [...r.players.values()].filter((p) => p.connected).length,
      }))
    return json(res, 200, { rooms: saved, live })
  }

  if (url.pathname.startsWith("/rooms/")) {
    const code = decodeURIComponent(url.pathname.slice("/rooms/".length)).toUpperCase()
    if (req.method === "GET") {
      const room = await store.loadRoom(code)
      if (!room) return json(res, 404, { error: "no such saved room" })
      if (!ownsRecord(room, me)) return json(res, 403, { error: "not yours" })
      return json(res, 200, { room })
    }
    if (req.method === "DELETE") {
      const live = rooms.get(code)
      const saved = await store.loadRoom(code)
      if (!live && !saved) return json(res, 200, { deleted: false })
      // Either copy establishes who it belongs to; a room that is live but was
      // never saved still has an owner in memory.
      const owner = live ? live.ownerId === me?.id : ownsRecord(saved, me)
      if (!owner) return json(res, 403, { error: "not yours" })
      const closed = closeLiveRoom(code)
      return json(res, 200, { deleted: (await store.deleteRoom(code)) || closed })
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/files/")) {
    let raw
    try {
      raw = decodeURIComponent(url.pathname.slice("/files/".length))
    } catch {
      res.writeHead(400, CORS).end("bad request")
      return
    }
    const file = resolveUploadPath(raw)
    if (!file) {
      res.writeHead(404, CORS).end("not found")
      return
    }
    return serveFile(req, res, file)
  }

  // Last: the built site. Checked after the API routes so a page can never
  // shadow /upload, /files, /boards, /rooms or /net.
  if (req.method === "GET" || req.method === "HEAD") {
    const page = resolveStatic(url.pathname)
    if (page) return serveStatic(req, res, page)
  }

  res.writeHead(404, CORS).end("not found")
}

// ── Accounts ─────────────────────────────────────────────────────────────────

/** Resolve a request's session cookie into a user, or null. Never throws. */
async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (!token) return null
  try {
    const session = await getStore().findSession(hashToken(token))
    if (!session) return null
    return await getStore().findUserById(session.userId)
  } catch (err) {
    console.error("[noggin] session lookup failed:", err.message)
    return null
  }
}

/** Ownerless records predate accounts and belong to nobody. */
const ownsRecord = (record, user) => !!user && !!record?.ownerId && record.ownerId === user.id

async function startSession(res, req, userId, body) {
  const token = newSessionToken()
  await getStore().createSession(hashToken(token), userId, Date.now() + SESSION_TTL_MS)
  res.writeHead(200, { ...corsFor(req), "Content-Type": "application/json", "Set-Cookie": sessionCookie(token, req) })
  res.end(JSON.stringify(body))
}

async function handleAuth(req, res, url, me) {
  const json = jsonFor(req)
  const store = getStore()
  const route = url.pathname.slice("/auth/".length)

  if (route === "me" && req.method === "GET") {
    // The signup flag travels with this so the sign-in screen knows whether to
    // offer a "create account" tab at all.
    const open = ALLOW_SIGNUP || (await store.countUsers()) === 0
    return json(res, 200, { user: publicUser(me), signupOpen: open })
  }

  if (route === "signup" && req.method === "POST") {
    const open = ALLOW_SIGNUP || (await store.countUsers()) === 0
    if (!open) return json(res, 403, { error: "Signups are closed on this server." })

    let payload
    try {
      payload = JSON.parse(await readBody(req, 8 * 1024))
    } catch {
      return json(res, 400, { error: "Bad request." })
    }
    const check = validateCredentials(payload)
    if (check.error) return json(res, 400, { error: check.error })

    const user = {
      id: `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      email: check.email,
      name: check.name,
      passwordHash: await hashPassword(check.password),
      createdAt: Date.now(),
    }
    const created = await store.createUser(user)
    if (!created) return json(res, 409, { error: "That email is already registered." })
    console.log(`[auth] account created for ${user.email}`)
    return startSession(res, req, user.id, { user: publicUser(user) })
  }

  if (route === "login" && req.method === "POST") {
    let payload
    try {
      payload = JSON.parse(await readBody(req, 8 * 1024))
    } catch {
      return json(res, 400, { error: "Bad request." })
    }
    const email = String(payload?.email ?? "").trim().toLowerCase()
    const user = await store.findUserByEmail(email)
    const ok = user && (await verifyPassword(String(payload?.password ?? ""), user.passwordHash))
    // One message for both failures, so this cannot be used to enumerate who
    // has an account here.
    if (!ok) return json(res, 401, { error: "Wrong email or password." })
    return startSession(res, req, user.id, { user: publicUser(user) })
  }

  if (route === "logout" && req.method === "POST") {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (token) await store.deleteSession(hashToken(token)).catch(() => {})
    res.writeHead(200, { ...corsFor(req), "Content-Type": "application/json", "Set-Cookie": sessionCookie("", req, { clear: true }) })
    return res.end(JSON.stringify({ ok: true }))
  }

  return json(res, 404, { error: "no such route" })
}

// ── Rooms ────────────────────────────────────────────────────────────────────

/** @type {Map<string, ReturnType<typeof G.createRoom> & { sockets: Map<any, any> }>} */
const rooms = new Map()

/** Unambiguous on a phone keypad and on a projector: no I, O, 0, 1. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function newCode() {
  for (let i = 0; i < 50; i++) {
    const code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("")
    if (!rooms.has(code)) return code
  }
  return `R${Date.now().toString(36).toUpperCase().slice(-3)}`
}

function getRoom(code, { create = false, ownerId = null } = {}) {
  const key = String(code ?? "").toUpperCase()
  let room = rooms.get(key)
  if (!room && create) {
    room = Object.assign(G.createRoom(key), {
      sockets: new Map(),
      ownerId,
      /** Ephemeral, per-night, and never written to disk — see `controller:invite`. */
      controllerKey: null,
    })
    rooms.set(key, room)
    console.log(`[room] ${key} opened by ${ownerId ?? "nobody"}`)
  }
  return room ?? null
}

/**
 * Reopen a saved game under its original code.
 *
 * The code is part of what was saved, because it may already be written on a
 * whiteboard — but if that room happens to be live right now, the live one
 * wins. Clobbering a game in progress with a three-day-old snapshot is the one
 * thing this must never do.
 */
async function resumeRoom(code) {
  const key = String(code ?? "").toUpperCase()
  if (rooms.has(key)) return rooms.get(key)

  const snapshot = await getStore().loadRoom(key)
  if (!snapshot) return null

  const room = Object.assign(G.restoreRoom(key, snapshot), {
    sockets: new Map(),
    ownerId: snapshot.ownerId ?? null,
    controllerKey: null,
  })
  rooms.set(key, room)
  console.log(`[room] ${key} resumed (${room.players.size} seats, ${room.phase})`)
  return room
}

/** Freeze the room to storage. Returns the summary the host desk shows back. */
async function persistRoom(room) {
  const saved = await getStore().saveRoom({ ...G.snapshotRoom(room), ownerId: room.ownerId ?? null })
  if (saved) room.savedAt = saved.savedAt
  return saved
}

const send = (ws, payload) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

/**
 * Push the room to everyone, redacted per role. Broadcasting the whole snapshot
 * on every change is more traffic than a diff, but a board is a few KB and a
 * client that can never drift out of sync is worth far more than the bytes.
 */
function broadcast(room, effects = []) {
  // Players each see their own final wager and answer and nobody else's, so
  // the cache key is the viewer, not just the role. Non-players still share
  // one projection between them.
  const cache = new Map()
  for (const [ws, meta] of room.sockets) {
    const key = meta.role === "player" ? `p:${meta.playerId}` : meta.role
    if (!cache.has(key)) cache.set(key, G.projectState(room, meta.role, meta.playerId))
    send(ws, { type: "state", state: cache.get(key), effects })
  }
}

/**
 * Drop rooms nobody is in, but keep them briefly so a host reload rejoins its
 * game — and write the room down before letting go of it. A quiz that ends
 * because everyone closed their laptop should still be there on Saturday.
 */
function sweep(code) {
  const room = rooms.get(code)
  if (!room || room.sockets.size) return
  persistRoom(room).catch((err) => console.error("[noggin] save on empty failed:", err.message))
  setTimeout(() => {
    const r = rooms.get(code)
    if (r && !r.sockets.size) {
      rooms.delete(code)
      console.log(`[room] ${code} closed`)
    }
  }, 30 * 60_000).unref?.()
}

/**
 * End a live room and turn everyone out of it.
 *
 * Deleting only the saved copy used to leave the game still running in memory,
 * with players still buzzing into a room their host thought was gone. Anything
 * that claims to delete a room has to come through here.
 */
function closeLiveRoom(code, message = "The host closed this game.") {
  const room = rooms.get(code)
  if (!room) return false
  for (const [sock] of room.sockets) {
    send(sock, { type: "error", code: "closed", message })
    sock.close()
  }
  clearTimeout(deadlines.get(code))
  deadlines.delete(code)
  clearTimeout(saveTimers.get(code))
  saveTimers.delete(code)
  for (const p of room.players.values()) clearTimeout(p.expire)
  rooms.delete(code)
  console.log(`[room] ${code} deleted`)
  return true
}

/**
 * Autosave, debounced.
 *
 * Every mutation marks the room dirty; the write lands a few seconds later. A
 * host judging six answers in ten seconds should cause one write, not six, and
 * nothing here is urgent enough to be worth blocking a broadcast on.
 */
const saveTimers = new Map()

function markDirty(room) {
  if (saveTimers.has(room.code)) return
  const t = setTimeout(() => {
    saveTimers.delete(room.code)
    if (rooms.has(room.code)) persistRoom(room).catch((err) => console.error("[noggin] autosave failed:", err.message))
  }, 4000)
  t.unref?.()
  saveTimers.set(room.code, t)
}

/**
 * Server-side deadlines. A timer that only lives in the host's tab stops when
 * that tab is backgrounded, which on a phone is most of the time — so the relay
 * holds the clock and tells everyone when it runs out.
 */
const deadlines = new Map()

function scheduleDeadline(room) {
  clearTimeout(deadlines.get(room.code))
  const at = room.timer?.endsAt
  if (!at) return
  const t = setTimeout(() => {
    deadlines.delete(room.code)
    if (!room.timer || room.timer.endsAt !== at) return
    const kind = room.timer.kind
    let effects
    if (kind === "arm") {
      // The reading time is up; the buzzer opens on its own.
      room.timer = null
      effects = G.armBuzzer(room)
    } else if (kind === "final") {
      effects = G.lockFinal(room)
    } else if (kind === "lifeline") {
      effects = G.endLifeline(room)
    } else if (kind === "answer") {
      // Time ran out on a buzzed-in player: that counts as a miss.
      effects = G.judge(room, false)
    } else {
      effects = G.stopTimer(room)
    }
    broadcast(room, [{ kind: "time-up", of: kind }, ...effects])
    scheduleDeadline(room)
  }, Math.max(0, at - Date.now()))
  t.unref?.()
  deadlines.set(room.code, t)
}

/** Every mutation funnels through here so nobody forgets to re-broadcast. */
function apply(room, effects) {
  scheduleDeadline(room)
  broadcast(room, effects)
  markDirty(room)
}

// ── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: http })

/**
 * One bad frame from one phone must never take the game down mid-round. Room
 * state is plain objects, so there is nothing to leave half-written — log and
 * carry on beats ending someone's quiz night on a stack trace.
 */
process.on("uncaughtException", (err) => console.error("[noggin] uncaught:", err))
process.on("unhandledRejection", (err) => console.error("[noggin] unhandled rejection:", err))

wss.on("connection", (ws, req) => {
  /** @type {{ code: string|null, role: string, playerId: string|null, user: any }} */
  const meta = { code: null, role: "display", playerId: null, user: null }
  // A browser sends its cookies on the upgrade, so the socket can be identified
  // the same way an HTTP request is — no second token to mint or leak.
  ws.upgradeReq = req
  ws.isAlive = true
  ws.on("pong", () => {
    ws.isAlive = true
  })

  ws.on("message", (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    // JSON.parse happily returns null, 42 or "hi" — all of which throw on the
    // first property read and would take the relay with them.
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return

    if (msg.type === "ping") return send(ws, { type: "pong", serverNow: Date.now() })

    if (msg.type === "join") {
      handleJoin(ws, meta, msg, req).catch((err) => {
        console.error("[noggin] join failed:", err.message)
        send(ws, { type: "error", code: "join-failed", message: "Could not open that room." })
      })
      return
    }

    const room = meta.code ? rooms.get(meta.code) : null
    if (!room) return

    // Host and controller share one command surface — the remote controller in
    // phase 2 is a second privileged client, not a second protocol.
    const privileged = meta.role === "host" || meta.role === "controller"
    if (privileged) return handleHostMessage(room, meta, ws, msg)
    return handlePlayerMessage(room, meta, msg)
  })

  ws.on("close", () => {
    if (!meta.code) return
    const room = rooms.get(meta.code)
    if (!room) return
    room.sockets.delete(ws)

    if (meta.role === "player" && meta.playerId) {
      const player = room.players.get(meta.playerId)
      if (player) {
        // Hold the seat warm. A phone that locks its screen or blips off wifi
        // must come back to the same name and score, not a fresh zero.
        player.connected = false
        clearTimeout(player.expire)
        player.expire = setTimeout(() => {
          const cur = room.players.get(meta.playerId)
          if (cur && !cur.connected) {
            room.players.delete(meta.playerId)
            broadcast(room)
          }
          sweep(meta.code)
        }, PLAYER_GRACE_MS)
        player.expire.unref?.()
      }
      console.log(`[ws] player ${meta.playerId} left ${meta.code}`)
    }
    broadcast(room)
    sweep(meta.code)
  })
})

async function handleJoin(ws, meta, msg, req) {
  const role = ["host", "display", "player", "controller"].includes(msg.role) ? msg.role : "display"
  const wanted = String(msg.code ?? "").toUpperCase()
  const privileged = role === "host" || role === "controller"

  // The two privileged roles can read every clue and answer and can move the
  // game. Neither is reachable without a session — or, for a controller, the
  // key the host handed out for this room tonight.
  const user = privileged ? await currentUser(req) : null
  const controllerKey = String(msg.key ?? "")
  if (role === "host" && !user) {
    return send(ws, { type: "error", code: "auth", message: "Sign in to host a game." })
  }

  // A code that isn't live may still be a saved game. Everyone gets the chance
  // to wake one — a player arriving first on resume night shouldn't be told the
  // room doesn't exist just because the host hasn't opened their laptop yet.
  let room = wanted ? rooms.get(wanted) ?? (await resumeRoom(wanted)) : null

  // Only the host desk may conjure a *new* room; a phone typing a wrong code
  // should be told so, not dropped into an empty room of its own.
  if (!room && role === "host") room = getRoom(wanted || newCode(), { create: true, ownerId: user.id })
  if (!room) return send(ws, { type: "error", code: "no-room", message: "No game with that code." })

  if (role === "host") {
    // A room saved before accounts existed has no owner; the first host to open
    // it adopts it. One that is already owned is not up for grabs.
    if (!room.ownerId) room.ownerId = user.id
    else if (room.ownerId !== user.id) {
      return send(ws, { type: "error", code: "forbidden", message: "That game belongs to someone else." })
    }
  }

  if (role === "controller") {
    const owner = user && room.ownerId === user.id
    const invited = !!room.controllerKey && controllerKey === room.controllerKey
    if (!owner && !invited) {
      return send(ws, { type: "error", code: "auth", message: "This controller link is not valid for that game." })
    }
  }

  meta.user = user

  meta.code = room.code
  meta.role = role
  room.sockets.set(ws, meta)

  if (role === "player") {
    const name = String(msg.name ?? "").trim().slice(0, 16) || "Player"
    // A returning playerId keeps its score; anything else is a new seat.
    const existing = msg.playerId && room.players.get(String(msg.playerId))
    if (existing) {
      clearTimeout(existing.expire)
      existing.connected = true
      existing.name = name || existing.name
      meta.playerId = existing.id
    } else {
      const id = `p_${Math.random().toString(36).slice(2, 10)}`
      const player = G.makePlayer(id, name)
      player.lifelines = { ...room.settings.lifelines }
      room.players.set(id, player)
      meta.playerId = id
    }
    send(ws, { type: "joined", playerId: meta.playerId, code: room.code, role })
    console.log(`[ws] player ${meta.playerId} joined ${room.code} (${room.players.size} seated)`)
  } else {
    send(ws, { type: "joined", code: room.code, role })
    console.log(`[ws] ${role} joined ${room.code}`)
  }

  broadcast(room)
}

function handleHostMessage(room, meta, ws, msg) {
  switch (msg.type) {
    case "board:set": {
      // Replacing the board mid-clue would pull the rug out from under the
      // display, so it is only accepted from a resting state.
      if (room.phase !== G.PHASE.LOBBY && room.phase !== G.PHASE.BOARD && room.phase !== G.PHASE.INTERMISSION) {
        return send(ws, { type: "error", code: "busy", message: "Close the clue before editing the board." })
      }
      room.board = G.normaliseBoard(msg.board)
      // normaliseBoard rebuilds the object from known fields only, so the owner
      // has to be re-stamped or the board comes back belonging to nobody — and
      // its own author is then refused when they try to open it.
      room.board.ownerId = room.ownerId ?? null
      getStore()
        .saveBoard(room.board)
        .catch((err) => console.error("[noggin] board save failed:", err.message))
      return apply(room, [{ kind: "board-set" }])
    }

    // Put the game down and pick it up another night. Explicit, even though
    // autosave already runs — a host wants to be *told* it is safe to close
    // the laptop, not to assume it.
    // A second pair of hands, without an account. The key is minted on demand,
    // lives only in memory, and dies with the room — a link that works tonight
    // and not next Tuesday is the right lifetime for "you drive the board".
    case "controller:invite": {
      if (meta.role !== "host") return
      room.controllerKey = newControllerKey()
      return send(ws, { type: "controller-key", code: room.code, key: room.controllerKey })
    }

    case "controller:revoke": {
      if (meta.role !== "host") return
      room.controllerKey = null
      for (const [sock, m] of room.sockets) {
        if (m.role === "controller" && !(m.user && m.user.id === room.ownerId)) {
          send(sock, { type: "error", code: "revoked", message: "The host ended this controller session." })
          sock.close()
        }
      }
      return send(ws, { type: "controller-key", code: room.code, key: null })
    }

    case "room:save": {
      persistRoom(room)
        .then((saved) => {
          send(ws, { type: "saved", code: room.code, savedAt: saved?.savedAt ?? Date.now() })
          broadcast(room, [{ kind: "room-saved" }])
        })
        .catch((err) => send(ws, { type: "error", code: "save-failed", message: err.message }))
      return
    }

    // Ends the game for everyone and removes every trace of it.
    case "room:delete": {
      if (meta.role !== "host") return
      const doomed = room.code
      getStore()
        .deleteRoom(doomed)
        .catch((err) => console.error("[noggin] delete failed:", err.message))
      send(ws, { type: "deleted", code: doomed })
      closeLiveRoom(doomed)
      return
    }

    case "room:forget": {
      getStore()
        .deleteRoom(room.code)
        .then(() => send(ws, { type: "forgotten", code: room.code }))
        .catch((err) => send(ws, { type: "error", code: "forget-failed", message: err.message }))
      return
    }
    case "settings:set": {
      room.settings = { ...room.settings, ...pick(msg.settings, Object.keys(G.DEFAULTS)) }
      return apply(room, [{ kind: "settings" }])
    }
    case "game:start":
      return apply(room, G.startGame(room))
    case "clue:select":
      return apply(room, G.selectClue(room, Number(msg.catIndex), Number(msg.clueIndex)))
    case "wager:set":
      return apply(room, G.setWager(room, msg.playerId, msg.amount))
    case "buzzer:arm":
      return apply(room, G.armBuzzer(room))
    case "buzzer:lock":
      return apply(room, G.lockBuzzer(room))
    case "buzzer:reset":
      return apply(room, G.resetBuzzer(room))
    case "judge":
      return apply(room, G.judge(room, !!msg.correct, msg.playerId))
    case "judge:undo":
      return apply(room, G.undoJudgement(room))
    case "final:open":
      return apply(room, G.openFinal(room))
    case "final:start":
      return apply(room, G.startFinal(room))
    case "final:lock":
      return apply(room, G.lockFinal(room))
    case "final:reveal":
      return apply(room, G.revealFinal(room))
    case "final:judge":
      return apply(room, G.judgeFinal(room, !!msg.correct))
    case "clue:reveal":
      return apply(room, G.revealAnswer(room))
    case "clue:close":
      return apply(room, G.closeClue(room))
    case "round:next":
      return apply(room, G.nextRound(room))
    case "score:adjust":
      return apply(room, G.adjustScore(room, msg.playerId, msg.delta))
    case "score:set":
      return apply(room, G.setScore(room, msg.playerId, msg.score))
    case "timer:start":
      return apply(room, G.startTimer(room, msg.seconds, msg.kind))
    case "timer:stop":
      return apply(room, G.stopTimer(room))
    case "lifeline:grant":
      return apply(room, G.grantLifeline(room, msg.playerId, msg.lifeline ?? "phone"))
    case "lifeline:end":
      return apply(room, G.endLifeline(room))
    case "lifeline:restore":
      return apply(room, G.restoreLifeline(room, msg.playerId, msg.lifeline ?? "phone"))
    case "player:rename": {
      const p = room.players.get(msg.playerId)
      if (p) p.name = String(msg.name ?? "").trim().slice(0, 16) || p.name
      return apply(room, [])
    }
    case "player:kick": {
      const p = room.players.get(msg.playerId)
      if (p) clearTimeout(p.expire)
      room.players.delete(msg.playerId)
      for (const [sock, m] of room.sockets) {
        if (m.playerId === msg.playerId) {
          send(sock, { type: "error", code: "kicked", message: "You were removed from the game." })
          sock.close()
        }
      }
      return apply(room, [{ kind: "kick", playerId: msg.playerId }])
    }
    case "game:reset":
      return apply(room, G.resetGame(room))
  }
}

function handlePlayerMessage(room, meta, msg) {
  if (!meta.playerId) return
  switch (msg.type) {
    case "buzz":
      return apply(room, G.buzz(room, meta.playerId))
    case "final:wager":
      return apply(room, G.setFinalWager(room, meta.playerId, msg.amount))
    case "final:answer":
      return apply(room, G.setFinalAnswer(room, meta.playerId, msg.text))
    case "lifeline:request": {
      // The player asks; the host still has to grant it, so this is a signal,
      // not a mutation. Nothing about the game changes until the host acts.
      const player = room.players.get(meta.playerId)
      const type = msg.lifeline ?? "phone"
      if (!player || (player.lifelines[type] ?? 0) <= 0) return
      return broadcast(room, [{ kind: "lifeline-request", playerId: meta.playerId, type }])
    }
  }
}

const pick = (obj, keys) => {
  const out = {}
  if (!obj || typeof obj !== "object") return out
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}

// Reap half-open sockets — phones that sleep or leave wifi never send a close frame.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, 30_000)
wss.on("close", () => clearInterval(heartbeat))

/**
 * Storage first, then the socket. A request that arrives before the store is
 * ready would throw out of `getStore()`, and the window is real — Astro and the
 * relay start together, and the browser is already asking.
 */
await initStore()

http.listen(PORT, "0.0.0.0", () => {
  const ips = lanAddresses()
  console.log(`[noggin] relay on http://0.0.0.0:${PORT}`)
  if (ips.length) console.log(`[noggin] LAN: ${ips.map((i) => `http://${i}:${PORT}`).join("  ")}`)
})

// Write every live room down before going away, so a Ctrl-C mid-quiz is
// recoverable rather than fatal.
let shuttingDown = false
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) process.exit(0)
    shuttingDown = true
    await Promise.allSettled([...rooms.values()].map(persistRoom))
    await getStore().close()
    process.exit(0)
  })
}
