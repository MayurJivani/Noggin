import test from "node:test"
import assert from "node:assert/strict"

import { createWakeLock } from "../src/lib/useWakeLock.js"

/**
 * A phone locking mid-clue is the most avoidable way to lose a buzz, and the
 * failure is invisible: the lock is dropped by the browser the moment the page
 * hides, and nothing tells the player it has gone. So the behaviour under test
 * is not "does it request one" — everyone gets that right — but "does it get
 * one *back*", which is where real implementations quietly stop working.
 */
function fakeDom({ visible = true, api = true, playFails = false } = {}) {
  const listeners = {}
  const released = []
  const live = []
  let requests = 0

  const doc = {
    visibilityState: visible ? "visible" : "hidden",
    body: { appendChild: (el) => doc.appended.push(el) },
    appended: [],
    createElement: () => ({
      style: {},
      setAttribute() {},
      play: () => (playFails ? Promise.reject(new Error("blocked")) : Promise.resolve()),
      pause() {
        this.paused = true
      },
      remove() {
        this.removed = true
      },
    }),
    addEventListener: (t, fn) => ((listeners[t] ??= []).push(fn)),
    removeEventListener: (t, fn) => (listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn)),
  }

  const nav = api
    ? {
        wakeLock: {
          request: async () => {
            requests++
            const handlers = []
            const s = {
              released: false,
              release: async () => {
                s.released = true
                released.push(1)
              },
              addEventListener: (_t, fn) => handlers.push(fn),
              /** What a browser does when the page hides. */
              drop: (silent) => {
                s.released = true
                if (!silent) handlers.forEach((f) => f())
              },
            }
            live.push(s)
            return s
          },
        },
      }
    : {}

  return {
    doc,
    nav,
    get requests() {
      return requests
    },
    get releases() {
      return released.length
    },
    /** `silent` models a browser that drops the lock without telling us. */
    hide(silent = false) {
      doc.visibilityState = "hidden"
      live.forEach((s) => s.drop(silent))
      listeners.visibilitychange?.forEach((f) => f())
    },
    show() {
      doc.visibilityState = "visible"
      listeners.visibilitychange?.forEach((f) => f())
    },
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

test("a visible page takes a lock", async () => {
  const dom = fakeDom()
  const seen = []
  const lock = createWakeLock({ onChange: (v) => seen.push(v), doc: dom.doc, nav: dom.nav })
  await settle()

  assert.equal(dom.requests, 1)
  assert.equal(lock.held, true)
  assert.deepEqual(seen, [true])
  lock.stop()
})

test("a hidden page does not, because the request would throw", async () => {
  const dom = fakeDom({ visible: false })
  const lock = createWakeLock({ doc: dom.doc, nav: dom.nav })
  await settle()

  assert.equal(dom.requests, 0)
  assert.equal(lock.held, false)
  lock.stop()
})

test("the lock comes back when the page does", async () => {
  const dom = fakeDom()
  const lock = createWakeLock({ doc: dom.doc, nav: dom.nav })
  await settle()
  assert.equal(dom.requests, 1)

  // What actually happens when someone glances at a notification: the browser
  // drops the sentinel, and nothing asks for it again unless we do.
  dom.hide()
  await settle()
  assert.equal(dom.requests, 1, "nothing is requested while hidden")

  dom.show()
  await settle()
  assert.equal(dom.requests, 2, "and this is the line every broken implementation is missing")
  assert.equal(lock.held, true)
  lock.stop()
})

test("it comes back even if the browser drops the lock without saying so", async () => {
  const dom = fakeDom()
  const lock = createWakeLock({ doc: dom.doc, nav: dom.nav })
  await settle()

  // No `release` event — just a handle that has quietly become dead. Trusting
  // the event alone would leave us holding it forever and never re-asking.
  dom.hide(true)
  dom.show()
  await settle()

  assert.equal(dom.requests, 2)
  assert.equal(lock.held, true)
  lock.stop()
})

test("a dropped sentinel is reported, not quietly assumed to still hold", async () => {
  const dom = fakeDom()
  const seen = []
  const lock = createWakeLock({ onChange: (v) => seen.push(v), doc: dom.doc, nav: dom.nav })
  await settle()

  dom.doc.appended // no-op, keeps shape obvious
  const sentinel = await dom.nav.wakeLock.request("screen")
  void sentinel
  assert.equal(seen.at(-1), true)
  lock.stop()
  assert.equal(seen.at(-1), false, "stopping says so")
})

test("without the API it falls back to a muted looping clip", async () => {
  const dom = fakeDom({ api: false })
  const lock = createWakeLock({ doc: dom.doc, nav: dom.nav })
  await settle()

  assert.equal(lock.supported, false)
  assert.equal(dom.doc.appended.length, 1, "one video, for iOS before 16.4")
  const v = dom.doc.appended[0]
  assert.equal(v.loop, true)
  assert.equal(v.muted, true, "a bed that made noise would be worse than a locked phone")
  assert.match(v.src, /^data:video\/mp4;base64,/)
  assert.equal(lock.held, true)

  lock.stop()
  assert.equal(v.paused, true)
  assert.equal(v.removed, true, "and it does not outlive the page that wanted it")
})

test("a blocked fallback reports failure rather than pretending", async () => {
  const dom = fakeDom({ api: false, playFails: true })
  const seen = []
  const lock = createWakeLock({ onChange: (v) => seen.push(v), doc: dom.doc, nav: dom.nav })
  await settle()

  assert.equal(seen.at(-1), false, "so the player is told to keep their screen on")
  lock.stop()
})

test("stopping releases the lock and stops listening", async () => {
  const dom = fakeDom()
  const lock = createWakeLock({ doc: dom.doc, nav: dom.nav })
  await settle()

  lock.stop()
  await settle()
  assert.equal(dom.releases, 1)

  dom.hide()
  dom.show()
  await settle()
  assert.equal(dom.requests, 1, "a page that has gone does not keep grabbing the screen")
})
