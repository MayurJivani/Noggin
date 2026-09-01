import test from "node:test"
import assert from "node:assert/strict"

import * as G from "../server/game.js"

/** A room with a filled-in first round and `n` seated players. */
function setup(n = 3, settings = {}) {
  const room = G.createRoom("TEST", settings)
  room.board = G.makeBoard()
  const round = room.board.rounds[0]
  round.categories.forEach((cat, ci) => {
    cat.title = `CAT${ci}`
    cat.clues.forEach((clue, qi) => {
      clue.prompt = `prompt ${ci}-${qi}`
      clue.answer = `answer ${ci}-${qi}`
    })
  })
  for (let i = 0; i < n; i++) {
    const p = G.makePlayer(`p${i}`, `Player ${i}`)
    p.lifelines = { ...room.settings.lifelines }
    room.players.set(p.id, p)
  }
  G.startGame(room)
  return room
}

const kinds = (effects) => effects.map((e) => e.kind)

test("selecting a clue puts it on screen and closes the buzzer", () => {
  const room = setup()
  const fx = G.selectClue(room, 1, 2)
  assert.equal(room.phase, G.PHASE.CLUE)
  assert.deepEqual(kinds(fx), ["clue-open"])
  assert.equal(G.activeClue(room).prompt, "prompt 1-2")
  assert.equal(room.buzzer.armed, false)
})

test("a played clue cannot be picked again", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.revealAnswer(room)
  G.closeClue(room)
  assert.equal(G.selectClue(room, 0, 0).length, 0)
  assert.equal(room.phase, G.PHASE.BOARD)
})

test("first buzz after arming wins; later buzzes are recorded but do not steal it", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 1000)

  assert.deepEqual(kinds(G.buzz(room, "p1", 1120)), ["buzz-in"])
  assert.deepEqual(kinds(G.buzz(room, "p2", 1180)), ["buzz-late"])

  assert.equal(room.buzzer.winner, "p1")
  assert.equal(room.buzzer.armed, false, "the gate shuts behind the winner")
  assert.deepEqual(
    room.buzzer.order.map((e) => [e.playerId, e.ms]),
    [
      ["p1", 120],
      ["p2", 180],
    ],
  )
})

test("losing the race is not the same offence as jumping the gun", () => {
  const room = setup(3, { earlyPenaltyMs: 500 })
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 1000)
  G.buzz(room, "p0", 1100)

  // p1 was 80ms slow. That must not be treated as an early press.
  assert.deepEqual(kinds(G.buzz(room, "p1", 1180)), ["buzz-late"])
  assert.equal(room.buzzer.lockedUntil.p1, undefined, "no penalty for being second")
})

test("re-arming after a miss lets an earlier loser press again", () => {
  const room = setup(3)
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 1000)
  G.buzz(room, "p0", 1100)
  G.buzz(room, "p1", 1150) // recorded as late

  G.judge(room, false) // p0 is out; the buzzer reopens for everyone else
  assert.deepEqual(kinds(G.buzz(room, "p1", 2000)), ["buzz-in"], "the stale race must not lock p1 out")
  assert.equal(room.buzzer.winner, "p1")
})

test("buzzing before the buzzer opens costs a lockout, not the clue", () => {
  const room = setup(3, { earlyPenaltyMs: 500 })
  G.selectClue(room, 0, 0)

  assert.deepEqual(kinds(G.buzz(room, "p0", 1000)), ["buzz-early"])
  assert.equal(room.buzzer.lockedUntil.p0, 1500)

  G.armBuzzer(room, 1100)
  assert.equal(G.buzz(room, "p0", 1200).length, 0, "still locked out")
  assert.equal(room.buzzer.winner, null)

  assert.deepEqual(kinds(G.buzz(room, "p0", 1600)), ["buzz-in"], "free once the penalty expires")
})

test("a correct answer pays the tile value and closes the clue", () => {
  const room = setup()
  G.selectClue(room, 0, 1) // 400
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)

  const fx = G.judge(room, true)
  assert.deepEqual(kinds(fx), ["correct"])
  assert.equal(room.players.get("p0").score, 400)
  assert.equal(room.phase, G.PHASE.REVEAL)
  assert.equal(G.currentRound(room).categories[0].clues[1].status, G.CLUE_STATUS.PLAYED)
})

test("a wrong answer deducts, locks that player out, and reopens for the rest", () => {
  const room = setup()
  G.selectClue(room, 0, 1) // 400
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)

  const fx = G.judge(room, false)
  assert.deepEqual(kinds(fx), ["wrong", "buzzer-open"])
  assert.equal(room.players.get("p0").score, -400)
  assert.deepEqual(room.buzzer.spent, ["p0"])
  assert.equal(room.buzzer.armed, true)
  assert.equal(room.phase, G.PHASE.CLUE, "the clue stays up for everyone else")

  assert.equal(G.buzz(room, "p0", 20).length, 0, "spent players are done for this clue")
})

test("penaltyForWrong off means a miss costs nothing", () => {
  const room = setup(3, { penaltyForWrong: false })
  G.selectClue(room, 0, 1)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.judge(room, false)
  assert.equal(room.players.get("p0").score, 0)
})

test("when the last player misses, the buzzer stays shut", () => {
  const room = setup(1)
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  const fx = G.judge(room, false)
  assert.deepEqual(kinds(fx), ["wrong"])
  assert.equal(room.buzzer.armed, false)
})

test("a daily double is wagered, solo, and ends on a miss", () => {
  const room = setup()
  G.currentRound(room).categories[2].clues[3].dailyDouble = true
  room.players.get("p1").score = 900

  assert.deepEqual(kinds(G.selectClue(room, 2, 3)), ["daily-double"])
  assert.equal(room.phase, G.PHASE.WAGER)

  G.setWager(room, "p1", 700)
  assert.equal(room.phase, G.PHASE.CLUE)
  assert.equal(room.buzzer.winner, "p1", "no race — it is that player's clue")
  assert.equal(G.stake(room), 700)
  assert.equal(G.armBuzzer(room).length, 0, "the buzzer cannot be opened on a daily double")

  G.judge(room, false)
  assert.equal(room.players.get("p1").score, 200)
  assert.equal(room.phase, G.PHASE.REVEAL, "a missed daily double ends the clue")
})

test("a wager is capped at the player's score, or the top tile if they are broke", () => {
  const room = setup()
  G.currentRound(room).categories[0].clues[1].dailyDouble = true
  room.players.get("p0").score = 50

  G.selectClue(room, 0, 1)
  G.setWager(room, "p0", 99999)
  assert.equal(room.wager.amount, 1000, "floor is the round's biggest tile")
})

test("clearing the board rolls into the next round, then ends the game", () => {
  const room = setup()
  const round = G.currentRound(room)
  for (const cat of round.categories) for (const clue of cat.clues) clue.status = G.CLUE_STATUS.PLAYED
  round.categories[0].clues[0].status = G.CLUE_STATUS.OPEN

  G.selectClue(room, 0, 0)
  G.revealAnswer(room)
  assert.deepEqual(kinds(G.closeClue(room)), ["round-complete"])
  assert.equal(room.phase, G.PHASE.INTERMISSION)

  G.nextRound(room)
  assert.equal(room.roundIndex, 1)
  assert.equal(room.phase, G.PHASE.BOARD)

  const last = G.currentRound(room)
  for (const cat of last.categories) for (const clue of cat.clues) clue.status = G.CLUE_STATUS.PLAYED
  last.categories[0].clues[0].status = G.CLUE_STATUS.OPEN
  G.selectClue(room, 0, 0)
  G.revealAnswer(room)
  assert.deepEqual(kinds(G.closeClue(room)), ["game-end"])
  assert.equal(room.phase, G.PHASE.ENDED)
})

test("phone a friend spends a charge, holds the clock, and shuts the buzzer", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 1000)

  const fx = G.grantLifeline(room, "p2", "phone", 2000)
  assert.deepEqual(kinds(fx), ["lifeline-start"])
  assert.equal(room.players.get("p2").lifelines.phone, 0)
  assert.equal(room.buzzer.armed, false)
  assert.equal(room.timer.endsAt, 2000 + 30_000)

  assert.equal(G.grantLifeline(room, "p2", "phone", 3000).length, 0, "only one charge")

  G.endLifeline(room)
  assert.equal(room.lifeline, null)
  assert.equal(room.timer, null)
})

test("scores can be corrected by hand", () => {
  const room = setup()
  G.adjustScore(room, "p0", 250)
  G.adjustScore(room, "p0", -50)
  assert.equal(room.players.get("p0").score, 200)
  G.setScore(room, "p0", -75)
  assert.equal(room.players.get("p0").score, -75)
})

test("reset reopens every clue and zeroes the room", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)
  G.closeClue(room)
  G.grantLifeline(room, "p1", "phone")

  G.resetGame(room)
  assert.equal(room.phase, G.PHASE.LOBBY)
  assert.equal(room.players.get("p0").score, 0)
  assert.equal(room.players.get("p1").lifelines.phone, 1)
  assert.ok(room.board.rounds.every((r) => r.categories.every((c) => c.clues.every((cl) => cl.status === G.CLUE_STATUS.OPEN))))
})

// ── Redaction ────────────────────────────────────────────────────────────────

test("players and the big screen never receive unplayed clue contents", () => {
  const room = setup()
  for (const role of ["display", "player"]) {
    const view = G.projectState(room, role)
    for (const cat of view.board.round.categories) {
      for (const clue of cat.clues) {
        assert.equal(clue.prompt, undefined, `${role} got a prompt`)
        assert.equal(clue.answer, undefined, `${role} got an answer`)
        assert.equal(clue.dailyDouble, undefined, `${role} got told where a daily double is`)
        assert.ok("value" in clue && "status" in clue, "but still enough to draw the board")
      }
    }
  }
  const host = G.projectState(room, "host")
  assert.equal(host.board.round.categories[0].clues[0].answer, "answer 0-0")
})

test("the answer to the live clue is withheld until it is revealed", () => {
  const room = setup()
  G.selectClue(room, 0, 0)

  assert.equal(G.projectState(room, "display").clue.answer, null)
  assert.equal(G.projectState(room, "player").clue.answer, null)
  assert.equal(G.projectState(room, "player").clue.prompt, "prompt 0-0", "the prompt itself is public")
  assert.equal(G.projectState(room, "host").clue.answer, "answer 0-0")

  G.revealAnswer(room)
  assert.equal(G.projectState(room, "display").clue.answer, "answer 0-0")
})

test("a daily double's prompt stays hidden while the wager is being set", () => {
  const room = setup()
  G.currentRound(room).categories[0].clues[0].dailyDouble = true
  G.selectClue(room, 0, 0)

  assert.equal(G.projectState(room, "display").clue.prompt, "", "no peeking before the bet")
  assert.equal(G.projectState(room, "host").clue.prompt, "prompt 0-0")

  G.setWager(room, "p0", 100)
  assert.equal(G.projectState(room, "display").clue.prompt, "prompt 0-0")
})

test("a controller sees exactly what the host sees", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  const host = G.projectState(room, "host")
  const controller = G.projectState(room, "controller")
  assert.deepEqual({ ...controller, serverNow: 0 }, { ...host, serverNow: 0 })
})

test("a mis-tapped ruling can be taken back", () => {
  const room = setup()
  G.selectClue(room, 0, 1) // 400
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)

  // The wrong button. Score down, player out, clue closed.
  G.judge(room, false)
  assert.equal(room.players.get("p0").score, -400)
  assert.deepEqual(room.buzzer.spent, ["p0"])

  assert.deepEqual(kinds(G.undoJudgement(room)), ["undo"])
  assert.equal(room.players.get("p0").score, 0, "the deduction is reversed")
  assert.deepEqual(room.buzzer.spent, [], "and they are back in the race")
  assert.equal(room.buzzer.winner, "p0", "still holding the buzzer, as before the ruling")
  assert.equal(room.phase, G.PHASE.CLUE)

  // Now rule the other way and the clue closes properly.
  G.judge(room, true)
  assert.equal(room.players.get("p0").score, 400)
  assert.equal(room.phase, G.PHASE.REVEAL)
})

test("undoing a correct ruling reopens the clue it closed", () => {
  const room = setup()
  G.selectClue(room, 0, 0) // 200
  G.armBuzzer(room, 0)
  G.buzz(room, "p1", 5)
  G.judge(room, true)
  assert.equal(G.currentRound(room).categories[0].clues[0].status, G.CLUE_STATUS.PLAYED)

  G.undoJudgement(room)
  assert.equal(room.players.get("p1").score, 0)
  assert.equal(G.currentRound(room).categories[0].clues[0].status, G.CLUE_STATUS.OPEN, "the tile is live again")
  assert.equal(room.revealed, false, "and the answer is off the screen")
})

test("there is only ever one ruling to undo", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)

  assert.equal(G.undoJudgement(room).length, 1)
  assert.equal(G.undoJudgement(room).length, 0, "a second undo does nothing")

  // And picking a new clue clears the slate.
  G.judge(room, true)
  G.closeClue(room)
  G.selectClue(room, 1, 0)
  assert.equal(room.lastJudgement, null)
  assert.equal(G.undoJudgement(room).length, 0)
})

test("only privileged roles are told an undo is available", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)

  assert.equal(G.projectState(room, "host").canUndo, true)
  assert.equal(G.projectState(room, "controller").canUndo, true)
  assert.equal(G.projectState(room, "display").canUndo, false)
  assert.equal(G.projectState(room, "player").canUndo, false)
})
