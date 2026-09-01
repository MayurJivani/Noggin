import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocket } from "ws"

/**
 * The relay, end to end: a host, a big screen and two phones in one room,
 * running a real round over real sockets.
 *
 * `game.test.js` proves the rules; this proves the wiring — join, redaction per
 * role, fan-out, reconnection, and the fact that an unknown room code is
 * refused instead of quietly opening an empty room of its own.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 4399
const URL = `ws://127.0.0.1:${PORT}`

let server
let dataDir
/** Session cookie for the account every privileged test runs as. */
let cookie = ""

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "noggin-test-"))
  server = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    env: {
      ...process.env,
      NOGGIN_PORT: String(PORT),
      NOGGIN_DATA_DIR: path.join(dataDir, "boards"),
      NOGGIN_ROOM_DIR: path.join(dataDir, "rooms"),
      NOGGIN_USER_DIR: path.join(dataDir, "users"),
      NOGGIN_UPLOAD_DIR: path.join(dataDir, "uploads"),
      // Signups close after the first account on a real deployment. These tests
      // need several, to prove one host cannot reach another's games.
      NOGGIN_ALLOW_SIGNUP: "1",
      // The file backend is the one every machine has. A developer with a
      // DATABASE_URL in their shell must not have their real database used as
      // scratch space by the test suite.
      DATABASE_URL: "",
    },
    stdio: ["ignore", "ignore", "inherit"],
  })
  await waitForRelay()
  cookie = await signUp("host@example.com", "correct horse battery")
})

/** Create an account and return its session cookie. */
async function signUp(email, password) {
  const res = await fetch(`http://127.0.0.1:${PORT}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  })
  assert.equal(res.status, 200, `signup for ${email} failed`)
  return (res.headers.get("set-cookie") ?? "").split(";")[0]
}

/** fetch, as the signed-in host. */
const asHost = (path, init = {}, jar = cookie) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: jar } })

after(() => {
  server?.kill("SIGTERM")
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

async function waitForRelay() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/net`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  throw new Error("relay never came up")
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Long enough for a message to reach the relay and the reply to fan back out. */
const settle = (ms = 120) => sleep(ms)

function client(role, joinExtra = {}, jar = cookie) {
  const privileged = role === "host" || role === "controller"
  const ws = new WebSocket(URL, privileged ? { headers: { Cookie: jar } } : undefined)
  const c = { ws, state: null, effects: [], identity: null, errors: [] }
  c.ready = new Promise((resolve) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "join", role, ...joinExtra })))
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === "state") {
        c.state = m.state
        c.effects.push(...(m.effects ?? []))
        resolve(c)
      } else if (m.type === "joined") c.identity = m
      else if (m.type === "error") {
        c.errors.push(m)
        resolve(c)
      }
    })
  })
  c.send = (type, payload = {}) => ws.send(JSON.stringify({ type, ...payload }))
  c.drain = () => c.effects.splice(0).map((e) => e.kind)
  return c
}

const BOARD = {
  id: "relay-test-board",
  title: "Relay Night",
  rounds: [
    {
      name: "Round 1",
      values: [200, 400],
      categories: [
        {
          title: "STONE",
          clues: [
            { value: 200, prompt: "Black, veined with gold", answer: "marble" },
            { value: 400, prompt: "Risk it all", answer: "double", dailyDouble: true },
          ],
        },
        {
          title: "GOLD",
          clues: [
            { value: 200, prompt: "Au", answer: "gold" },
            { value: 400, prompt: "Karats in pure gold", answer: "24" },
          ],
        },
      ],
    },
  ],
}

test("a full round, over the wire", async (t) => {
  const host = client("host")
  await host.ready
  const code = host.identity.code
  assert.match(code, /^[A-Z0-9]{4}$/)

  const screen = client("display", { code })
  const alice = client("player", { code, name: "Alice" })
  const bob = client("player", { code, name: "Bob" })
  await Promise.all([screen.ready, alice.ready, bob.ready])
  const A = alice.identity.playerId
  const B = bob.identity.playerId

  t.after(() => [host, screen, alice, bob].forEach((c) => c.ws.close()))

  await t.test("the board reaches every client, redacted per role", async () => {
    host.send("board:set", { board: BOARD })
    await settle()
    assert.equal(host.state.board.title, "Relay Night")
    assert.equal(screen.state.board.round.categories.length, 2)
    assert.equal(screen.state.board.round.categories[0].clues[0].prompt, undefined)
    assert.equal(screen.state.board.round.categories[0].clues[1].dailyDouble, undefined, "no map of the daily doubles")
    assert.equal(alice.state.board.round.categories[0].clues[0].answer, undefined)
  })

  await t.test("an unarmed press is punished; a lost race is not", async () => {
    host.send("game:start")
    await settle()
    host.send("clue:select", { catIndex: 1, clueIndex: 0 })
    await settle()
    assert.equal(screen.state.clue.prompt, "Au")
    assert.equal(screen.state.clue.answer, null, "the answer is not on the wire yet")
    assert.equal(host.state.clue.answer, "gold")

    bob.drain()
    bob.send("buzz")
    await settle()
    assert.ok(bob.drain().includes("buzz-early"))

    await sleep(600) // serve out Bob's penalty
    host.send("buzzer:arm")
    await settle()
    alice.send("buzz")
    await settle(80)
    bob.send("buzz")
    await settle()

    assert.equal(host.state.buzzer.winner, A, "Alice got there first")
    assert.equal(host.state.buzzer.order.length, 2, "the close finish is on record")
    assert.equal(host.state.buzzer.order[1].playerId, B)
  })

  await t.test("judging pays, deducts, and reopens", async () => {
    host.send("judge", { correct: false })
    await settle()
    assert.equal(host.state.players.find((p) => p.id === A).score, -200)
    assert.equal(host.state.buzzer.armed, true, "still live for everyone else")

    bob.send("buzz")
    await settle()
    assert.equal(host.state.buzzer.winner, B, "the stale race does not lock Bob out")

    host.send("judge", { correct: true })
    await settle()
    assert.equal(host.state.players.find((p) => p.id === B).score, 200)
    assert.equal(screen.state.clue.answer, "gold", "now the room may see it")

    host.send("clue:close")
    await settle()
    assert.equal(host.state.phase, "board")
    assert.equal(screen.state.board.round.categories[1].clues[0].status, "played")
  })

  await t.test("a daily double hides its clue until the wager is in", async () => {
    host.send("clue:select", { catIndex: 0, clueIndex: 1 })
    await settle()
    assert.equal(host.state.phase, "wager")
    assert.equal(screen.state.clue.prompt, "", "no peeking before the bet")

    host.send("wager:set", { playerId: B, amount: 150 })
    await settle()
    assert.equal(host.state.stake, 150)
    assert.equal(screen.state.clue.prompt, "Risk it all")

    host.send("judge", { correct: true })
    await settle()
    assert.equal(host.state.players.find((p) => p.id === B).score, 350)
    host.send("clue:close")
    await settle()
  })

  await t.test("a lifeline request reaches the host but changes nothing on its own", async () => {
    host.drain()
    alice.send("lifeline:request", { lifeline: "phone" })
    await settle()
    assert.ok(host.drain().includes("lifeline-request"))
    assert.equal(host.state.lifeline, null, "asking is not taking")
    assert.equal(host.state.players.find((p) => p.id === A).lifelines.phone, 1)

    host.send("lifeline:grant", { playerId: A, lifeline: "phone" })
    await settle()
    assert.equal(screen.state.lifeline.playerId, A)
    assert.equal(host.state.players.find((p) => p.id === A).lifelines.phone, 0)

    host.send("lifeline:end")
    await settle()
    assert.equal(host.state.lifeline, null)
  })

  await t.test("a player who drops off wifi comes back to the same seat", async () => {
    alice.ws.close()
    await settle(200)

    const alice2 = client("player", { code, name: "Alice", playerId: A })
    await alice2.ready
    await settle()
    assert.equal(alice2.identity.playerId, A)
    assert.equal(alice2.state.players.find((p) => p.id === A).score, -200, "the score survived")
    alice2.ws.close()
  })

  await t.test("a phone cannot conjure a room out of a wrong code", async () => {
    const stray = client("player", { code: "ZZZZ", name: "Nobody" })
    await stray.ready
    assert.ok(stray.errors.some((e) => e.code === "no-room"))
    assert.equal(stray.state, null, "and gets no room state")
    stray.ws.close()
  })
})

test("a game can be put down and picked up again", async (t) => {
  const host = client("host")
  await host.ready
  const code = host.identity.code

  const alice = client("player", { code, name: "Alice" })
  await alice.ready
  const A = alice.identity.playerId

  host.send("board:set", { board: { ...BOARD, id: "resume-board", title: "Saturday Quiz" } })
  await settle()
  host.send("game:start")
  await settle()
  host.send("clue:select", { catIndex: 0, clueIndex: 0 })
  await settle()
  host.send("buzzer:arm")
  await settle()
  alice.send("buzz")
  await settle()
  host.send("judge", { correct: true })
  await settle()
  host.send("clue:close")
  await settle()
  assert.equal(host.state.players.find((p) => p.id === A).score, 200)

  await t.test("saving reports back to the host", async () => {
    const saved = new Promise((res) => host.ws.once("message", function wait(raw) {
      const m = JSON.parse(raw.toString())
      if (m.type === "saved") res(m)
      else host.ws.once("message", wait)
    }))
    host.send("room:save")
    const ack = await saved
    assert.equal(ack.code, code)
    assert.ok(ack.savedAt > 0)
  })

  await t.test("it shows up in the saved list with its progress", async () => {
    const { rooms: saved } = await (await asHost("/rooms")).json()
    const mine = saved.find((r) => r.code === code)
    assert.ok(mine, "the room is listed")
    assert.equal(mine.title, "Saturday Quiz")
    assert.deepEqual(mine.players, [{ name: "Alice", score: 200 }])
    assert.equal(mine.progress.played, 1, "one tile is spent")
    assert.equal(mine.progress.total, 4)
  })

  await t.test("everyone leaves, and the room comes back with its scores", async () => {
    host.ws.close()
    alice.ws.close()
    await settle(300)

    // A brand-new host, joining by code, must land on the saved game rather
    // than a blank one.
    const host2 = client("host", { code })
    await host2.ready
    await settle()

    assert.equal(host2.state.code, code)
    assert.equal(host2.state.board.title, "Saturday Quiz")
    assert.equal(host2.state.phase, "board", "resumed at rest, not mid-clue")
    assert.equal(host2.state.board.round.categories[0].clues[0].status, "played", "the spent tile stayed spent")

    const alice2 = host2.state.players.find((p) => p.name === "Alice")
    assert.ok(alice2, "Alice kept her seat")
    assert.equal(alice2.score, 200, "and her score")
    assert.equal(alice2.connected, false, "but her phone has to rejoin")

    host2.ws.close()
  })

  await t.test("forgetting a room removes it from the list", async () => {
    const host3 = client("host", { code })
    await host3.ready
    host3.send("room:forget")
    await settle(250)
    const { rooms: saved } = await (await asHost("/rooms")).json()
    assert.ok(!saved.some((r) => r.code === code))
    host3.ws.close()
  })
})

test("a live room is never clobbered by its own older snapshot", async (t) => {
  const host = client("host")
  await host.ready
  const code = host.identity.code
  t.after(() => host.ws.close())

  host.send("board:set", { board: { ...BOARD, id: "live-board", title: "Live" } })
  await settle()
  host.send("room:save")
  await settle(250)

  // Score moves *after* the save. A second client joining by code must see the
  // live room, not the stale one on disk.
  const alice = client("player", { code, name: "Alice" })
  await alice.ready
  await settle()
  host.send("score:adjust", { playerId: alice.identity.playerId, delta: 999 })
  await settle()

  const screen = client("display", { code })
  await screen.ready
  await settle()
  assert.equal(screen.state.players.find((p) => p.name === "Alice").score, 999, "the live room won")
  alice.ws.close()
  screen.ws.close()
})

test("boards persist over HTTP", async () => {
  const board = { ...BOARD, id: "persisted", title: "Saved Game" }
  const put = await asHost("/boards/persisted", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(board),
  })
  assert.equal(put.status, 200)

  const { board: back } = await (await asHost("/boards/persisted")).json()
  assert.equal(back.title, "Saved Game")
  assert.equal(back.rounds[0].categories[0].clues[0].answer, "marble")

  const { boards } = await (await asHost("/boards")).json()
  assert.ok(boards.some((b) => b.id === "persisted"))
})

test("a board id cannot escape the data directory", async () => {
  const res = await asHost(`/boards/${encodeURIComponent("../../escape")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(BOARD),
  })
  // The id is stripped to something harmless, or refused outright — either way
  // nothing may be written outside the boards directory.
  const { boards } = await (await asHost("/boards")).json()
  assert.ok(!boards.some((b) => String(b.id).includes("..")), "no traversal in the listing")
  assert.ok(res.status === 200 || res.status === 400)
})

// ── Accounts and ownership ───────────────────────────────────────────────────

test("signup, login and logout round-trip", async () => {
  const jar = await signUp("second@example.com", "another good password")

  const me = await (await asHost("/auth/me", {}, jar)).json()
  assert.equal(me.user.email, "second@example.com")

  const bad = await fetch(`http://127.0.0.1:${PORT}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "second@example.com", password: "wrong" }),
  })
  assert.equal(bad.status, 401)

  const good = await fetch(`http://127.0.0.1:${PORT}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "second@example.com", password: "another good password" }),
  })
  assert.equal(good.status, 200)
  const freshJar = (good.headers.get("set-cookie") ?? "").split(";")[0]

  await asHost("/auth/logout", { method: "POST" }, freshJar)
  const after = await (await asHost("/auth/me", {}, freshJar)).json()
  assert.equal(after.user, null, "the session is gone once logged out")
})

test("a stranger cannot see, open or resume your games", async (t) => {
  const mine = client("host")
  await mine.ready
  const code = mine.identity.code
  mine.send("board:set", { board: { ...BOARD, id: "private-board", title: "My Quiz" } })
  await settle()
  mine.send("room:save")
  await settle(250)
  t.after(() => mine.ws.close())

  const strangerJar = await signUp("stranger@example.com", "not your business")

  await t.test("their room list does not contain it", async () => {
    const { rooms: theirs } = await (await asHost("/rooms", {}, strangerJar)).json()
    assert.ok(!theirs.some((r) => r.code === code), "someone else's saved game is not listed")
    const { rooms: ours } = await (await asHost("/rooms")).json()
    assert.ok(ours.some((r) => r.code === code), "but it is listed for its owner")
  })

  await t.test("they cannot read the saved room or the board", async () => {
    assert.equal((await asHost(`/rooms/${code}`, {}, strangerJar)).status, 403)
    assert.equal((await asHost("/boards/private-board", {}, strangerJar)).status, 403)
    assert.equal((await asHost("/boards/private-board")).status, 200, "the owner still can")
  })

  await t.test("they cannot delete it", async () => {
    assert.equal((await asHost(`/rooms/${code}`, { method: "DELETE" }, strangerJar)).status, 403)
    const { rooms } = await (await asHost("/rooms")).json()
    assert.ok(rooms.some((r) => r.code === code), "still there")
  })

  await t.test("they cannot take the host seat", async () => {
    const intruder = client("host", { code }, strangerJar)
    await intruder.ready
    assert.ok(intruder.errors.some((e) => e.code === "forbidden"), "told the game is not theirs")
    assert.equal(intruder.state, null, "and handed no state")
    intruder.ws.close()
  })
})

test("signed-out clients get nothing privileged", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/rooms`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/boards`)).status, 401)

  const anon = client("host", {}, "")
  await anon.ready
  assert.ok(anon.errors.some((e) => e.code === "auth"), "hosting requires an account")
  assert.equal(anon.state, null)
  anon.ws.close()
})

test("a controller needs the host's key, and the host can revoke it", async (t) => {
  const host = client("host")
  await host.ready
  const code = host.identity.code
  host.send("board:set", { board: BOARD })
  await settle()
  t.after(() => host.ws.close())

  await t.test("without a key it is refused", async () => {
    const nope = client("controller", { code }, "")
    await nope.ready
    assert.ok(nope.errors.some((e) => e.code === "auth"))
    assert.equal(nope.state, null)
    nope.ws.close()
  })

  const key = await new Promise((res) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === "controller-key") {
        host.ws.off("message", onMsg)
        res(m.key)
      }
    }
    host.ws.on("message", onMsg)
    host.send("controller:invite")
  })
  assert.ok(key && key.length > 6, "the host is handed a key to share")

  await t.test("with the key it gets the host's own view", async () => {
    const ctrl = client("controller", { code, key }, "")
    await ctrl.ready
    await settle()
    assert.equal(ctrl.state.code, code)
    assert.equal(ctrl.state.board.round.categories[0].clues[0].answer, "marble", "unredacted, like the host")

    // And it can actually drive the game.
    ctrl.send("game:start")
    await settle()
    assert.equal(host.state.phase, "board", "the host desk sees what the controller did")
    ctrl.ws.close()
  })

  await t.test("revoking closes the door behind it", async () => {
    host.send("controller:revoke")
    await settle(200)
    const stale = client("controller", { code, key }, "")
    await stale.ready
    assert.ok(stale.errors.some((e) => e.code === "auth"), "the old key is dead")
    stale.ws.close()
  })
})
