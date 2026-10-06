import test from "node:test"
import assert from "node:assert/strict"

import { duplicateBoard, parseBoardCsv } from "../src/lib/board.js"

test("a spreadsheet becomes a board", () => {
  const { board, issues } = parseBoardCsv(
    [
      "category,value,clue,answer,daily",
      "STONE,200,Black veined with gold,marble,",
      "STONE,400,Formed under pressure,diamond,yes",
      "METALS,200,Au,gold,",
      "METALS,400,Karats in pure gold,24,",
    ].join("\n"),
  )
  assert.deepEqual(issues, [])
  const round = board.rounds[0]
  assert.deepEqual(
    round.categories.map((c) => c.title),
    ["STONE", "METALS"],
    "columns follow the order they first appear",
  )
  assert.deepEqual(round.values, [200, 400], "rows are the value ladder, low to high")
  assert.equal(round.categories[0].clues[0].prompt, "Black veined with gold")
  assert.equal(round.categories[0].clues[1].nitro, true)
  assert.equal(round.categories[1].clues[1].answer, "24")
})

test("commas inside a clue do not shatter the row", () => {
  const { board } = parseBoardCsv('STONE,200,"Black, veined, and polished",marble')
  assert.equal(board.rounds[0].categories[0].clues[0].prompt, "Black, veined, and polished")
  assert.equal(board.rounds[0].categories[0].clues[0].answer, "marble")
})

test("a tab-separated paste out of a spreadsheet works too", () => {
  const { board } = parseBoardCsv("STONE\t200\tBlack, veined with gold\tmarble")
  assert.equal(board.rounds[0].categories[0].clues[0].prompt, "Black, veined with gold")
})

test("a header row is optional", () => {
  const { board } = parseBoardCsv("STONE,200,Au,gold")
  assert.equal(board.rounds[0].categories[0].clues[0].answer, "gold")
})

test("gaps leave an empty tile rather than shifting the ones below", () => {
  const { board } = parseBoardCsv(["STONE,200,a,1", "STONE,600,c,3", "METALS,400,b,2"].join("\n"))
  const round = board.rounds[0]
  assert.deepEqual(round.values, [200, 400, 600])
  const stone = round.categories[0].clues
  assert.equal(stone[0].prompt, "a")
  assert.equal(stone[1].prompt, "", "the missing 400 is a blank tile")
  assert.equal(stone[2].prompt, "c", "and 600 stays on the 600 row")
})

test("bad rows are reported by line, not fatal", () => {
  const { board, issues } = parseBoardCsv(
    ["STONE,200,fine,yes", "STONE,notanumber,broken,x", "MISSING", "METALS,200,no answer here,"].join("\n"),
  )
  assert.ok(board, "the good rows still import")
  assert.ok(issues.some((i) => i.includes("Line 2")), "the bad value is named")
  assert.ok(issues.some((i) => i.includes("Line 3")), "the short row is named")
  assert.ok(issues.some((i) => i.includes("Line 4") && /no answer/i.test(i)))
})

test("an empty file is refused rather than silently making a blank board", () => {
  assert.deepEqual(parseBoardCsv("   ").board, null)
  assert.deepEqual(parseBoardCsv("").issues, ["The file is empty."])
})

test("a duplicated board shares no ids with its original", () => {
  const { board } = parseBoardCsv("STONE,200,Au,gold")
  const copy = duplicateBoard(board)
  assert.notEqual(copy.id, board.id)
  assert.match(copy.title, /\(copy\)$/)
  const ids = (b) => b.rounds.flatMap((r) => [r.id, ...r.categories.flatMap((c) => [c.id, ...c.clues.map((cl) => cl.id)])])
  assert.equal(ids(copy).filter((id) => ids(board).includes(id)).length, 0, "nothing would overwrite the original")
})

// ── Saving a board ───────────────────────────────────────────────────────────

/**
 * The bug that cost a host their board.
 *
 * `fetch` resolves for 401, 403 and 400 — it only rejects when the request
 * never completed. Both the builder's autosave and the desk's push read a
 * resolved promise as "stored", so an expired session returned
 * `{"error":"sign in"}`, the dot went green, and the board existed nowhere but
 * that browser tab. `putBoard` is the single answer to "did it land".
 */
test("a refused save is reported, not rounded up to success", async () => {
  const { putBoard } = await import("../src/lib/net.js")
  const board = { id: "b_test", title: "Quiz" }

  const ok = (status, body) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

  assert.equal(await putBoard("http://relay", board, ok(200, { board })), null, "a stored board reports nothing wrong")

  // The one that actually happened: a session that expired overnight.
  assert.equal(await putBoard("http://relay", board, ok(401, { error: "sign in" })), "401 sign in")
  assert.equal(await putBoard("http://relay", board, ok(403, { error: "not yours" })), "403 not yours")
  assert.equal(await putBoard("http://relay", board, ok(400, { error: "bad board id" })), "400 bad board id")

  // A refusal with no JSON body still has to be a refusal rather than a pass.
  assert.equal(
    await putBoard("http://relay", board, async () => ({ ok: false, status: 502, json: async () => { throw new Error("not json") } })),
    "HTTP 502",
  )

  // And a genuinely dead network, which was being swallowed by `.catch(() => {})`.
  assert.equal(
    await putBoard("http://relay", board, async () => { throw new Error("Failed to fetch") }),
    "Failed to fetch",
  )
})

test("a board save goes to the board's own id, as a PUT with credentials", async () => {
  const { putBoard } = await import("../src/lib/net.js")
  let seen = null
  await putBoard("http://relay", { id: "b_abc", title: "Quiz" }, async (url, init) => {
    seen = { url, init }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  assert.equal(seen.url, "http://relay/boards/b_abc")
  assert.equal(seen.init.method, "PUT")
  assert.equal(seen.init.credentials, "include", "without the cookie every save is a 401")
  assert.equal(JSON.parse(seen.init.body).title, "Quiz")
})
