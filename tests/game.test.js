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

test("a nitro tile is wagered, solo, and ends on a miss", () => {
  const room = setup()
  G.currentRound(room).categories[2].clues[3].nitro = true
  room.players.get("p1").score = 900

  assert.deepEqual(kinds(G.selectClue(room, 2, 3)), ["nitro"])
  assert.equal(room.phase, G.PHASE.WAGER)

  G.setWager(room, "p1", 700)
  assert.equal(room.phase, G.PHASE.CLUE)
  assert.equal(room.buzzer.winner, "p1", "no race — it is that player's clue")
  assert.equal(G.stake(room), 700)
  assert.equal(G.armBuzzer(room).length, 0, "the buzzer cannot be opened on a nitro tile")

  G.judge(room, false)
  assert.equal(room.players.get("p1").score, 200)
  assert.equal(room.phase, G.PHASE.REVEAL, "a missed nitro tile ends the clue")
})

test("a wager is capped at the player's score, or the top tile if they are broke", () => {
  const room = setup()
  G.currentRound(room).categories[0].clues[1].nitro = true
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
        assert.equal(clue.nitro, undefined, `${role} got told where a nitro tile is`)
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

test("a nitro tile's prompt stays hidden while the wager is being set", () => {
  const room = setup()
  G.currentRound(room).categories[0].clues[0].nitro = true
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

// ── The final round ──────────────────────────────────────────────────────────

/** A room parked at the end of the board, with an enabled final and scores. */
function atFinal(scores = [1200, 800, -200]) {
  const room = setup(scores.length)
  room.board.final = {
    category: "STONE",
    prompt: "Black, veined with gold",
    media: null,
    answer: "marble",
    answerMedia: null,
    seconds: 30,
    enabled: true,
  }
  scores.forEach((s, i) => (room.players.get(`p${i}`).score = s))
  return room
}

test("the final is wagered blind, then written, then turned over", () => {
  const room = atFinal()
  assert.deepEqual(kinds(G.openFinal(room)), ["final-open"])
  assert.equal(room.phase, G.PHASE.FINAL)
  assert.equal(room.final.stage, "wager")

  G.setFinalWager(room, "p0", 500)
  G.setFinalWager(room, "p1", 800)
  assert.deepEqual(kinds(G.startFinal(room, 1000)), ["final-start"])
  assert.equal(room.final.stage, "clue")
  assert.equal(room.timer.endsAt, 1000 + 30_000)

  G.setFinalAnswer(room, "p0", "marble")
  G.setFinalAnswer(room, "p1", "granite")

  assert.deepEqual(kinds(G.revealFinal(room)), ["final-reveal"])
  // Poorest first, so the leader's result does not spoil the rest.
  assert.deepEqual(room.final.order, ["p1", "p0"])

  assert.deepEqual(kinds(G.judgeFinal(room, false)), ["final-wrong", "final-reveal"])
  assert.equal(room.players.get("p1").score, 0, "800 staked and lost")

  assert.deepEqual(kinds(G.judgeFinal(room, true)), ["final-correct", "game-end"])
  assert.equal(room.players.get("p0").score, 1700, "1200 + 500")
  assert.equal(room.phase, G.PHASE.ENDED)
})

test("you cannot stake more than you have, and a broke player sits it out", () => {
  const room = atFinal([600, 0, -100])
  G.openFinal(room)

  G.setFinalWager(room, "p0", 99999)
  assert.equal(room.final.wagers.p0, 600, "capped at the score")

  assert.equal(G.setFinalWager(room, "p1", 100).length, 0, "nothing to stake on zero")
  assert.equal(G.setFinalWager(room, "p2", 100).length, 0, "nor in the red")
  assert.deepEqual(G.finalEligible(room).map((p) => p.id), ["p0"])

  G.startFinal(room)
  G.revealFinal(room)
  assert.deepEqual(room.final.order, ["p0"], "only the eligible are turned over")
})

test("a player who never bets is staked at nothing rather than holding the room up", () => {
  const room = atFinal([500, 700])
  G.openFinal(room)
  G.setFinalWager(room, "p0", 200)
  G.startFinal(room)
  assert.equal(room.final.wagers.p1, 0)
})

test("answers stop being accepted once the clue is locked", () => {
  const room = atFinal([500, 700])
  G.openFinal(room)
  G.startFinal(room)
  G.setFinalAnswer(room, "p0", "marble")

  G.lockFinal(room)
  assert.equal(G.setFinalAnswer(room, "p0", "changed my mind").length, 0)
  assert.equal(room.final.answers.p0.text, "marble")
  assert.equal(room.timer, null)
})

test("the final clue is not on the wire before it is shown", () => {
  const room = atFinal()
  G.openFinal(room)

  for (const role of ["display", "player"]) {
    const f = G.projectState(room, role).final
    assert.equal(f.category, "STONE", "the category is the point of the wager")
    assert.equal(f.prompt, "", `${role} saw the prompt during wagering`)
    assert.equal(f.answer, null, `${role} saw the answer`)
  }
  assert.equal(G.projectState(room, "host").final.prompt, "Black, veined with gold")

  G.startFinal(room)
  assert.equal(G.projectState(room, "display").final.prompt, "Black, veined with gold")
  assert.equal(G.projectState(room, "display").final.answer, null, "the answer waits for the reveal")

  G.revealFinal(room)
  assert.equal(G.projectState(room, "display").final.answer, "marble")
})

test("a bet is blind: you see your own and nobody else's", () => {
  const room = atFinal([1200, 800])
  G.openFinal(room)
  G.setFinalWager(room, "p0", 500)
  G.setFinalWager(room, "p1", 800)
  G.setFinalAnswer(room, "p0", "marble")

  const mine = G.projectState(room, "player", "p0").final.players
  const me = mine.find((p) => p.id === "p0")
  const them = mine.find((p) => p.id === "p1")

  assert.equal(me.wager, 500, "my own bet is mine to see")
  assert.equal(them.wager, null, "theirs is not")
  assert.equal(them.wagered, true, "though that they have bet is public")
  assert.equal(them.answer, null)

  // The big screen is in the room with everyone, so it gets no more than they do.
  const screen = G.projectState(room, "display").final.players
  assert.equal(screen.find((p) => p.id === "p0").wager, null)
  assert.equal(G.projectState(room, "host").final.players.find((p) => p.id === "p0").wager, 500)
})

test("the reveal opens one player at a time", () => {
  const room = atFinal([1200, 800])
  G.openFinal(room)
  G.setFinalWager(room, "p0", 500)
  G.setFinalWager(room, "p1", 800)
  G.startFinal(room)
  G.setFinalAnswer(room, "p0", "marble")
  G.setFinalAnswer(room, "p1", "granite")
  G.revealFinal(room)

  const seen = () => {
    const f = G.projectState(room, "display").final
    return Object.fromEntries(f.players.map((p) => [p.id, p.answer]))
  }
  assert.deepEqual(seen(), { p1: "granite", p0: null }, "only the player being turned over")

  G.judgeFinal(room, false)
  assert.deepEqual(seen(), { p1: "granite", p0: "marble" }, "then the next one as well")
})

test("a final that was never written stays out of the way", () => {
  const room = atFinal()
  room.board.final.enabled = false
  assert.equal(G.openFinal(room).length, 0)
  assert.equal(G.projectState(room, "host").final, null)
})

test("auto-arm opens the buzzer with the clue, when asked to", () => {
  const off = setup()
  assert.deepEqual(kinds(G.selectClue(off, 0, 0)), ["clue-open"])
  assert.equal(off.buzzer.armed, false, "off by default — the host still arms")

  const on = setup(3, { autoArm: true })
  assert.deepEqual(kinds(G.selectClue(on, 0, 0)), ["clue-open", "buzzer-open"])
  assert.equal(on.buzzer.armed, true)
})

test("a reading delay holds the buzzer shut until the clock runs out", () => {
  const room = setup(3, { autoArm: true, readSeconds: 5 })
  assert.deepEqual(kinds(G.selectClue(room, 0, 0)), ["clue-open", "arm-pending"])
  assert.equal(room.buzzer.armed, false, "still shut while the host reads")
  assert.equal(room.timer.kind, "arm")
  assert.equal(room.timer.duration, 5)

  // Pressing during the read is still jumping the gun.
  assert.deepEqual(kinds(G.buzz(room, "p0")), ["buzz-early"])

  // The relay fires the deadline, which arms.
  G.armBuzzer(room)
  assert.equal(room.buzzer.armed, true)
})

test("auto-arm leaves a nitro tile alone", () => {
  const room = setup(3, { autoArm: true })
  G.currentRound(room).categories[0].clues[0].nitro = true
  assert.deepEqual(kinds(G.selectClue(room, 0, 0)), ["nitro"])
  assert.equal(room.buzzer.armed, false, "there is no race to open")
})

test("the race list reports margins behind the winner, not time since arming", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  // A host who arms and then reads the clue aloud for twenty seconds.
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 20_000)
  G.buzz(room, "p1", 20_090)

  const order = G.projectState(room, "host").buzzer.order
  assert.equal(order[0].behind, 0, "the winner is the baseline")
  assert.equal(order[1].behind, 90, "and the rest are measured against them")
  // The absolute figure is still there, and is still dominated by the host.
  assert.equal(order[0].ms, 20_000)
})

test("a clue can be given back to everyone after they have all missed it", () => {
  const room = setup(2)
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)

  G.buzz(room, "p0", 10)
  G.judge(room, false)
  G.buzz(room, "p1", 20)
  G.judge(room, false)

  assert.equal(G.everyoneSpent(room), true, "nobody is left to press")
  assert.equal(room.buzzer.armed, false)

  // Arming alone is not enough — everyone is still marked out.
  G.armBuzzer(room)
  assert.equal(G.buzz(room, "p0", 30).length, 0, "still spent")

  assert.deepEqual(kinds(G.reopenBuzzer(room, 1000)), ["buzzer-reopen"])
  assert.deepEqual(room.buzzer.spent, [], "the record of who is out is cleared")
  assert.equal(room.buzzer.armed, true, "and the buzzer is open in the same move")
  assert.deepEqual(kinds(G.buzz(room, "p0", 1100)), ["buzz-in"], "they can try again")
})

test("reopening leaves a nitro tile alone", () => {
  const room = setup()
  G.currentRound(room).categories[0].clues[0].nitro = true
  G.selectClue(room, 0, 0)
  G.setWager(room, "p0", 100)
  assert.equal(G.reopenBuzzer(room).length, 0, "it is one player's clue, not a race")
})

test("a nitro tile pays the wager, and costs the wager", () => {
  // 2000 in hand, 1000 staked: 3000 if it comes off, 1000 if it does not.
  const won = setup()
  G.currentRound(won).categories[0].clues[0].nitro = true
  won.players.get("p0").score = 2000
  G.selectClue(won, 0, 0)
  G.setWager(won, "p0", 1000)
  G.judge(won, true)
  assert.equal(won.players.get("p0").score, 3000)

  const lost = setup()
  G.currentRound(lost).categories[0].clues[0].nitro = true
  lost.players.get("p0").score = 2000
  G.selectClue(lost, 0, 0)
  G.setWager(lost, "p0", 1000)
  G.judge(lost, false)
  assert.equal(lost.players.get("p0").score, 1000)
})

test("staking everything is what doubles a score — the wager is the whole risk", () => {
  const room = setup()
  G.currentRound(room).categories[0].clues[0].nitro = true
  room.players.get("p0").score = 1500
  G.selectClue(room, 0, 0)
  G.setWager(room, "p0", 1500)
  G.judge(room, true)
  assert.equal(room.players.get("p0").score, 3000)
})

test("an ordinary clue pays its face value", () => {
  const room = setup()
  G.selectClue(room, 0, 1) // 400
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)
  assert.equal(room.players.get("p0").score, 400)
})

test("every score change is recorded with what it was for", () => {
  const room = setup()
  G.selectClue(room, 0, 1) // CAT0 400
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)
  G.closeClue(room)
  G.adjustScore(room, "p0", 50)

  const h = G.projectState(room, "host").players.find((p) => p.id === "p0").history
  assert.equal(h.length, 2)
  assert.deepEqual(
    h.map((e) => [e.delta, e.reason]),
    [
      [400, "correct"],
      [50, "adjust"],
    ],
  )
  assert.equal(h[0].detail, "CAT0 400", "and where it came from")
  assert.equal(h[1].score, 450, "with the running total")
})

test("undoing a ruling takes its history entry with it", () => {
  const room = setup()
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)
  assert.equal(room.players.get("p0").history.length, 1)

  G.undoJudgement(room)
  assert.equal(room.players.get("p0").history.length, 0, "or the working stops matching the total")
  assert.equal(room.players.get("p0").score, 0)
})

// ── Teams ────────────────────────────────────────────────────────────────────

/** A room in team mode. Returns the room and its two teams, in order. */
function teamed(n = 4, settings = {}) {
  const room = setup(n, settings)
  G.setTeamMode(room, true)
  const [a, b] = [...room.teams.values()]
  return { room, a, b }
}

test("turning teams on creates sides and seats everyone", () => {
  const { room, a, b } = teamed(4)
  assert.equal(room.settings.teams, true)
  assert.equal(room.teams.size, 2)
  assert.equal([...room.players.values()].filter((p) => !p.teamId).length, 0, "nobody is left without a side")
  assert.equal(G.membersOf(room, a.id).length + G.membersOf(room, b.id).length, 4)
})

test("turning teams on carries what people had already won", () => {
  const room = setup(2)
  room.players.get("p0").score = 300
  room.players.get("p1").score = 100
  G.setTeamMode(room, true)
  const total = [...room.teams.values()].reduce((n, t) => n + t.score, 0)
  assert.equal(total, 400, "the points are still in the room, just on sides now")
})

test("flipping teams off and on again does not re-add the carried scores", () => {
  const room = setup(2)
  room.players.get("p0").score = 300
  G.setTeamMode(room, true)
  const before = [...room.teams.values()].reduce((n, t) => n + t.score, 0)
  G.setTeamMode(room, false)
  G.setTeamMode(room, true)
  assert.equal([...room.teams.values()].reduce((n, t) => n + t.score, 0), before)
})

test("points a player wins land on their team", () => {
  const { room } = teamed(4)
  const team = G.teamOf(room, "p0")
  G.selectClue(room, 0, 1) // 400
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.judge(room, true)

  assert.equal(team.score, 400, "the side is paid")
  assert.equal(room.players.get("p0").score, 0, "and the individual tally is left alone")
  assert.equal(G.projectState(room, "host").players.find((p) => p.id === "p0").score, 400, "but a player is shown what they play for")
})

test("a team gets one entry in the race, not one per phone", () => {
  const { room } = teamed(4)
  const [x, y] = G.membersOf(room, G.teamOf(room, "p0").id).map((p) => p.id)
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)

  assert.deepEqual(kinds(G.buzz(room, x, 10)), ["buzz-in"])
  assert.deepEqual(G.buzz(room, y, 20), [], "a teammate cannot buzz in behind their own side")
  assert.equal(room.buzzer.order.length, 1)
})

test("a wrong answer puts the whole team out of the clue", () => {
  const { room } = teamed(4)
  const team = G.teamOf(room, "p0")
  const mates = G.membersOf(room, team.id).map((p) => p.id)
  G.selectClue(room, 0, 1)
  G.armBuzzer(room, 0)
  G.buzz(room, mates[0], 10)
  G.judge(room, false)

  assert.equal(team.score, -400, "the side is docked")
  for (const id of mates) assert.ok(room.buzzer.spent.includes(id), `${id} is out with their team`)
  assert.deepEqual(G.buzz(room, mates[1], 30), [], "and cannot have another go at it")
})

test("a team shares one lifeline purse", () => {
  const { room } = teamed(4, { lifelines: { phone: 1 } })
  const team = G.teamOf(room, "p0")
  const mates = G.membersOf(room, team.id).map((p) => p.id)

  assert.deepEqual(kinds(G.grantLifeline(room, mates[0], "phone", 0)), ["lifeline-start"])
  G.endLifeline(room)
  assert.equal(team.lifelines.phone, 0)
  assert.deepEqual(G.grantLifeline(room, mates[1], "phone", 0), [], "five phones is not five phone calls")
})

test("a nitro is wagered and ruled on by the team", () => {
  const { room, a } = teamed(4)
  a.score = 2000
  const round = G.currentRound(room)
  round.categories[0].clues[1].nitro = true

  G.selectClue(room, 0, 1)
  assert.equal(room.phase, G.PHASE.WAGER)

  G.setWager(room, a.id, 1000)
  assert.equal(room.phase, G.PHASE.CLUE)
  assert.equal(room.wager.teamId, a.id)
  assert.equal(room.buzzer.winner, null, "a team nitro has no single holder")

  // A bare ruling still has to find its target.
  G.judge(room, true)
  assert.equal(a.score, 3000, "2000 staking 1000 pays out to 3000")
})

test("undo on a team puts the team's score and history back", () => {
  const { room } = teamed(4)
  const team = G.teamOf(room, "p0")
  G.selectClue(room, 0, 1)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 5)
  G.judge(room, true)
  assert.equal(team.score, 400)
  assert.equal(team.history.length, 1)

  G.undoJudgement(room)
  assert.equal(team.score, 0)
  assert.equal(team.history.length, 0)
})

test("the final is played by sides, not seats", () => {
  const { room, a, b } = teamed(4)
  a.score = 1000
  b.score = 600
  room.board.final = { ...G.makeFinal(), enabled: true, prompt: "?", answer: "!" }
  G.openFinal(room)

  const [x, y] = G.membersOf(room, a.id).map((p) => p.id)
  G.setFinalWager(room, x, 400)
  assert.equal(room.final.wagers[a.id], 400, "the bet is the team's")
  G.setFinalWager(room, y, 700)
  assert.equal(room.final.wagers[a.id], 700, "and a teammate can change it")

  G.startFinal(room, 0)
  G.setFinalAnswer(room, y, "a guess")
  assert.equal(room.final.answers[a.id].text, "a guess", "one answer slip per team")

  G.revealFinal(room)
  assert.deepEqual(room.final.order, [b.id, a.id], "poorest side first")
  G.judgeFinal(room, false) // b, who bet nothing
  G.judgeFinal(room, true)
  assert.equal(a.score, 1700)
})

test("a team's own screen sees its bet, and nobody else's", () => {
  const { room, a, b } = teamed(4)
  a.score = 1000
  b.score = 600
  room.board.final = { ...G.makeFinal(), enabled: true, prompt: "?", answer: "!" }
  G.openFinal(room)
  const mine = G.membersOf(room, a.id).map((p) => p.id)
  G.setFinalWager(room, mine[0], 400)

  // The teammate who did not type it still needs to see it.
  const mate = G.projectState(room, "player", mine[1])
  assert.equal(mate.unit, a.id)
  assert.equal(mate.final.players.find((p) => p.id === a.id).wager, 400)

  const rival = G.projectState(room, "player", G.membersOf(room, b.id)[0].id)
  assert.equal(rival.final.players.find((p) => p.id === a.id).wager, null, "a blind bet stays blind across the room")
  assert.equal(rival.final.players.find((p) => p.id === a.id).wagered, true, "though that one exists is public")
})

test("teams survive being saved and reopened", () => {
  const { room, a } = teamed(4)
  a.score = 750
  a.name = "The Quizlings"
  const back = G.restoreRoom("TEST", G.snapshotRoom(room))

  assert.equal(back.settings.teams, true)
  assert.equal(back.teams.size, 2)
  const same = back.teams.get(a.id)
  assert.equal(same.name, "The Quizlings")
  assert.equal(same.score, 750)
  assert.deepEqual(
    G.membersOf(back, a.id).map((p) => p.id).sort(),
    G.membersOf(room, a.id).map((p) => p.id).sort(),
    "and everyone is on the side they were on",
  )
})

test("deleting a team leaves its players in the game", () => {
  const { room, a } = teamed(4)
  const mates = G.membersOf(room, a.id).map((p) => p.id)
  G.deleteTeam(room, a.id)
  assert.equal(room.teams.size, 1)
  for (const id of mates) assert.equal(room.players.get(id).teamId, null, "off the sheet, not out of the room")
})

test("evening up deals everyone out in join order", () => {
  const { room } = teamed(4)
  G.autoTeams(room, 2)
  const [a, b] = [...room.teams.keys()]
  assert.equal(G.membersOf(room, a).length, 2)
  assert.equal(G.membersOf(room, b).length, 2)
})

// ── Pause ────────────────────────────────────────────────────────────────────

test("a paused room takes no presses", () => {
  const room = setup(2, { answerSeconds: 0 })
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.pauseGame(room, 100)

  assert.equal(room.buzzer.armed, false, "the buzzer shuts with the room")
  assert.deepEqual(G.buzz(room, "p0", 200), [], "and a thumb on the button achieves nothing")
  assert.deepEqual(G.armBuzzer(room, 300), [], "nor can it be reopened while held")
})

test("pausing banks the clock and resuming gives back what was left", () => {
  const room = setup(2, { answerSeconds: 10 })
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 1000) // answer clock runs to 11000

  G.pauseGame(room, 4000)
  assert.equal(room.timer, null, "nothing is counting down while the room is held")

  G.resumeGame(room, 90_000)
  assert.equal(room.timer.endsAt, 90_000 + 7000, "the seven seconds that were left are still there")
  assert.equal(room.timer.kind, "answer")
})

test("putting a clue up is itself a resume", () => {
  const room = setup(2)
  G.selectClue(room, 0, 0)
  G.pauseGame(room, 100)
  G.closeClue(room)
  G.selectClue(room, 0, 1)
  assert.equal(room.paused, null, "the host moved on; the room is not still waiting")
})

// ── Mirroring the clue onto phones ───────────────────────────────────────────

test("by default a player's phone is sent the clue", () => {
  const room = setup(2)
  G.selectClue(room, 0, 0)
  const mine = G.projectState(room, "player", "p0")
  assert.equal(mine.clue.prompt, "prompt 0-0")
  assert.equal(mine.settings.mirrorClue, true)
})

test("with mirroring off the words are not sent, not merely hidden", () => {
  const room = setup(2, { mirrorClue: false })
  G.selectClue(room, 0, 0)

  const mine = G.projectState(room, "player", "p0")
  assert.equal(mine.clue.prompt, "", "a phone with devtools open learns nothing")
  assert.equal(mine.clue.media, null)
  // Enough to know which tile is in play, and what it is worth.
  assert.equal(mine.clue.category, "CAT0")
  assert.equal(mine.stake, 200)

  // The screen everyone is meant to be reading is untouched.
  assert.equal(G.projectState(room, "display").clue.prompt, "prompt 0-0")
  assert.equal(G.projectState(room, "host").clue.prompt, "prompt 0-0")
})

test("mirroring off withholds the answer from phones on the reveal too", () => {
  const room = setup(2, { mirrorClue: false })
  G.selectClue(room, 0, 0)
  G.revealAnswer(room)

  assert.equal(G.projectState(room, "player", "p0").clue.answer, null)
  assert.equal(G.projectState(room, "display").clue.answer, "answer 0-0", "the room still gets it")
})

test("the final is exempt — it is played on the phones", () => {
  const room = setup(2, { mirrorClue: false })
  room.board.final = { ...G.makeFinal(), enabled: true, category: "LAST", prompt: "the final clue", answer: "!" }
  room.players.get("p0").score = 500
  G.openFinal(room)
  G.startFinal(room, 0)

  assert.equal(
    G.projectState(room, "player", "p0").final.prompt,
    "the final clue",
    "withholding this would not hide the round, it would end it",
  )
})
