import test from "node:test"
import assert from "node:assert/strict"

/**
 * Streamer mode hides the code from the projection; this hides it from the
 * address bar as well. The bug worth catching is a projector that scrubs its
 * URL and then, on the next reload, lands on the code prompt in front of a
 * roomful of people — so the remembering half is tested as hard as the
 * scrubbing half.
 *
 * A hand-rolled `window` rather than jsdom: three properties are the whole
 * surface this module touches, and `URL` is built in.
 */
const store = new Map()
let replaced = []

function visit(href) {
  const url = new URL(href)
  replaced = []
  globalThis.location = { href, search: url.search, pathname: url.pathname, hash: url.hash }
  globalThis.history = {
    replaceState: (_s, _t, next) => {
      replaced.push(next)
      // A real browser updates `location` in place; without this, a second call
      // in the same page would see the code still there and pass for the wrong
      // reason.
      const now = new URL(next, href)
      Object.assign(globalThis.location, { href: now.href, search: now.search, hash: now.hash })
    },
  }
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  }
}

visit("https://noggin.example/display?code=ab12")
const { openedWith, scrubCodeFromUrl, codeFromUrl, rememberedCode } = await import("../src/lib/roomCode.js")

test("a code in the URL is read, upper-cased", () => {
  visit("https://noggin.example/display?code=ab12")
  assert.equal(codeFromUrl(), "AB12")
  assert.equal(openedWith(), "AB12")
})

test("scrubbing removes the code and leaves the rest of the URL alone", () => {
  visit("https://noggin.example/display?code=AB12&portrait=1#top")
  assert.equal(scrubCodeFromUrl("AB12"), true)
  assert.deepEqual(replaced, ["/display?portrait=1#top"])
  assert.equal(codeFromUrl(), "")
})

test("a lone query string does not leave a trailing question mark", () => {
  visit("https://noggin.example/display?code=AB12")
  scrubCodeFromUrl("AB12")
  assert.deepEqual(replaced, ["/display"])
})

test("a scrubbed page survives a reload", () => {
  visit("https://noggin.example/display?code=AB12")
  scrubCodeFromUrl("AB12")

  // The reload: same page, no code in the address bar.
  visit("https://noggin.example/display")
  assert.equal(codeFromUrl(), "")
  assert.equal(rememberedCode(), "AB12")
  assert.equal(openedWith(), "AB12")
})

test("a second page does not inherit the first page's room", () => {
  visit("https://noggin.example/display?code=AB12")
  scrubCodeFromUrl("AB12")

  visit("https://noggin.example/scores")
  assert.equal(openedWith(), "")
})

test("scrubbing is idempotent, and a no-op without a code", () => {
  visit("https://noggin.example/display?code=AB12")
  assert.equal(scrubCodeFromUrl("AB12"), true)
  assert.equal(scrubCodeFromUrl("AB12"), false)
  assert.equal(replaced.length, 1)

  visit("https://noggin.example/display?code=AB12")
  assert.equal(scrubCodeFromUrl(""), false)
  assert.equal(codeFromUrl(), "AB12")
})
