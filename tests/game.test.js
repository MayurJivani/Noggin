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
  // The final comes after the board, so put the room on its last round. The
  // default board has two, and a room sitting on round one is a room with a
  // round still to play — which `openFinal` now refuses, deliberately.
  room.roundIndex = room.board.rounds.length - 1
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
  // Poorest first, so the leader's result does not spoil the rest — and p2, on
  // -200, is in the running now that nobody is left out.
  assert.deepEqual(room.final.order, ["p2", "p1", "p0"])
  G.judgeFinal(room, false) // p2, who never bet, staked at nothing

  assert.deepEqual(kinds(G.judgeFinal(room, false)), ["final-wrong", "final-reveal"])
  assert.equal(room.players.get("p1").score, 0, "800 staked and lost")

  assert.deepEqual(kinds(G.judgeFinal(room, true)), ["final-correct", "game-end"])
  assert.equal(room.players.get("p0").score, 1700, "1200 + 500")
  assert.equal(room.phase, G.PHASE.ENDED)
})

test("everyone plays the final, with a thousand under every bet", () => {
  const room = atFinal([600, 0, -2500])
  G.openFinal(room)

  // The floor, for anyone whose score is smaller than it.
  assert.equal(G.maxFinalWager(600), 1000)
  assert.equal(G.maxFinalWager(0), 1000)
  // Above the floor it is your own score — and the sign is not the point, so
  // being deep in the red buys the same room to climb out of it.
  assert.equal(G.maxFinalWager(4000), 4000)
  assert.equal(G.maxFinalWager(-2500), 2500)

  G.setFinalWager(room, "p0", 99999)
  assert.equal(room.final.wagers.p0, 1000, "600 on the board, but the floor is a thousand")
  assert.equal(G.setFinalWager(room, "p1", 900).length, 1, "a player on nothing is still in it")
  assert.equal(room.final.wagers.p1, 900)
  G.setFinalWager(room, "p2", 99999)
  assert.equal(room.final.wagers.p2, 2500, "and one in the red bets their whole deficit")

  assert.deepEqual(G.finalEligible(room).map((p) => p.id), ["p0", "p1", "p2"], "nobody is left out")

  G.startFinal(room)
  G.revealFinal(room)
  assert.deepEqual(room.final.order, ["p2", "p1", "p0"], "still poorest first")
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
  room.roundIndex = room.board.rounds.length - 1
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
  room.roundIndex = room.board.rounds.length - 1
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
  room.roundIndex = room.board.rounds.length - 1
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

// ── Sound-checking the buzzers ───────────────────────────────────────────────

test("a test press proves the path and touches nothing else", () => {
  const room = setup(3)
  G.startCheck(room, 0)

  assert.deepEqual(kinds(G.buzz(room, "p0", 100)), ["check-hit"])
  assert.equal(room.check.hits.p0.count, 1)
  assert.equal(room.players.get("p0").score, 0, "nothing scores")
  assert.deepEqual(room.buzzer.order, [], "and it is not a race entry")
  assert.deepEqual(room.buzzer.spent, [])
})

test("only the first press is news; the rest are someone enjoying the button", () => {
  const room = setup(2)
  G.startCheck(room, 0)
  assert.deepEqual(kinds(G.buzz(room, "p0", 10)), ["check-hit"])
  assert.deepEqual(G.buzz(room, "p0", 20), [], "no second announcement")
  assert.equal(room.check.hits.p0.count, 2, "though it is still counted")
})

test("the test is complete when every seat has been heard from", () => {
  const room = setup(3)
  G.startCheck(room, 0)
  assert.equal(G.checkComplete(room), false)
  G.buzz(room, "p0", 10)
  G.buzz(room, "p1", 20)
  assert.equal(G.checkComplete(room), false, "two of three is not all of them")
  G.buzz(room, "p2", 30)
  assert.equal(G.checkComplete(room), true)
})

test("everyone can see the test, including the phone being tested", () => {
  const room = setup(2)
  G.startCheck(room, 0)
  G.buzz(room, "p0", 10)

  for (const role of ["host", "display", "player"]) {
    const view = G.projectState(room, role, "p0")
    assert.ok(view.check, `${role} is told a test is running`)
    assert.ok(view.check.hits.p0, `${role} sees the press land`)
  }
})

test("a test cannot be opened over a live clue", () => {
  const room = setup(2)
  G.selectClue(room, 0, 0)
  assert.deepEqual(G.startCheck(room, 0), [], "the buzzer is doing its real job")
  assert.equal(room.check, null)
})

test("putting a clue up ends any test, so presses count again", () => {
  const room = setup(2)
  G.startCheck(room, 0)
  G.selectClue(room, 0, 0)
  assert.equal(room.check, null, "or the test would swallow every buzz of the clue")

  G.armBuzzer(room, 0)
  assert.deepEqual(kinds(G.buzz(room, "p0", 40)), ["buzz-in"])
})

test("opening the board ends the test too", () => {
  const room = G.createRoom("TEST")
  room.board = G.makeBoard()
  room.players.set("p0", G.makePlayer("p0", "Player 0"))
  G.startCheck(room, 0)
  G.startGame(room)
  assert.equal(room.check, null)
})

// ── Evening out connections ──────────────────────────────────────────────────

/** A room where p0 is on the router and p1 is on the hotel wifi. */
function laggy(settings = {}) {
  const room = setup(2, { answerSeconds: 0, ...settings })
  room.players.get("p0").lag = 30
  room.players.get("p1").lag = 300
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  return room
}

test("without correction the faster connection simply wins", () => {
  const room = laggy()
  // Both react in 200ms. Their presses arrive 30ms and 300ms later.
  G.buzz(room, "p0", 230)
  G.buzz(room, "p1", 500)
  assert.equal(room.buzzer.winner, "p0", "which is a broadband test, not a quiz")
})

test("with correction the better reaction wins, whatever the wifi", () => {
  const room = laggy({ pingCorrection: true })

  // p1 reacts in 150ms, p0 in 200ms. p0's press still *arrives* first.
  G.buzz(room, "p1", 450) // 150 reaction + 300 lag
  G.buzz(room, "p0", 230) // 200 reaction + 30 lag
  assert.equal(room.buzzer.winner, null, "nothing is decided while the race is open")

  G.resolveBuzz(room, 600)
  assert.equal(room.buzzer.winner, "p1", "the quicker reaction takes it")
  assert.equal(room.buzzer.winnerMs, 150)
  assert.equal(room.buzzer.armed, false)
})

test("the race is held open only as long as the worst connection needs", () => {
  const room = laggy({ pingCorrection: true })
  G.buzz(room, "p0", 230)
  assert.equal(room.buzzer.settleUntil, 230 + 300, "the 300ms player could still be on their way")
  assert.equal(room.buzzer.armed, true, "and must still be able to get in")
})

test("a room with no measurements behaves exactly as it did before", () => {
  const room = setup(2, { answerSeconds: 0, pingCorrection: true })
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)

  assert.equal(G.settleWindow(room), 0, "nothing to correct for, so nothing to wait for")
  assert.deepEqual(kinds(G.buzz(room, "p0", 100)), ["buzz-in"])
  assert.equal(room.buzzer.winner, "p0")
})

test("the credit is capped, so a terrible connection cannot buy the buzz", () => {
  const room = setup(2, { answerSeconds: 0, pingCorrection: true })
  room.players.get("p0").lag = 30
  room.players.get("p1").lag = 4000 // claimed or genuine, it makes no difference
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)

  G.buzz(room, "p0", 230) // reaction 200
  G.buzz(room, "p1", 900) // credited at most 500, so judged at 400
  G.resolveBuzz(room, 1200)
  assert.equal(room.buzzer.winner, "p0", "500ms of credit is the most anyone gets")
})

test("the host's finish order is the one that was judged", () => {
  const room = laggy({ pingCorrection: true })
  G.buzz(room, "p0", 230)
  G.buzz(room, "p1", 450)
  G.resolveBuzz(room, 600)

  const order = G.projectState(room, "host").buzzer.order
  assert.deepEqual(order.map((e) => e.playerId), ["p1", "p0"], "sorted by reaction, not by arrival")
  assert.equal(order[0].behind, 0)
  assert.equal(order[1].behind, 50, "p0 reacted 50ms slower")
})

test("correction never applies to the sound-check or an early press", () => {
  const room = setup(2, { pingCorrection: true })
  room.players.get("p0").lag = 300

  G.startCheck(room, 0)
  assert.deepEqual(kinds(G.buzz(room, "p0", 10)), ["check-hit"])
  G.stopCheck(room)

  G.selectClue(room, 0, 0)
  assert.deepEqual(kinds(G.buzz(room, "p0", 20)), ["buzz-early"], "jumping the gun is still jumping the gun")
})

// ── The tie-break ────────────────────────────────────────────────────────────

/** A finished game with `scores` handed out, in player order. */
function ended(scores, settings = {}) {
  const room = setup(scores.length, settings)
  room.board.tiebreaks = [{ prompt: "Name it", media: null, answer: "That", answerMedia: null }]
  scores.forEach((s, i) => (room.players.get(`p${i}`).score = s))
  room.phase = G.PHASE.ENDED
  return room
}

test("a clear winner is not a tie", () => {
  const room = ended([500, 300, 100])
  assert.equal(G.isTied(room), false)
  assert.deepEqual(G.openTiebreak(room), [], "and there is nothing to play off")
  assert.equal(room.phase, G.PHASE.ENDED)
  assert.equal(G.projectState(room, "host").tied, null)
})

test("level at the top is, whatever is happening below it", () => {
  const room = ended([500, 500, 100])
  assert.deepEqual(
    G.leaders(room).map((u) => u.id).sort(),
    ["p0", "p1"],
    "third place is not in it",
  )
  assert.deepEqual(G.projectState(room, "display").tied.sort(), ["p0", "p1"])
})

test("a tie mid-game is just the state of play", () => {
  const room = setup(2)
  room.players.get("p0").score = 400
  room.players.get("p1").score = 400
  assert.deepEqual(G.openTiebreak(room), [], "nothing to decide until there is nothing left to play")
})

test("sudden death is for the tied sides and nobody else", () => {
  const room = ended([500, 500, 100])
  G.openTiebreak(room)
  assert.equal(room.phase, G.PHASE.TIEBREAK)
  G.armBuzzer(room, 0)

  assert.deepEqual(G.buzz(room, "p2", 10), [], "third place would be deciding somebody else's play-off")
  assert.deepEqual(kinds(G.buzz(room, "p1", 20)), ["buzz-in"])
})

test("the winner is recorded as a winner, not as a point", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.judgeTiebreak(room, true)

  assert.equal(room.winner, "p0")
  assert.equal(room.phase, G.PHASE.ENDED)
  assert.equal(room.players.get("p0").score, 500, "the scores were level and they stay level")
  assert.equal(room.players.get("p1").score, 500)
  assert.equal(G.projectState(room, "display").winner, "p0")
  assert.equal(G.projectState(room, "display").tied, null, "settled, so no longer offered")
})

test("a wrong answer puts that side out and leaves it to the other", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.judgeTiebreak(room, false)

  assert.deepEqual(room.tiebreak.spent, ["p0"])
  assert.equal(room.phase, G.PHASE.TIEBREAK, "still to be settled")
  assert.equal(room.winner, null)

  G.armBuzzer(room, 100)
  assert.deepEqual(G.buzz(room, "p0", 110), [], "and cannot have another go")
  assert.deepEqual(kinds(G.buzz(room, "p1", 120)), ["buzz-in"])
})

test("nobody getting it is not a win by elimination", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.judgeTiebreak(room, false)
  G.armBuzzer(room, 100)
  G.buzz(room, "p1", 110)
  const fx = G.judgeTiebreak(room, false)

  assert.deepEqual(kinds(fx), ["tiebreak-missed"])
  assert.equal(room.winner, null, "the last one standing answered nothing either")
  assert.equal(room.phase, G.PHASE.TIEBREAK)

  // The host runs another.
  G.tiebreakAgain(room, 200)
  assert.deepEqual(room.tiebreak.spent, [])
  assert.equal(room.tiebreak.round, 2)
  assert.deepEqual(kinds(G.buzz(room, "p0", 210)), ["buzz-in"], "everyone is back in")
})

test("the host can settle it by hand when the room settles it another way", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  G.awardTiebreak(room, "p1")
  assert.equal(room.winner, "p1")
  assert.equal(room.phase, G.PHASE.ENDED)
  assert.deepEqual(G.awardTiebreak(room, "p0"), [], "and only once")
})

test("only a contender can be awarded it", () => {
  const room = ended([500, 500, 100])
  G.openTiebreak(room)
  assert.deepEqual(G.awardTiebreak(room, "p2"), [], "third place did not tie for anything")
  assert.equal(room.winner, null)
})

test("teams tie as teams", () => {
  const { room, a, b } = teamed(4)
  a.score = 800
  b.score = 800
  room.board.tiebreaks = [{ prompt: "?", media: null, answer: "!", answerMedia: null }]
  room.phase = G.PHASE.ENDED

  assert.deepEqual(G.leaders(room).map((u) => u.id).sort(), [a.id, b.id].sort())
  G.openTiebreak(room)
  G.armBuzzer(room, 0)

  const one = G.membersOf(room, a.id).map((p) => p.id)
  assert.deepEqual(kinds(G.buzz(room, one[0], 10)), ["buzz-in"])
  G.judgeTiebreak(room, true)
  assert.equal(room.winner, a.id, "the side wins it, not the phone that pressed")
  assert.equal(a.score, 800)
})

test("the tie-break clue is served like any other, and redacted like one", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)

  assert.equal(G.projectState(room, "display").clue.prompt, "Name it")
  assert.equal(G.projectState(room, "display").clue.answer, null, "not before the reveal")
  assert.equal(G.projectState(room, "host").clue.answer, "That", "the host always has it")

  G.revealAnswer(room)
  assert.equal(G.projectState(room, "display").clue.answer, "That")
})

test("a play-off in flight is never resumed into", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  const back = G.restoreRoom("TEST", G.snapshotRoom(room))
  assert.equal(back.phase, G.PHASE.ENDED, "resuming a moment three days later is not resuming a game")
  assert.equal(G.isTied(back), true, "but it is still tied, so it can be offered again")
})

test("a settled winner survives being saved", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  G.awardTiebreak(room, "p0")
  assert.equal(G.restoreRoom("TEST", G.snapshotRoom(room)).winner, "p0")
})

test("resetting the game forgets who won", () => {
  const room = ended([500, 500])
  G.openTiebreak(room)
  G.awardTiebreak(room, "p0")
  G.resetGame(room)
  assert.equal(room.winner, null)
  assert.equal(room.tiebreak, null)
})

// ── The survey round ─────────────────────────────────────────────────────────

/** A room with a survey board waiting at the end. */
function surveyed(n = 3) {
  const room = setup(n)
  room.board.survey = {
    enabled: true,
    collecting: true,
    questions: [
      {
        id: "q1",
        category: "SUPERMARKET",
        prompt: "Name something you always forget to buy",
        answers: [
          { text: "Milk", points: 400 },
          { text: "Bin bags", points: 300 },
          { text: "Batteries", points: 200 },
        ],
      },
      { id: "q2", category: "HOLIDAYS", prompt: "Name something you always pack too many of", answers: [{ text: "Socks", points: 500 }] },
    ],
  }
  // Distinct scores, so the cut is not in question — a contested one has its
  // own tests. The top two go through; anyone below them is out of the round.
  ;[...room.players.values()].forEach((p, i) => (p.score = 300 - i * 100))
  room.phase = G.PHASE.ENDED
  return room
}

test("the survey round comes last, after everything else is settled", () => {
  const room = surveyed()
  room.phase = G.PHASE.CLUE
  assert.deepEqual(G.openSurvey(room), [], "not while a clue is up")

  room.phase = G.PHASE.ENDED
  assert.deepEqual(kinds(G.openSurvey(room)), ["survey-open"])
  assert.equal(room.phase, G.PHASE.SURVEY)
})

test("a board with no survey has nothing to open", () => {
  const room = setup(2)
  room.phase = G.PHASE.ENDED
  assert.deepEqual(G.openSurvey(room), [])
  assert.equal(G.projectState(room, "host").survey, null)
})

test("the board is hidden from the room and open to the host", () => {
  const room = surveyed()
  G.openSurvey(room)

  const seen = G.projectState(room, "display").survey
  assert.equal(seen.slots, 3, "the shape is public — that is the tension")
  assert.deepEqual(
    seen.answers.map((a) => [a.text, a.points]),
    [[null, null], [null, null], [null, null]],
    "a slot that shipped its answer would be a round decided by devtools",
  )
  assert.equal(G.projectState(room, "host").survey.answers[0].text, "Milk", "the host has to find the match")
})

test("the buzzer races for it, and finding one pays", () => {
  const room = surveyed()
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  assert.deepEqual(kinds(G.buzz(room, "p1", 10)), ["buzz-in"])

  assert.deepEqual(kinds(G.revealSurvey(room, 1)), ["survey-hit"])
  // Survey points, on their own board — the quiz score is untouched.
  assert.equal(room.survey.points.p1, 300)
  assert.equal(room.players.get("p1").score, 200, "the game score it came in with")
  assert.equal(room.survey.awards[1], "p1")
  assert.equal(room.buzzer.winner, null, "and the buzz is given back up")

  const seen = G.projectState(room, "display").survey
  assert.equal(seen.answers[1].text, "Bin bags", "open to everyone now")
  assert.equal(seen.answers[0].text, null, "the rest stay hidden")
})

test("whoever buzzed types what they said, and only they can", () => {
  const room = surveyed()
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)

  assert.deepEqual(G.saySurvey(room, "p1", "Bin bags"), [], "everyone typing at once would be a chat")
  assert.deepEqual(kinds(G.saySurvey(room, "p0", "Milk")), ["survey-said"])
  assert.equal(G.projectState(room, "host").survey.said.text, "Milk")

  // And it clears when the host acts, so the next racer starts blank.
  G.revealSurvey(room, 0)
  assert.equal(room.survey.said, null)
})

test("a strike costs the buzz and nothing else", () => {
  const room = surveyed()
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)

  assert.deepEqual(kinds(G.strikeSurvey(room, undefined, 100)), ["survey-strike"])
  assert.equal(room.survey.points.p0 ?? 0, 0, "wrong on this board costs points from nobody")
  assert.equal(room.buzzer.armed, true, "straight back out to the room")
  assert.deepEqual(room.buzzer.spent, [], "there are still slots to find")
  assert.deepEqual(kinds(G.buzz(room, "p0", 110)), ["buzz-in"], "including for whoever just missed")
})

test("the same slot cannot be claimed twice", () => {
  const room = surveyed()
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.revealSurvey(room, 0)
  assert.equal(room.survey.points.p0, 400)

  G.armBuzzer(room, 100)
  G.buzz(room, "p1", 110)
  assert.deepEqual(G.revealSurvey(room, 0), [], "already open")
  assert.equal(room.survey.points.p1 ?? 0, 0)
})

test("answers belong to a question, and the tallies stay apart", () => {
  const room = surveyed()
  G.addResponse(room, "q1", "Milk", 1)
  G.addResponse(room, "q2", "Socks", 1)
  G.addResponse(room, "q2", "Socks", 2)
  assert.equal(G.addResponse(room, "nope", "Milk", 3), null, "a reply to a question nobody was asked")

  assert.deepEqual(G.tallyResponses(room, "q1").map((g) => g.count), [1])
  assert.deepEqual(G.tallyResponses(room, "q2").map((g) => g.count), [2])
})

test("the round walks the questions, one board at a time", () => {
  const room = surveyed()
  G.openSurvey(room)
  assert.equal(room.survey.index, 0)

  const first = G.projectState(room, "display").survey
  assert.equal(first.count, 2)
  assert.equal(first.slots, 3)
  assert.equal(first.last, false)

  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.revealSurvey(room, 0)
  assert.equal(room.survey.points.p0, 400)

  assert.deepEqual(kinds(G.nextQuestion(room)), ["survey-next"])
  const second = G.projectState(room, "display").survey
  assert.equal(second.index, 1)
  assert.equal(second.slots, 1, "a different board")
  assert.equal(second.last, true)
  assert.deepEqual(second.answers.map((a) => a.open), [false], "and a fresh one")
  assert.equal(room.survey.points.p0, 400, "but the points already won stay won")

  assert.deepEqual(G.nextQuestion(room), [], "there is no sixth question")
})

test("a strike does not follow you to the next question", () => {
  const room = surveyed()
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  G.strikeSurvey(room, undefined, 20)
  assert.equal(room.survey.strikes.length, 1)

  G.nextQuestion(room)
  assert.deepEqual(room.survey.strikes, [], "each board starts clean")
})

test("only the question being played is sent to the room", () => {
  const room = surveyed()
  G.openSurvey(room)
  const seen = G.projectState(room, "display").survey
  assert.equal(seen.prompt, "Name something you always forget to buy")
  assert.equal(seen.questions, undefined, "the other four are still to come")
})

test("clearing the board is announced", () => {
  const room = surveyed()
  G.openSurvey(room)
  for (const i of [0, 1]) {
    G.armBuzzer(room, 0)
    G.buzz(room, "p0", 10)
    assert.deepEqual(kinds(G.revealSurvey(room, i)), ["survey-hit"])
  }
  G.armBuzzer(room, 0)
  G.buzz(room, "p0", 10)
  assert.deepEqual(kinds(G.revealSurvey(room, 2)), ["survey-hit", "survey-cleared"])
  assert.equal(G.projectState(room, "display").survey.cleared, true)
})

test("the host can open a slot nobody got, and it pays nobody", () => {
  const room = surveyed()
  G.openSurvey(room)
  G.revealSurvey(room, 2, null)
  assert.equal(room.survey.awards[2], undefined)
  assert.equal(G.projectState(room, "display").survey.answers[2].text, "Batteries")
  for (const p of room.players.values()) assert.equal(room.survey.points[p.id] ?? 0, 0)
})

test("a survey round can leave a tie, and the tie-break picks it up", () => {
  const room = surveyed(2)
  G.openSurvey(room)
  room.players.get("p0").score = 400
  room.players.get("p1").score = 400
  assert.deepEqual(kinds(G.closeSurvey(room)), ["game-end"])

  assert.equal(room.phase, G.PHASE.ENDED)
  assert.equal(G.isTied(room), true)
  assert.deepEqual(kinds(G.openTiebreak(room)), ["tiebreak-open"])
})

test("teams take the points as a team", () => {
  const { room, a } = teamed(4)
  room.board.survey = { enabled: true, collecting: true, questions: [{ id: "q1", category: "", prompt: "?", answers: [{ text: "Milk", points: 400 }] }] }
  room.phase = G.PHASE.ENDED
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  const one = G.membersOf(room, a.id)[0].id
  G.buzz(room, one, 10)
  G.revealSurvey(room, 0)

  assert.equal(room.survey.points[a.id], 400)
  assert.equal(room.survey.awards[0], a.id, "the side found it, not the phone")
})

// ── Asking a hundred people ──────────────────────────────────────────────────

test("the public link collects answers, and says how many", () => {
  const room = surveyed()
  assert.deepEqual(G.addResponse(room, "q1", "Milk", 1), { count: 1 })
  assert.deepEqual(G.addResponse(room, "q1", "  Bin bags  ", 2), { count: 2 })
  assert.equal(G.addResponse(room, "q1", "   ", 3), null, "an empty answer is not an answer")
  assert.equal(room.responses.length, 2)
  assert.equal(G.projectState(room, "display").survey.responses, 2)
})

test("collection can be closed without disabling the round", () => {
  const room = surveyed()
  room.board.survey.collecting = false
  assert.equal(G.addResponse(room, "q1", "Milk", 1), null)
})

test("the tally folds what people meant, not what they typed", () => {
  const room = surveyed()
  for (const t of ["Milk", "milk", "  MILK ", "bin bags", "Bin Bags!", "the batteries", "Batteries"]) G.addResponse(room, "q1", t, 1)

  const tally = G.tallyResponses(room, "q1")
  assert.deepEqual(
    tally.map((g) => [g.key, g.count]),
    [
      ["milk", 3],
      ["batteries", 2],
      ["bin bags", 2],
    ],
    "case, punctuation and a leading article are not different answers",
  )
  assert.equal(tally[0].label, "Milk", "labelled how most people wrote it")
  assert.equal(tally[1].label, "Batteries", "not 'the batteries', which one person typed")
})

test("equal answers order by the normalised form, not by capitalisation", () => {
  const room = surveyed()
  for (const t of ["zebra", "Apple"]) G.addResponse(room, "q1", t, 1)
  assert.deepEqual(G.tallyResponses(room, "q1").map((g) => g.key), ["apple", "zebra"])
})

test("the tally is the host's alone", () => {
  const room = surveyed()
  G.addResponse(room, "q1", "Milk", 1)
  assert.equal(G.projectState(room, "player", "p0").survey.questions, undefined, "it is the answer sheet")
  assert.ok(G.projectState(room, "host").survey.questions[0].tally.length)
})

test("collected answers survive being saved", () => {
  const room = surveyed()
  G.addResponse(room, "q1", "Milk", 1)
  G.addResponse(room, "q1", "Bin bags", 2)
  const back = G.restoreRoom("TEST", G.snapshotRoom(room))
  assert.equal(back.responses.length, 2, "they were gathered over days — losing them loses the round")
  assert.deepEqual(G.tallyResponses(back, "q1").map((g) => g.count), [1, 1])
})

test("a survey round in flight is never resumed into", () => {
  const room = surveyed()
  G.openSurvey(room)
  assert.equal(G.restoreRoom("TEST", G.snapshotRoom(room)).phase, G.PHASE.ENDED)
})

test("the written final is untouched by any of this", () => {
  const room = setup(2)
  room.roundIndex = room.board.rounds.length - 1
  room.board.final = { ...G.makeFinal(), enabled: true, prompt: "?", answer: "!" }
  room.players.get("p0").score = 500
  G.openFinal(room)

  assert.equal(room.final.stage, "wager", "still the blind bet")
  assert.deepEqual(G.revealSurvey(room, 0), [], "and the survey moves do nothing to it")
  assert.deepEqual(G.strikeSurvey(room), [])
})

/**
 * The running order.
 *
 * Rounds, then the final if there is one, then the survey if there is one,
 * then a tie-break if the scores are still level — in that order, decided by
 * the engine rather than by which button a screen happens to render.
 */
test("the final waits for the board and then cannot be skipped", () => {
  const room = atFinal([500, 300])
  room.roundIndex = 0 // back to round one of two

  assert.equal(G.pending(room), "final", "owed from the start")
  assert.deepEqual(G.openFinal(room), [], "but not while a round is unplayed")

  // Clearing round one goes to the next round, not to the final and not to the end.
  clearRound(room)
  assert.equal(room.phase, G.PHASE.INTERMISSION)
  G.nextRound(room)
  assert.equal(room.roundIndex, 1)

  // Clearing the last round must not end the game while the final is owed.
  clearRound(room)
  assert.equal(room.phase, G.PHASE.INTERMISSION, "the board is done; the game is not")
  assert.deepEqual(G.nextRound(room), [], "and 'next round' is not a way past the final")
  assert.equal(room.phase, G.PHASE.INTERMISSION)

  assert.deepEqual(kinds(G.openFinal(room)), ["final-open"], "now it opens")
})

test("the survey comes after the final, and the tie-break after both", () => {
  const room = atFinal([500, 500])
  clearRound(room)
  room.board.survey = { ...room.board.survey, enabled: true }
  room.board.survey.questions[0].prompt = "Something you forget"
  room.board.survey.questions[0].answers = [{ text: "Milk", points: 100 }]

  assert.equal(G.pending(room), "final")
  assert.deepEqual(G.openSurvey(room), [], "the survey does not jump the final")

  G.openFinal(room)
  G.setFinalWager(room, "p0", 0)
  G.setFinalWager(room, "p1", 0)
  G.startFinal(room)
  G.lockFinal(room)
  G.revealFinal(room)
  G.judgeFinal(room, false)
  G.judgeFinal(room, false)

  assert.equal(room.phase, G.PHASE.ENDED)
  assert.equal(G.pending(room), "survey", "the final is spent, the survey is owed")

  // Level on 500 apiece — but a tie settled now would be settled on numbers the
  // survey is about to change, so it is not offered.
  assert.equal(G.projectState(room, "host").tied, null, "no play-off while a scoring round is owed")
  assert.equal(G.projectState(room, "host").survey.offered, true)

  G.openSurvey(room)
  G.closeSurvey(room)
  assert.equal(G.pending(room), null, "nothing left that scores")
  assert.deepEqual(G.projectState(room, "host").tied, ["p0", "p1"], "now the tie is worth breaking")
})

test("a spent final is not offered again after a resume", () => {
  const room = atFinal([500, 300])
  clearRound(room)
  G.openFinal(room)
  G.setFinalWager(room, "p0", 100)
  G.startFinal(room)
  G.lockFinal(room)
  G.revealFinal(room)
  // Both are eligible — a player who never bet is still turned over, staked at
  // nothing — so the final is not spent until the last one is judged.
  assert.equal(room.final.order.length, 2)
  G.judgeFinal(room, true)
  assert.equal(G.pending(room), "final", "still owed with one left to turn over")
  G.judgeFinal(room, true)

  assert.equal(G.pending(room), null)
  // Paying a wager twice is the failure this guards against.
  const back = G.restoreRoom("TEST", G.snapshotRoom(room))
  assert.equal(G.pending(back), null, "a resumed game remembers its final is spent")
  assert.deepEqual(G.openFinal(back), [])
})

/** Play out every clue on the current round. */
function clearRound(room) {
  const round = room.board.rounds[room.roundIndex]
  round.categories.forEach((cat, ci) =>
    cat.clues.forEach((_, qi) => {
      G.selectClue(room, ci, qi)
      G.closeClue(room)
    }),
  )
}

test("the buzzer check ranks the room the way a real race would", () => {
  const room = setup(3, { pingCorrection: true })
  room.players.get("p0").lag = 300 // hotel wifi
  room.players.get("p1").lag = 20 // plugged into the router
  room.players.get("p2").lag = 20

  G.startCheck(room, 1000)
  // p0 reacted fastest but their press takes longest to arrive.
  G.checkBuzz(room, "p1", 1150)
  G.checkBuzz(room, "p0", 1200)
  G.checkBuzz(room, "p2", 1400)

  const order = G.checkOrder(room)
  assert.deepEqual(
    order.map((r) => r.id),
    ["p0", "p1", "p2"],
    "the slow connection reacted first and must be ranked first",
  )
  assert.deepEqual(order.map((r) => r.place), [1, 2, 3])
  assert.equal(order[0].behind, 0)
  // p0 arrived at 200ms and is credited its whole 300ms of lag, so it is judged
  // at -100; p1 arrived at 150 and is credited 20, so 130. The gap the host
  // reads is 230ms — and on arrival alone p1 looked 50ms faster.
  assert.equal(order[1].behind, 230)

  // The same presses without correction rank on arrival, and the check must
  // say so rather than quietly showing a different answer to the game's.
  room.settings.pingCorrection = false
  assert.deepEqual(
    G.checkOrder(room).map((r) => r.id),
    ["p1", "p0", "p2"],
  )
})

test("a check press is a rehearsal, not a race entry", () => {
  const room = setup(2)
  G.startCheck(room, 1000)
  G.checkBuzz(room, "p0", 1100)
  assert.equal(G.checkOrder(room).length, 1)
  assert.equal(room.players.get("p0").score, 0, "nothing is scored")
  assert.equal(room.buzzer.winner, null, "and nobody is holding the buzzer")
})

test("a nitro bet has the same floor as the final, and reads a deficit as size", () => {
  const room = setup(3)
  const top = Math.max(...room.board.rounds[0].values)

  // A side on nothing can still swing the game.
  assert.equal(G.maxWager(room, "p0"), Math.max(1000, top))

  // Deep in the red is exactly who the mechanic is for: the magnitude counts,
  // where the old rule gave them the floor and no more.
  room.players.get("p1").score = -2500
  assert.equal(G.maxWager(room, "p1"), 2500)

  // Above the floor it is simply your score.
  room.players.get("p2").score = 4000
  assert.equal(G.maxWager(room, "p2"), 4000)

  // And the cap is enforced, not merely advertised.
  G.currentRound(room).categories[0].clues[0].nitro = true
  G.selectClue(room, 0, 0)
  assert.equal(room.phase, G.PHASE.WAGER)
  G.setWager(room, "p1", 99999)
  assert.equal(room.wager.amount, 2500)
})

/**
 * Two play-offs, for two different things.
 *
 * One before the survey, to settle who plays it; one after, to settle who won.
 * They share the sudden-death machinery and disagree only about what taking it
 * buys.
 */
test("a level cut is played off before the survey, and wins a seat rather than the game", () => {
  const room = surveyed(3)
  // Second and third are level, so the last seat is in question.
  room.players.get("p0").score = 500
  room.players.get("p1").score = 200
  room.players.get("p2").score = 200

  assert.equal(G.pending(room), "tiebreak-cut", "the survey cannot start two-handed until it knows which two")
  assert.deepEqual(G.openSurvey(room), [], "and it refuses to")

  const cut = G.surveyCut(room)
  assert.deepEqual(cut.through, ["p0"], "the leader is through outright")
  assert.deepEqual(cut.contested.sort(), ["p1", "p2"])
  assert.equal(cut.seats, 1)

  assert.deepEqual(kinds(G.openTiebreak(room)), ["tiebreak-open"])
  assert.equal(room.tiebreak.purpose, "cut")
  assert.deepEqual(room.tiebreak.contenders.sort(), ["p1", "p2"], "the leader is not dragged into it")

  G.armBuzzer(room, 0)
  G.buzz(room, "p2", 10)
  assert.deepEqual(kinds(G.judgeTiebreak(room, true)), ["tiebreak-through", "game-end"])

  assert.equal(room.winner, null, "a seat, not the game")
  assert.equal(room.players.get("p2").score, 200, "and not a point either — they are still level")
  assert.deepEqual(G.surveyCut(room).through.sort(), ["p0", "p2"])
  assert.equal(G.pending(room), "survey")
})

test("only the two who made the cut can press during the survey", () => {
  const room = surveyed(3) // 300 / 200 / 100
  G.openSurvey(room)
  assert.deepEqual(room.survey.contenders, ["p0", "p1"])

  G.armBuzzer(room, 0)
  assert.deepEqual(G.buzz(room, "p2", 10), [], "third place is watching")
  assert.equal(room.buzzer.winner, null)
  assert.deepEqual(kinds(G.buzz(room, "p1", 20)), ["buzz-in"])
})

test("survey points are their own scoreboard, and they decide the winner", () => {
  const room = surveyed(3)
  const before = [...room.players.values()].map((p) => p.score)
  G.openSurvey(room)

  // p1 is behind on the quiz and takes the round anyway — which is the point of
  // a round with its own points.
  G.armBuzzer(room, 0)
  G.buzz(room, "p1", 10)
  G.revealSurvey(room, 0) // 400

  assert.deepEqual([...room.players.values()].map((p) => p.score), before, "the quiz score never moved")
  assert.equal(room.survey.points.p1, 400)

  G.closeSurvey(room)
  assert.equal(G.pending(room), null)
  assert.deepEqual(G.leaders(room).map((u) => u.id), ["p1"], "decided on survey points, not the quiz lead")
  assert.equal(G.projectState(room, "host").tied, null, "a clear winner needs no play-off")
})

test("level on survey points is played off, and only one wins", () => {
  const room = surveyed(3)
  G.openSurvey(room)
  // Neither finds anything: nil-all.
  G.closeSurvey(room)

  assert.equal(G.pending(room), null)
  assert.deepEqual(G.projectState(room, "host").tied.sort(), ["p0", "p1"], "the two who played it, level")

  assert.deepEqual(kinds(G.openTiebreak(room)), ["tiebreak-open"])
  assert.equal(room.tiebreak.purpose, "winner", "this one is for the game")
  G.armBuzzer(room, 0)
  G.buzz(room, "p1", 10)
  assert.deepEqual(kinds(G.judgeTiebreak(room, true)), ["tiebreak-won", "game-end"])
  assert.equal(room.winner, "p1")
})

test("a side knocked out at the cut cannot finish level with the winner", () => {
  const room = surveyed(3)
  room.players.get("p0").score = 500
  room.players.get("p1").score = 200
  room.players.get("p2").score = 200

  G.openTiebreak(room)
  G.awardTiebreak(room, "p1") // p1 takes the seat; p2 is out, still on 200
  G.openSurvey(room)
  G.closeSurvey(room) // nobody scores; p0 and p1 are level on nil

  const tied = G.projectState(room, "host").tied
  assert.deepEqual(tied.sort(), ["p0", "p1"], "p2 is level on the quiz but was not in the round")
})

test("a seat won in a play-off survives a save", () => {
  const room = surveyed(3)
  room.players.get("p1").score = 200
  room.players.get("p2").score = 200
  G.openTiebreak(room)
  G.awardTiebreak(room, "p2")

  const back = G.restoreRoom("TEST", G.snapshotRoom(room))
  assert.deepEqual(back.qualified, ["p2"])
  assert.equal(G.pending(back), "survey", "the cut is settled and stays settled")
})

test("the game names a champion, not just a tie-break winner", () => {
  const room = surveyed(3) // 300 / 200 / 100
  G.openSurvey(room)
  G.armBuzzer(room, 0)
  G.buzz(room, "p1", 10)
  G.revealSurvey(room, 0) // p1 takes 400 survey points
  G.closeSurvey(room)

  const st = G.projectState(room, "display")
  assert.equal(st.winner, null, "no play-off happened")
  assert.equal(st.champion, "p1", "but somebody plainly won it")
  assert.equal(st.tied, null)

  // The board is still ordered on quiz score, where p1 is second — which is
  // exactly why the champion has to be named rather than inferred from the top
  // of the list.
  assert.deepEqual(st.players.map((p) => p.id), ["p0", "p1", "p2"])
})

test("nobody is champion while the game is level or still owed a round", () => {
  const level = surveyed(3)
  G.openSurvey(level)
  G.closeSurvey(level) // nil-all between the two contenders
  assert.equal(G.projectState(level, "host").champion, null, "level is not a win")

  const owed = surveyed(3)
  assert.equal(G.pending(owed), "survey")
  assert.equal(G.projectState(owed, "host").champion, null, "a round still to play is not a win")
})

test("the room is told who found a nitro before the bet is locked", () => {
  const room = setup(2)
  G.currentRound(room).categories[0].clues[0].nitro = true
  G.selectClue(room, 0, 0)
  assert.equal(room.phase, G.PHASE.WAGER)

  // Nothing known yet: the big screen has nobody to name.
  assert.equal(G.projectState(room, "display").wager.playerId, null)

  assert.deepEqual(kinds(G.setWagerWho(room, "p1")), ["wager-who"])
  assert.equal(G.projectState(room, "display").wager.playerId, "p1")
  assert.equal(room.wager.amount, null, "named, not committed")
  assert.equal(room.phase, G.PHASE.WAGER, "and still deciding")

  // The host can change their mind right up to locking it.
  G.setWagerWho(room, "p0")
  assert.equal(room.wager.playerId, "p0")

  G.setWager(room, "p0", 300)
  assert.equal(room.phase, G.PHASE.CLUE)
  assert.equal(room.wager.amount, 300)
})

test("naming a finder does nothing outside a wager", () => {
  const room = setup(2)
  G.selectClue(room, 0, 1) // an ordinary clue
  assert.deepEqual(G.setWagerWho(room, "p0"), [])
})

test("two play-offs in one night get two different questions", () => {
  const room = surveyed(3)
  room.board.tiebreaks = [
    { prompt: "First question", media: null, answer: "one", answerMedia: null },
    { prompt: "Second question", media: null, answer: "two", answerMedia: null },
  ]
  // Level for the last survey seat.
  room.players.get("p0").score = 500
  room.players.get("p1").score = 200
  room.players.get("p2").score = 200

  G.openTiebreak(room)
  assert.equal(G.projectState(room, "host").clue.prompt, "First question")
  G.awardTiebreak(room, "p1")

  // The survey, then level on its points, then the second play-off.
  G.openSurvey(room)
  G.closeSurvey(room)
  assert.deepEqual(G.projectState(room, "host").tied.sort(), ["p0", "p1"])

  G.openTiebreak(room)
  assert.equal(
    G.projectState(room, "host").clue.prompt,
    "Second question",
    "the room has already heard the first one",
  )
})

test("a rerun asks a new question, because the answer to the last one is out", () => {
  const room = ended([500, 500])
  room.board.tiebreaks = [
    { prompt: "First question", media: null, answer: "one", answerMedia: null },
    { prompt: "Second question", media: null, answer: "two", answerMedia: null },
  ]
  G.openTiebreak(room)
  G.armBuzzer(room, 0)

  // Both miss it, which reveals the answer.
  G.buzz(room, "p0", 10)
  G.judgeTiebreak(room, false)
  G.armBuzzer(room, 100)
  G.buzz(room, "p1", 110)
  assert.deepEqual(kinds(G.judgeTiebreak(room, false)), ["tiebreak-missed"])
  assert.equal(room.revealed, true, "the answer went up")

  G.tiebreakAgain(room)
  assert.equal(room.revealed, false)
  assert.equal(G.projectState(room, "host").clue.prompt, "Second question")
})

test("running out of written tie-breaks is reported, not faked", () => {
  const room = ended([500, 500])
  room.board.tiebreaks = [{ prompt: "Only one", media: null, answer: "x", answerMedia: null }]
  G.openTiebreak(room)
  assert.equal(G.projectState(room, "host").tiebreak.hasClue, true)
  assert.equal(G.projectState(room, "host").tiebreak.spare, 0, "and the desk is told there is no spare")

  G.tiebreakAgain(room)
  // Nothing new to draw: it stays on the last rather than serving a blank.
  assert.equal(G.projectState(room, "host").clue.prompt, "Only one")
  assert.equal(G.tiebreaksLeft(room), 1)
})

test("a board written before tie-breaks were a list keeps its clue", () => {
  const legacy = { id: "b", title: "Old", rounds: [], tiebreak: { prompt: "Written long ago", answer: "still here" } }
  const board = G.normaliseBoard(legacy)
  assert.equal(board.tiebreaks.length, 1)
  assert.equal(board.tiebreaks[0].prompt, "Written long ago")
  assert.equal(board.tiebreaks[0].answer, "still here")
})

test("hideOnBuzz takes the clue off the phones, and only the phones", () => {
  const room = setup(2, { hideOnBuzz: true })
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)

  // Before anyone presses, everybody can read it.
  assert.equal(G.projectState(room, "player", "p0").clue.prompt, "prompt 0-0")

  G.buzz(room, "p1", 10)
  assert.equal(room.buzzer.winner, "p1")

  // Withheld, not merely hidden — the words are not on the wire at all.
  const buzzed = G.projectState(room, "player", "p1")
  assert.equal(buzzed.clue.prompt, "", "whoever buzzed answers from memory")
  assert.equal(buzzed.clue.media, null)
  assert.ok(!JSON.stringify(buzzed).includes("prompt 0-0"), "and it is nowhere else in the projection")

  // Everyone else loses it too: they buzzed on the same question and would
  // otherwise be reading it while the answer is given.
  assert.equal(G.projectState(room, "player", "p0").clue.prompt, "")

  // The room and the people driving keep it.
  assert.equal(G.projectState(room, "display").clue.prompt, "prompt 0-0", "the big screen still shows it")
  assert.equal(G.projectState(room, "host").clue.prompt, "prompt 0-0")

  // A miss reopens the buzzer, and the words come back on their own.
  G.judge(room, false)
  assert.equal(room.buzzer.winner, null)
  assert.equal(G.projectState(room, "player", "p0").clue.prompt, "prompt 0-0", "back for the rebound")
})

test("hideOnBuzz is off unless asked for", () => {
  const room = setup(2)
  G.selectClue(room, 0, 0)
  G.armBuzzer(room, 0)
  G.buzz(room, "p1", 10)
  assert.equal(G.projectState(room, "player", "p1").clue.prompt, "prompt 0-0", "the default keeps it up")
})

/**
 * The builder works on a local copy of a board and renders before the room's
 * first snapshot arrives, so `src/lib/board.js` keeps its own copy of the
 * shapes. Two copies drift, and this one has twice: settings added on the
 * relay went missing from the builder's defaults, and tie-breaks became a list
 * on one side and stayed a single clue on the other — which showed up as being
 * allowed only one tie-break question, with the one already written invisible.
 */
test("the builder's mirror of the rules matches the relay's", async () => {
  const board = await import("../src/lib/board.js")
  assert.deepEqual(
    Object.keys(board.DEFAULT_SETTINGS).sort(),
    Object.keys(G.DEFAULTS).sort(),
    "a setting the builder does not know about renders as an uncontrolled input",
  )
})

test("the builder's board shape matches the relay's", async () => {
  const board = await import("../src/lib/board.js")
  const mine = board.makeBoard()
  const theirs = G.makeBoard()

  // `final` is added by the relay's normaliser rather than its constructor, so
  // compare what both sides actually build.
  const keys = (o) => Object.keys(o).sort()
  assert.deepEqual(keys(mine).filter((k) => k !== "final"), keys(theirs).filter((k) => k !== "final"))
  assert.ok(Array.isArray(mine.tiebreaks), "tie-breaks are a list on both sides")
  assert.equal(board.MAX_TIEBREAKS, G.MAX_TIEBREAKS)
})

test("a board still carrying the old single tie-break shows it, rather than an empty box", async () => {
  const { tiebreaksOf } = await import("../src/lib/board.js")
  const legacy = { tiebreak: { prompt: "Written before this was a list", answer: "still here" } }
  assert.deepEqual(tiebreaksOf(legacy), [legacy.tiebreak], "the question already written is what you see")

  // A new board, and one whose legacy slot was never filled, both start with a
  // single empty slot to type into.
  assert.equal(tiebreaksOf({}).length, 1)
  assert.equal(tiebreaksOf({ tiebreak: { prompt: "", answer: "" } })[0].prompt, "")
  // And the list wins once it exists.
  assert.equal(tiebreaksOf({ tiebreaks: [{ prompt: "a" }, { prompt: "b" }], tiebreak: { prompt: "old" } }).length, 2)
})
