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
