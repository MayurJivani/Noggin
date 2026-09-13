import test from "node:test"
import assert from "node:assert/strict"
import { attr, count, options, render, selected, shows, text } from "./dom.js"

import { GameControl } from "../src/components/admin/GameControl.jsx"
import { Builder } from "../src/components/admin/Builder.jsx"
import { makeBoard } from "../src/lib/board.js"

/**
 * The bugs that escaped.
 *
 * Every one of these shipped, was found by hand in a browser, and could not
 * have been caught where the tests lived — they are all about what a component
 * renders from a given state, which nothing was asserting on.
 *
 * These render the real components against hand-built projections. That makes
 * them sensitive to the projection's shape, which is the point: a relay field
 * renamed out from under a screen should fail here rather than on the night.
 */

/** A projection shaped like the relay's, with only what the desk reads. */
function state(over = {}) {
  const board = makeBoard()
  return {
    phase: "board",
    code: "ABCD",
    roundIndex: 0,
    stake: 200,
    revealed: false,
    paused: false,
    winner: null,
    champion: null,
    tied: null,
    cut: null,
    next: null,
    played: { final: false, survey: false },
    settings: { mirrorClue: true, hideOnBuzz: false, streamer: false, teams: false, pingCorrection: false },
    board: { round: board.rounds[0], roundCount: board.rounds.length, title: board.title },
    rawBoard: board,
    clue: null,
    players: [],
    teams: null,
    buzzer: { armed: false, winner: null, spent: [], order: [], lockedUntil: {} },
    timer: null,
    lifeline: null,
    check: null,
    final: null,
    survey: null,
    tiebreak: null,
    ...over,
  }
}

const desk = (over) => (
  <GameControl state={state(over)} send={() => {}} now={() => 0} requests={[]} code="ABCD" savedAt={null} controllerKey={null} />
)

const player = (id, name, score = 0) => ({ id, name, score, connected: true, lifelines: {}, history: [], rtt: null, lag: null })

// ── The nitro that picked the leader ─────────────────────────────────────────

/*
  Scope note, checked rather than assumed.

  Static rendering runs component bodies and state initialisers, not effects.
  I verified that by reintroducing each bug: taking the buzzer order off the
  desk fails here, and so does the builder forgetting a legacy tie-break — but
  restoring the nitro's `contenders[0]` default does not, because that default
  is applied by an effect and this never runs one.

  So this asserts what the harness genuinely sees: the placeholder is what is
  selected on a first render, and the options are ordered by name rather than
  by score. The reset-on-broadcast bug that made the wager unusable is
  effect-shaped and stays a browser check.
*/
test("the nitro wager offers a placeholder, and lists people by name", () => {
  const el = desk({
    phase: "wager",
    clue: { id: "c1", value: 200, prompt: "", category: "STONE", nitro: true, catIndex: 0, clueIndex: 0, answer: null, media: null },
    wager: { playerId: null, teamId: null, amount: null },
    // Ordered by score, as the relay sends it — which is what made the leader
    // the default when the component took contenders[0].
    players: [player("p0", "Ann", 2000), player("p1", "Ben", 300), player("p2", "Cal", -500)],
  })

  assert.equal(selected(el), "", "nothing is chosen for the host")
  const opts = options(el)
  assert.equal(opts[0].value, "", "the empty option is the placeholder")
  assert.match(opts[0].label, /found it/)

  // By name, so the leader is not sitting under the cursor.
  assert.deepEqual(
    opts.slice(1).map((o) => o.label.split(" —")[0]),
    ["Ann", "Ben", "Cal"],
  )
})

test("the wager amount is shut until somebody is chosen", () => {
  const el = desk({
    phase: "wager",
    clue: { id: "c1", value: 200, prompt: "", category: "STONE", nitro: true, catIndex: 0, clueIndex: 0, answer: null, media: null },
    wager: { playerId: null, teamId: null, amount: null },
    players: [player("p0", "Ann", 2000)],
  })
  // The cap depends on whose score it is, so a number typed first would be
  // measured against the wrong ceiling.
  assert.match(render(el), /<input[^>]*type="number"[^>]*disabled/, "the amount field is disabled")
  // A placeholder is an attribute, so it is invisible to text().
  assert.equal(attr(el, "input", "placeholder"), "pick who found it first")
})

// ── The clue panel that vanished ─────────────────────────────────────────────

test("a buzzer check lists who got there first, not just who was heard", () => {
  const el = desk({
    phase: "lobby",
    players: [player("p0", "Ann"), player("p1", "Ben"), player("p2", "Cal")],
    check: {
      since: 0,
      complete: true,
      hits: { p0: { at: 120, count: 1 }, p1: { at: 0, count: 1 }, p2: { at: 400, count: 1 } },
      order: [
        { id: "p1", ms: 0, adjusted: 0, count: 1, place: 1, behind: 0 },
        { id: "p0", ms: 120, adjusted: 120, count: 1, place: 2, behind: 120 },
        { id: "p2", ms: 400, adjusted: 400, count: 1, place: 3, behind: 400 },
      ],
    },
  })

  const out = text(el)
  assert.ok(out.includes("first"), "the winner is named as first")
  assert.ok(out.includes("+120ms"), "and the others by their gap")
  assert.ok(out.includes("+400ms"))
  // Ben pressed first despite being listed second in the roster.
  assert.ok(out.indexOf("Ben") < out.indexOf("Ann"), "pressers are in press order, not roster order")
})

test("players who have not pressed are still listed, under the ones who have", () => {
  const el = desk({
    phase: "lobby",
    players: [player("p0", "Ann"), player("p1", "Ben")],
    check: {
      since: 0,
      complete: false,
      hits: { p1: { at: 0, count: 1 } },
      order: [{ id: "p1", ms: 0, adjusted: 0, count: 1, place: 1, behind: 0 }],
    },
  })
  const out = text(el)
  assert.ok(out.includes("waiting"), "a dead buzzer is the other thing this panel is for")
  assert.ok(out.indexOf("Ben") < out.indexOf("Ann"))
})

// ── The tie-break editor that hid a written question ─────────────────────────

test("the builder shows a tie-break written before they were a list", () => {
  // The shape older boards carry. The relay migrates on the way in, but a board
  // being edited locally has not been near the relay.
  const legacy = {
    ...makeBoard(),
    tiebreaks: undefined,
    tiebreak: { prompt: "Written long ago", media: null, answer: "still here", answerMedia: null },
  }
  const el = (
    <Builder
      board={legacy}
      setBoard={() => {}}
      roundIndex={-3}
      setRoundIndex={() => {}}
      settings={{}}
      onSettings={() => {}}
      onPush={() => {}}
      pushState="idle"
      state={null}
    />
  )
  const html = render(el)
  assert.ok(html.includes("Written long ago"), "the question already written is what you see")
  assert.ok(html.includes("still here"))
  assert.ok(html.includes("Another tie-break"), "and more can be added")
})

test("tie-break slots say what they are for, and it follows the survey", () => {
  // Two slots, so both labels have somewhere to render. A fresh board starts
  // with one, and a label for a slot that does not exist is not a label.
  const two = [
    { prompt: "", media: null, answer: "", answerMedia: null },
    { prompt: "", media: null, answer: "", answerMedia: null },
  ]
  const withSurvey = { ...makeBoard(), tiebreaks: two, survey: { enabled: true, collecting: true, questions: [] } }
  const el = (props) => (
    <Builder
      board={props}
      setBoard={() => {}}
      roundIndex={-3}
      setRoundIndex={() => {}}
      settings={{}}
      onSettings={() => {}}
      onPush={() => {}}
      pushState="idle"
      state={null}
    />
  )

  const on = text(el(withSurvey))
  assert.ok(on.includes("for the last seat in the survey"), "two play-offs when a survey follows")
  assert.ok(on.includes("after the survey"))

  const off = text(el({ ...makeBoard(), tiebreaks: two, survey: { enabled: false, collecting: true, questions: [] } }))
  assert.ok(off.includes("after the final — for the win"), "one when it does not")
  assert.ok(!off.includes("after the survey"))
})

// ── The running order, as the desk renders it ────────────────────────────────

test("the desk offers one call to action, chosen by the relay", () => {
  // Mid-board intermission with a round still to play.
  const more = text(desk({ phase: "intermission", players: [player("p0", "Ann")] }))
  assert.ok(more.includes("Start next round"))
  assert.ok(!more.includes("Play the final"), "the final must not sit beside it with rounds left")

  // The relay says the final is owed; the button appears and the other goes.
  const owed = text(desk({ phase: "intermission", roundIndex: 1, next: "final", players: [player("p0", "Ann")] }))
  assert.ok(owed.includes("Play the final"))
  assert.ok(!owed.includes("Start next round"), "there is no next round to start")
})

test("the two play-offs are told apart", () => {
  const forSeat = text(
    desk({
      phase: "ended",
      next: "tiebreak-cut",
      cut: { through: ["p0"], contested: ["p1", "p2"], seats: 1 },
      players: [player("p0", "Ann", 500), player("p1", "Ben", 200), player("p2", "Cal", 200)],
    }),
  )
  assert.ok(forSeat.includes("Level for the last seat"))
  assert.ok(forSeat.includes("Play off for the seat"))

  const forWin = text(
    desk({ phase: "ended", tied: ["p0", "p1"], players: [player("p0", "Ann", 500), player("p1", "Ben", 500)] }),
  )
  assert.ok(forWin.includes("It's a tie."))
  assert.ok(forWin.includes("Play a tie-break"))
  assert.ok(!forWin.includes("last seat"), "the two must not read the same")
})

test("the final scoreboard shows everyone, not the top eight", () => {
  const many = Array.from({ length: 12 }, (_, i) => player(`p${i}`, `Player${i}`, 1200 - i * 100))
  const out = text(desk({ phase: "ended", players: many, champion: "p0" }))
  for (const p of many) assert.ok(out.includes(p.name), `${p.name} is missing from the end of the night`)
})

// ── The panel that grew into a junk drawer ───────────────────────────────────

test("the clock is in the panel, and setup is behind a drawer", () => {
  const el = desk({ players: [player("p0", "Ann")] })
  const html = render(el)

  // The clock is the most time-critical control and must not be behind
  // anything — it was once pushed below the fold by six setup-only controls.
  assert.ok(text(el).includes("Clock"))
  assert.equal(count(el, /<details/g), 3, "three drawers, all shut")
  assert.equal(count(el, /<details open/g), 0)
})

// ── The join screen's honesty about what it cannot do ────────────────────────

test("the player is told why joining by sound is missing, rather than left guessing", async () => {
  const { PlayerApp } = await import("../src/components/play/PlayerApp.jsx")

  // A bare LAN address: not a secure context, so no microphone, so no button.
  // This used to vanish silently on exactly the setup Noggin is usually played
  // on, which made a working feature look broken.
  const lan = { isSecureContext: false, location: { search: "", hostname: "192.168.1.148" } }
  const prev = { ctx: globalThis.window?.isSecureContext, loc: globalThis.location }
  globalThis.window = { ...(globalThis.window ?? {}), ...lan }
  globalThis.location = lan.location
  try {
    const out = text(<PlayerApp />)
    assert.ok(out.includes("secure page"), "it says why")
    assert.ok(out.includes("https://"), "and what to ask for")
    assert.ok(!out.includes("Listening for TV sound"), "and does not offer a button that cannot work")
  } finally {
    if (globalThis.window) globalThis.window.isSecureContext = prev.ctx
    globalThis.location = prev.loc
  }
})
