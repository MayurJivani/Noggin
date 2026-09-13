import test from "node:test"
import assert from "node:assert/strict"
import { Throttle, clientIp } from "../server/throttle.js"

test("a guesser is refused once the window is full, and let back in as it ages", () => {
  const t = new Throttle({ limit: 3, windowMs: 1000 })
  const at = (n) => 10_000 + n

  for (let i = 0; i < 3; i++) {
    assert.equal(t.retryAfter("a", at(i)), 0, `attempt ${i + 1} is within budget`)
    t.fail("a", at(i))
  }
  const wait = t.retryAfter("a", at(3))
  assert.ok(wait > 0, "the fourth is refused")
  // The oldest failure was at 10_000, so the wait is until it leaves the window.
  assert.equal(wait, 10_000 + 1000 - at(3))

  // Once the oldest ages out there is room again, without any bookkeeping call.
  assert.equal(t.retryAfter("a", at(1001)), 0)
})

test("getting it right clears the failures", () => {
  const t = new Throttle({ limit: 3, windowMs: 1000 })
  t.fail("a", 1); t.fail("a", 2)
  // Two typos then the right password: the next visit must not start at 2.
  t.clear("a")
  for (let i = 0; i < 3; i++) {
    assert.equal(t.retryAfter("a", 10 + i), 0)
    t.fail("a", 10 + i)
  }
  assert.ok(t.retryAfter("a", 20) > 0)
})

test("keys do not share a budget", () => {
  const t = new Throttle({ limit: 2, windowMs: 1000 })
  t.fail("a", 1); t.fail("a", 2)
  assert.ok(t.retryAfter("a", 3) > 0)
  assert.equal(t.retryAfter("b", 3), 0, "one account's attacker must not lock out another")
})

test("tracking is bounded, so an open route cannot grow it forever", () => {
  const t = new Throttle({ limit: 5, windowMs: 1000, maxKeys: 10 })
  for (let i = 0; i < 500; i++) t.fail(`k${i}`, 1000 + i)
  assert.ok(t.hits.size <= 10, `held ${t.hits.size} keys`)
})

test("the caller is identified by something they cannot choose", () => {
  const sock = { remoteAddress: "203.0.113.9" }

  // Cloudflare sets this, and the origin is only reachable through the tunnel.
  assert.equal(clientIp({ headers: { "cf-connecting-ip": "198.51.100.7" }, socket: sock }), "198.51.100.7")

  // Anyone can send X-Forwarded-For, so it is ignored unless configured. That
  // is the difference between a limiter and a free identity per request.
  assert.equal(clientIp({ headers: { "x-forwarded-for": "198.51.100.7" }, socket: sock }), "203.0.113.9")
  assert.equal(
    clientIp({ headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }, socket: sock }, { trustProxy: true }),
    "198.51.100.7",
  )

  // Behind a tunnel everything arrives from loopback; bucketing the whole
  // internet together would let one attacker lock out every real host.
  for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1", ""]) {
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: addr } }), null, addr || "(none)")
  }
})
