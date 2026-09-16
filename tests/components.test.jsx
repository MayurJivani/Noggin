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

// ── Watching from another room ───────────────────────────────────────────────

test("a spectator screen does not pretend to be the room's own", async () => {
  const { DisplayStage } = await import("../src/components/display/DisplayStage.jsx")

  // Static rendering of the lobby: what a spectator is offered instead of a
  // join card. The two behavioural differences — no wake lock, no join tone —
  // are effect-driven and are asserted in the unit tests for those hooks.
  const prevLoc = globalThis.location
  globalThis.location = { search: "?code=ABCD", hostname: "localhost" }
  try {
    const watching = text(<DisplayStage code="ABCD" spectator />)
    assert.ok(watching.includes("Looking for the room") || watching.includes("Joining"), "it connects like any screen")
  } finally {
    globalThis.location = prevLoc
  }
})

test("the desk offers a link for the next room", async () => {
  // net.js builds URLs from the page's own origin, so it needs one.
  globalThis.window = globalThis.window ?? {}
  globalThis.window.location = { protocol: "http:", hostname: "noggin.example", port: "" }
  const net = await import("../src/lib/net.js")
  assert.equal(typeof net.watchUrl, "function", "there is a spectator link to hand out")
  assert.match(await net.watchUrl("ABCD"), /\/watch\?code=ABCD$/)
})

// ── The board library ────────────────────────────────────────────────────────

test("boards group by shelf, with the unfiled ones first and unlabelled", async () => {
  const { groupBoards } = await import("../src/lib/board.js")

  const grouped = groupBoards([
    { id: "1", title: "Loose one", folder: "" },
    { id: "2", title: "Quiz night 3", folder: "The Crown" },
    { id: "3", title: "Away day", folder: "Anchor" },
    { id: "4", title: "Quiz night 4", folder: "The Crown" },
  ])

  assert.deepEqual(
    grouped.map(([folder, list]) => [folder, list.length]),
    [["", 1], ["Anchor", 1], ["The Crown", 2]],
    "unfiled first, then shelves in name order",
  )

  // A library with nothing filed gets no headings at all: "Uncategorised" over
  // every row is a heading that says nothing.
  const flat = groupBoards([{ id: "1", title: "a" }, { id: "2", title: "b" }])
  assert.deepEqual(flat.map(([f]) => f), [""])
})

test("pulling a clue from the bank keeps the tile's own value", async () => {
  const { clueFromBankShape } = await import("../src/lib/board.js")
  const patch = clueFromBankShape(
    { prompt: "Au", answer: "gold", media: null, answerMedia: null, value: 200 },
    800,
  )
  assert.equal(patch.value, 800, "the tile it lands on decides what it is worth")
  assert.equal(patch.prompt, "Au")
  // Everything the question owns is replaced, so no half of the old one is left.
  assert.deepEqual(Object.keys(patch).sort(), ["answer", "answerMedia", "media", "prompt", "value"])
})

// ── A game with no television in the room ────────────────────────────────────

/** A joined phone, mid-game, with only the fields this screen reads. */
const phone = (over = {}) => {
  const players = over.players ?? [
    { id: "p0", name: "Ann", score: 600, connected: true, lifelines: { phone: 1 }, history: [] },
    { id: "p1", name: "Ben", score: 200, connected: true, lifelines: { phone: 1 }, history: [] },
  ]
  return {
    state: {
      phase: "board",
      settings: { noScreen: true, lifelines: { phone: 1 } },
      buzzer: { armed: false, winner: null, spent: [], lockedUntil: {} },
      clue: null,
      lifeline: null,
      players,
      teams: null,
      stake: 0,
      code: "ABCD",
      board: {
        roundCount: 2,
        round: {
          name: "Round 1",
          values: [200, 400],
          categories: [
            { id: "c0", title: "CATTLE", clues: [{ id: "q0", value: 200, status: "played" }, { id: "q1", value: 400, status: "open" }] },
            { id: "c1", title: "KETTLE", clues: [{ id: "q2", value: 200, status: "open" }, { id: "q3", value: 400, status: "open" }] },
          ],
        },
      },
      ...over,
    },
    me: players[0],
    connected: true,
    rtt: 20,
    send: () => {},
    pressed: false,
    setPressed: () => {},
    onLeave: () => {},
  }
}

test("with no TV the phone draws the board between clues", async () => {
  const { Board } = await import("../src/components/play/PlayerApp.jsx")
  const out = text(<Board {...phone()} />)

  // The tiles themselves, categories and all: this is the board, not a summary
  // of it. A phone-only game has nowhere else to show what is left to play for.
  assert.ok(out.includes("CATTLE") && out.includes("KETTLE"), "the categories are there")
  assert.ok(out.includes("400"), "and the values")
  assert.ok(out.includes("Round 1"), "and which round it is — nothing else says so")

  // Standings, because there is no scoreboard on a wall either.
  assert.ok(out.includes("Ann") && out.includes("Ben") && out.includes("600"))

  // The buzzer is not drawn over it. Between clues there is nothing to buzz at,
  // which is the whole reason the board can have the space.
  assert.ok(!out.includes("BUZZ"), "the idle buzzer gives up its space")
})

test("the board on the phone is opt-in — a room with a TV is unchanged", async () => {
  const { Board } = await import("../src/components/play/PlayerApp.jsx")
  const props = phone()
  props.state.settings = { noScreen: false, lifelines: { phone: 1 } }
  const out = text(<Board {...props} />)

  assert.ok(out.includes("BUZZ"), "the button keeps the screen")
  assert.ok(!out.includes("CATTLE"), "and the board stays on the television")
  assert.ok(out.includes("Watch the screen"))
})

test("the clue comes back up the moment one is picked", async () => {
  const { Board } = await import("../src/components/play/PlayerApp.jsx")
  const out = text(
    <Board
      {...phone({
        phase: "clue",
        stake: 400,
        clue: { id: "q1", value: 400, prompt: "A cow, but larger", category: "CATTLE", media: null, answer: null },
      })}
    />,
  )
  assert.ok(out.includes("A cow, but larger"))
  assert.ok(out.includes("BUZZ"), "and the thumb finds the button where it left it")
  assert.ok(!out.includes("KETTLE"), "the board is out of the way")
})

test("the desk stops offering the two toggles that a room with no TV cannot obey", () => {
  const withTv = text(desk({}))
  assert.ok(withTv.includes("Clue is on phones"), "both are offered in the usual setup")
  assert.ok(withTv.includes("Stays up when buzzed"))

  // The relay overrides both while there is no big screen, so a desk that kept
  // offering them would be offering controls that do nothing.
  const without = text(desk({ settings: { mirrorClue: true, hideOnBuzz: false, streamer: false, teams: false, pingCorrection: false, noScreen: true } }))
  assert.ok(without.includes("No TV"), "and the mode says so plainly")
  assert.ok(!without.includes("Clue is on phones"))
  assert.ok(!without.includes("Stays up when buzzed"))
})

test("a nitro reaches the phone when there is no screen to put it on", async () => {
  const { Board } = await import("../src/components/play/PlayerApp.jsx")
  const wager = {
    phase: "wager", stake: 800,
    wager: { playerId: "p1", amount: null },
    clue: { id: "q9", value: 800, prompt: "", nitro: true, category: "TRANSPORTATION", media: null, answer: null },
  }

  // The clue is deliberately not sent during a wager — the bet is made before
  // the words — so without this the phone showed a live-looking buzzer and no
  // sign the game had stopped for somebody's bet.
  const out = text(<Board {...phone(wager)} />)
  assert.ok(out.includes("Nitro"), "the phone says what is happening")
  assert.ok(out.includes("Ben"), "and who is deciding")
  assert.ok(out.includes("800"), "and what the tile is worth")

  const props = phone(wager)
  props.state.settings = { noScreen: false, lifelines: { phone: 1 } }
  assert.ok(!text(<Board {...props} />).includes("Nitro"), "with a TV it stays on the TV")
})

test("the screen's own moments play on the phone when it is the only screen", async () => {
  const { Board } = await import("../src/components/play/PlayerApp.jsx")
  const clue = { id: "q1", value: 600, prompt: "A cow, but larger", category: "CATTLE", media: null, answer: null }

  const paused = text(<Board {...phone({ phase: "clue", clue, paused: true })} />)
  assert.ok(paused.includes("Back in a moment"), "the room is told why nothing is happening")

  const ringing = text(<Board {...phone({ phase: "clue", clue, lifeline: { playerId: "p1", endsAt: Date.now() + 20000 } })} />)
  assert.ok(ringing.includes("Phone a Friend") && ringing.includes("Ben"), "and whose call it is")

  // Who got there first, which on a phone was only ever known to the winner.
  const buzzed = text(<Board {...phone({ phase: "clue", clue })} flash={{ name: "Cal", verdict: "wrong" }} />)
  assert.ok(buzzed.includes("Cal"))

  // None of it on a night with a television, where it would be a second copy
  // of what the room is already looking at.
  const props = phone({ phase: "clue", clue, paused: true })
  props.state.settings = { noScreen: false, lifelines: { phone: 1 } }
  assert.ok(!text(<Board {...props} />).includes("Back in a moment"))
})
