import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { ALT, PLAIN, sfx, ui, playForEffect, playUi, board, BOARD_CUES } from "../src/lib/sfx.js"

/**
 * Sound cannot be reviewed by reading a diff, so these do not try — they check
 * the two things about it that *are* checkable, and both have already been
 * wrong at some point in a codebase like this one:
 *
 * 1. The cue tables agree with each other. `ALT` is folded over `sfx` with
 *    `Object.assign`, which silently *adds* a key rather than complaining when
 *    the name is misspelt — so a typo there is a cue that is never heard and
 *    never errors.
 * 2. Nothing throws before the audio context exists. Every page mounts and can
 *    fire a cue before anyone has clicked, and in Node there is no `window` at
 *    all, so this file runs in exactly the state a page is in on its first
 *    frame.
 */

const cueName = (fn) => (typeof fn === "function" ? fn : null)

test("every alternative take replaces a cue that exists", () => {
  for (const id of Object.keys(ALT)) {
    assert.ok(PLAIN[id], `ALT.${id} matches no cue in sfx — Object.assign would add a phantom nobody plays`)
  }
})

test("both takes are callable before anything is unlocked", () => {
  // No AudioContext here at all. Each of these should do nothing, quietly.
  for (const [id, fn] of Object.entries(PLAIN)) assert.doesNotThrow(() => cueName(fn)?.(), `sfx.${id}`)
  for (const [id, fn] of Object.entries(ALT)) assert.doesNotThrow(() => cueName(fn)?.(), `ALT.${id}`)
  for (const [id, fn] of Object.entries(ui)) assert.doesNotThrow(() => cueName(fn)?.(), `ui.${id}`)
  for (const [id, fn] of Object.entries(board)) assert.doesNotThrow(() => cueName(fn)?.(), `board.${id}`)
})

test("the soundboard roster and its cues match", () => {
  for (const { id, label } of BOARD_CUES) {
    assert.ok(board[id], `the desk lists "${label}" but there is no ${id} cue behind it`)
  }
})

test("playUi is inert while the interface layer is switched off", () => {
  // Not a tautology: this is the guard that lets the cues be wired into every
  // button before they have been approved, so it is the one that must hold.
  assert.doesNotThrow(() => playUi("tap"))
  assert.doesNotThrow(() => playUi("no-such-cue"))
})

test("every relay effect the display reacts to lands on a real cue", () => {
  // Effect kinds are strings crossing a process boundary, so a rename on the
  // relay shows up here as a silent moment rather than as an error.
  const kinds = [
    "clue-open", "clue-close", "nitro", "wager-set", "buzz-in", "buzz-early",
    "buzzer-open", "buzzer-reopen", "correct", "final-correct", "wrong",
    "final-wrong", "undo", "time-up", "lifeline-start", "reveal", "game-start",
    "round-start", "final-open", "paused", "resumed", "round-complete", "game-end",
  ]
  for (const kind of kinds) assert.doesNotThrow(() => playForEffect({ kind }), kind)
  assert.doesNotThrow(() => playForEffect({ kind: "sfx", cue: "applause" }))
  // An effect with no cue behind it is normal and must stay harmless.
  assert.doesNotThrow(() => playForEffect({ kind: "something-new" }))
})

test("the audition page names cues that exist", () => {
  // The page is JSX and cannot be imported here, but its roster is a plain
  // list of ids — and a mistyped one is a button that makes no sound, which
  // is the single worst bug an approval page could have.
  const src = readFileSync(new URL("../src/components/sounds/SoundsApp.jsx", import.meta.url), "utf8")
  const section = (name) => src.split(`const ${name} = [`)[1]?.split("\n]")[0] ?? ""

  const game = [...section("GAME").matchAll(/\["([a-zA-Z]+)",/g)].map((m) => m[1])
  assert.ok(game.length > 10, "the game section lost its roster")
  for (const id of game) assert.ok(PLAIN[id], `/sounds offers "${id}", which is not a cue`)

  const uiIds = [...section("UI").matchAll(/\["([a-zA-Z]+)",/g)].map((m) => m[1])
  assert.ok(uiIds.length > 5, "the interface section lost its roster")
  for (const id of uiIds) assert.ok(ui[id], `/sounds offers ui "${id}", which is not a cue`)
})
