import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * Saved games are swept, so a machine that has hosted a hundred quizzes does
 * not carry a hundred rows forever.
 *
 * The file store reads its directory from the environment once, at import, so
 * this sets it before importing — which is also why this lives in its own file
 * rather than beside the relay tests.
 */
const dir = mkdtempSync(path.join(tmpdir(), "noggin-store-"))
process.env.NOGGIN_ROOM_DIR = path.join(dir, "rooms")
process.env.NOGGIN_DATA_DIR = path.join(dir, "boards")
process.env.NOGGIN_USER_DIR = path.join(dir, "users")
const { createFileStore } = await import("../server/store/files.js")

const roomFile = (code) => path.join(dir, "rooms", `${code}.json`)
const write = (code, savedAt) => {
  mkdirSync(path.join(dir, "rooms"), { recursive: true })
  writeFileSync(roomFile(code), JSON.stringify({ code, savedAt, players: [], board: {} }))
}

test("old saved games are swept and recent ones are not", async (t) => {
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createFileStore()
  const day = 24 * 60 * 60_000
  const now = Date.now()

  write("AAAA", now - 400 * day) // last year
  write("BBBB", now - 31 * day) // just over the line
  write("CCCC", now - 2 * day) // this week
  write("DDDD", now) // tonight

  const removed = await store.sweepRooms(now - 30 * day)
  assert.equal(removed, 2, "the two past the cutoff")
  assert.ok(!existsSync(roomFile("AAAA")))
  assert.ok(!existsSync(roomFile("BBBB")))
  assert.ok(existsSync(roomFile("CCCC")), "this week's game survives")
  assert.ok(existsSync(roomFile("DDDD")), "and tonight's certainly does")

  // Sweeping again is a no-op rather than an error.
  assert.equal(await store.sweepRooms(now - 30 * day), 0)
})

test("a snapshot with no savedAt is treated as ancient, not as new", async (t) => {
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createFileStore()
  // Hand-edited or pre-dating the field. Keeping it forever because a number
  // is missing is the failure mode this sweep exists to stop.
  write("EEEE", undefined)
  assert.equal(await store.sweepRooms(Date.now()), 1)
})
