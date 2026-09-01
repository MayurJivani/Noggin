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

const PORT = Number(process.env.NOGGIN_PORT ?? 4332)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const UPLOAD_DIR = path.resolve(process.env.NOGGIN_UPLOAD_DIR ?? path.join(ROOT, "uploads"))
/** How long a disconnected player keeps their seat and score. */
const PLAYER_GRACE_MS = Number(process.env.NOGGIN_PLAYER_GRACE_MS ?? 5 * 60_000)
const MAX_UPLOAD_BYTES = Number(process.env.NOGGIN_MAX_UPLOAD ?? 25 * 1024 * 1024)

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

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

const json = (res, code, body) => {
  res.writeHead(code, { ...CORS, "Content-Type": "application/json" })
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

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end()
    return
  }

  if (req.method === "POST" && url.pathname === "/upload") return handleUpload(req, res, url)

  if (req.method === "GET" && url.pathname === "/net") {
    return json(res, 200, { ips: lanAddresses(), port: PORT })
  }

  const store = getStore()

  if (url.pathname === "/boards" && req.method === "GET") return json(res, 200, { boards: await store.listBoards() })

  if (url.pathname.startsWith("/boards/")) {
    const id = decodeURIComponent(url.pathname.slice("/boards/".length))
    if (req.method === "GET") {
      const board = await store.loadBoard(id)
      return board ? json(res, 200, { board }) : json(res, 404, { error: "no such board" })
    }
    if (req.method === "PUT") {
      try {
        const board = G.normaliseBoard(JSON.parse(await readBody(req)))
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
    if (req.method === "DELETE") return json(res, 200, { deleted: await store.deleteBoard(id) })
  }

  // Saved rooms — games put down mid-flight and picked up another night.
  if (url.pathname === "/rooms" && req.method === "GET") {
    const saved = await store.listRooms()
    const live = [...rooms.values()].map((r) => ({
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
      return room ? json(res, 200, { room }) : json(res, 404, { error: "no such saved room" })
    }
    if (req.method === "DELETE") return json(res, 200, { deleted: await store.deleteRoom(code) })
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
})

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

function getRoom(code, { create = false } = {}) {
  const key = String(code ?? "").toUpperCase()
  let room = rooms.get(key)
  if (!room && create) {
    room = Object.assign(G.createRoom(key), { sockets: new Map() })
    rooms.set(key, room)
    console.log(`[room] ${key} opened`)
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

  const room = Object.assign(G.restoreRoom(key, snapshot), { sockets: new Map() })
  rooms.set(key, room)
  console.log(`[room] ${key} resumed (${room.players.size} seats, ${room.phase})`)
  return room
}

/** Freeze the room to storage. Returns the summary the host desk shows back. */
async function persistRoom(room) {
  const saved = await getStore().saveRoom(G.snapshotRoom(room))
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
  const cache = new Map()
  for (const [ws, meta] of room.sockets) {
    if (!cache.has(meta.role)) cache.set(meta.role, G.projectState(room, meta.role))
    send(ws, { type: "state", state: cache.get(meta.role), effects })
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
    if (kind === "lifeline") {
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

wss.on("connection", (ws) => {
  /** @type {{ code: string|null, role: string, playerId: string|null }} */
  const meta = { code: null, role: "display", playerId: null }
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
      handleJoin(ws, meta, msg).catch((err) => {
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

async function handleJoin(ws, meta, msg) {
  const role = ["host", "display", "player", "controller"].includes(msg.role) ? msg.role : "display"
  const wanted = String(msg.code ?? "").toUpperCase()

  // A code that isn't live may still be a saved game. Everyone gets the chance
  // to wake one — a player arriving first on resume night shouldn't be told the
  // room doesn't exist just because the host hasn't opened their laptop yet.
  let room = wanted ? rooms.get(wanted) ?? (await resumeRoom(wanted)) : null

  // Only the host desk may conjure a *new* room; a phone typing a wrong code
  // should be told so, not dropped into an empty room of its own.
  if (!room && role === "host") room = getRoom(wanted || newCode(), { create: true })
  if (!room) return send(ws, { type: "error", code: "no-room", message: "No game with that code." })

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
      getStore()
        .saveBoard(room.board)
        .catch((err) => console.error("[noggin] board save failed:", err.message))
      return apply(room, [{ kind: "board-set" }])
    }

    // Put the game down and pick it up another night. Explicit, even though
    // autosave already runs — a host wants to be *told* it is safe to close
    // the laptop, not to assume it.
    case "room:save": {
      persistRoom(room)
        .then((saved) => {
          send(ws, { type: "saved", code: room.code, savedAt: saved?.savedAt ?? Date.now() })
          broadcast(room, [{ kind: "room-saved" }])
        })
        .catch((err) => send(ws, { type: "error", code: "save-failed", message: err.message }))
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
