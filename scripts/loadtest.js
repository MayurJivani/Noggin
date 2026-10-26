/**
 * Load test: one host and N phones in one room, against a real relay process.
 *
 *   node scripts/loadtest.js [players=1000]
 *
 * Starts its own relay on a spare port with file storage in a temp dir, signs
 * up a host, opens a room, joins every player in waves of 50, then plays a
 * clue: the host arms the buzzer and every phone buzzes at once. Reports join
 * time, how long the room state takes to reach every phone after a host
 * action, buzz round trips, bytes per phone and the relay's CPU and RSS.
 * Exits non-zero if a phone never joins or never sees the state it should.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WebSocket } from "ws"

const N = Number(process.argv[2] ?? 1000)
const PORT = 4600 + Math.floor(Math.random() * 300)
const HTTP = `http://127.0.0.1:${PORT}`
const WS = `ws://127.0.0.1:${PORT}`
const root = path.join(import.meta.dirname, "..")
const data = mkdtempSync(path.join(tmpdir(), "noggin-load-"))

const server = spawn(process.execPath, [path.join(root, "server", "index.js")], {
  env: { ...process.env, DATABASE_URL: "", NOGGIN_PORT: String(PORT), NOGGIN_UPLOAD_DIR: data, ...Object.fromEntries(["DATA", "ROOM", "RESULT", "CLUE", "USER"].map((k) => [`NOGGIN_${k}_DIR`, path.join(data, k)])) },
  stdio: ["ignore", "ignore", "inherit"],
})
process.on("exit", () => server.kill())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; !(await fetch(`${HTTP}/health`).then((r) => r.ok, () => false)); i++) {
  if (i > 50) throw new Error("relay did not come up")
  await sleep(200)
}

// Relay CPU (ms) and RSS (MB) from /proc, so the clients in this process do not count.
const usage = () => {
  const stat = readFileSync(`/proc/${server.pid}/stat`, "utf8").split(") ")[1].split(" ")
  const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${server.pid}/status`, "utf8"))[1]) / 1024
  return { cpu: (Number(stat[11]) + Number(stat[12])) * 10, rss }
}
let peakRss = 0
const sampler = setInterval(() => (peakRss = Math.max(peakRss, usage().rss)), 250)

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? NaN
const fmt = (xs) => `p50 ${pct(xs, 50).toFixed(0)}ms, p95 ${pct(xs, 95).toFixed(0)}ms, max ${Math.max(...xs).toFixed(0)}ms`

const signup = await fetch(`${HTTP}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "host@load.test", name: "Host", password: "load-test-pass" }),
})
if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`)
const cookie = signup.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")

/** A socket that remembers when each kind of message last arrived. */
function open(headers) {
  const ws = new WebSocket(WS, { headers })
  ws.bytes = 0
  ws.waiters = []
  ws.on("message", (raw) => {
    ws.bytes += raw.length
    // Parsing a thousand copies of a big state would make this process the
    // bottleneck being measured, so states are matched as text.
    const text = raw.toString()
    const msg = text.startsWith('{"type":"state"') ? { type: "state", text } : JSON.parse(text)
    ws.waiters = ws.waiters.filter((w) => !w(msg))
  })
  return new Promise((res, rej) => (ws.once("open", () => res(ws)), ws.once("error", rej)))
}
const until = (ws, test, ms = 15_000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timed out")), ms)
    ws.waiters.push((m) => test(m) && (clearTimeout(t), res(m), true))
  })

const host = await open({ cookie })
host.send(JSON.stringify({ type: "join", role: "host" }))
const { code } = await until(host, (m) => m.type === "joined")

const cpu0 = usage().cpu
const t0 = performance.now()
const phones = []
const joinMs = []
let failed = 0
for (let i = 0; i < N; i += 50) {
  await Promise.all(
    Array.from({ length: Math.min(50, N - i) }, async (_, j) => {
      try {
        const s = performance.now()
        const ws = await open()
        ws.send(JSON.stringify({ type: "join", role: "player", code, name: `bot${i + j}` }))
        await until(ws, (m) => m.type === "joined")
        joinMs.push(performance.now() - s)
        phones.push(ws)
      } catch {
        failed++
      }
    }),
  )
}
const joinWall = performance.now() - t0
console.log(`${phones.length}/${N} joined in ${(joinWall / 1000).toFixed(1)}s; join ${fmt(joinMs)}`)

/** Host does something; time until every phone receives a state that passes `test` (on its JSON text). */
async function fanout(label, msg, test) {
  const s = performance.now()
  const arrivals = phones.map((ws) => until(ws, (m) => m.type === "state" && test(m.text)).then(() => performance.now() - s))
  host.send(JSON.stringify(msg))
  const ms = await Promise.allSettled(arrivals)
  const ok = ms.filter((r) => r.status === "fulfilled").map((r) => r.value)
  console.log(`${label}: ${ok.length}/${phones.length} phones, ${fmt(ok)}`)
  if (ok.length < phones.length) failed += phones.length - ok.length
  return ok
}

await fanout("game start", { type: "game:start" }, (t) => !t.includes('"phase":"lobby"'))
await fanout("clue open", { type: "clue:select", catIndex: 0, clueIndex: 0 }, (t) => t.includes('"clue":{'))
await fanout("buzzer armed", { type: "buzzer:arm" }, () => true)

// Every phone buzzes at once; each times the first state that follows.
const s = performance.now()
const buzzMs = await Promise.allSettled(
  phones.map((ws) => {
    const p = until(ws, (m) => m.type === "state").then(() => performance.now() - s)
    ws.send(JSON.stringify({ type: "buzz" }))
    return p
  }),
).then((rs) => rs.filter((r) => r.status === "fulfilled").map((r) => r.value))
console.log(`${phones.length} simultaneous buzzes: ${buzzMs.length} saw the race, ${fmt(buzzMs)}`)

const cpu = usage().cpu - cpu0
const wall = performance.now() - t0
const bytes = phones.map((ws) => ws.bytes)
clearInterval(sampler)
console.log(`relay: ${(cpu / 1000).toFixed(1)}s CPU over ${(wall / 1000).toFixed(1)}s (${((cpu / wall) * 100).toFixed(0)}% of one core), peak RSS ${peakRss.toFixed(0)} MB`)
console.log(`received per phone: p50 ${(pct(bytes, 50) / 1024).toFixed(0)} KB, max ${(Math.max(...bytes) / 1024).toFixed(0)} KB`)
for (const ws of [host, ...phones]) ws.terminate()
console.log(failed ? `FAIL: ${failed} phones missed a join or a state` : "ok")
process.exit(failed ? 1 : 0)
