/**
 * Slowing down a guesser, without locking out the person being guessed at.
 *
 * scrypt already makes each password attempt expensive, which is not the same
 * as blocked: a patient script can still grind a public URL all night. This
 * counts *failures* and refuses once there have been too many in a window.
 *
 * Two things it deliberately does not do. It does not count successes, because
 * a correct password is evidence you are not the attacker and should not spend
 * anybody's budget. And it does not lock an account out permanently — a lockout
 * that outlives the attack is the attack, for anyone who can guess an email.
 *
 * Pure data structure with no HTTP in it, so it can be tested without a socket.
 */

/** Per-key state is `{ hits: number[], }` — the timestamps of recent failures. */
export class Throttle {
  /**
   * @param {object} opts
   * @param {number} opts.limit    failures allowed inside the window
   * @param {number} opts.windowMs how long a failure is remembered
   * @param {number} opts.maxKeys  cap on tracked keys, so this cannot grow
   *                               without bound on an open route
   */
  constructor({ limit = 8, windowMs = 15 * 60_000, maxKeys = 5_000 } = {}) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxKeys = maxKeys
    /** @type {Map<string, number[]>} */
    this.hits = new Map()
  }

  /**
   * How long this key must wait, in ms. Zero means go ahead.
   *
   * Asked *before* the attempt, so an over-budget caller never reaches the
   * expensive hash — which is the point: the cost of refusing has to be far
   * below the cost of trying, or the limiter is itself the denial of service.
   */
  retryAfter(key, now = Date.now()) {
    const recent = this.#recent(key, now)
    if (recent.length < this.limit) return 0
    // The oldest failure still in the window is the one that has to age out.
    return Math.max(1, recent[0] + this.windowMs - now)
  }

  /** Record a failure. */
  fail(key, now = Date.now()) {
    const recent = this.#recent(key, now)
    recent.push(now)
    this.hits.set(key, recent)
    this.#sweep(now)
  }

  /**
   * Forget this key's failures.
   *
   * Called on a success: somebody who knows the password is not the guesser,
   * and leaving their earlier typos on the clock would lock them out for
   * getting it right on the fourth go.
   */
  clear(key) {
    this.hits.delete(key)
  }

  #recent(key, now) {
    const all = this.hits.get(key) ?? []
    const cutoff = now - this.windowMs
    // Timestamps are pushed in order, so the survivors are a suffix.
    const from = all.findIndex((t) => t > cutoff)
    return from <= 0 ? (from === 0 ? all : []) : all.slice(from)
  }

  #sweep(now) {
    if (this.hits.size <= this.maxKeys) return
    for (const [key, all] of this.hits) {
      if (!all.length || all[all.length - 1] <= now - this.windowMs) this.hits.delete(key)
      if (this.hits.size <= this.maxKeys) return
    }
    // Still over after dropping the stale ones: an active flood. Drop oldest
    // first rather than refusing to track anything new.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) return
      this.hits.delete(key)
    }
  }
}

/**
 * Who is asking, for throttling purposes.
 *
 * Behind Cloudflare and a tunnel every request arrives from 127.0.0.1, so the
 * socket address alone would put the whole internet in one bucket — and then a
 * single attacker locks out every real host. `CF-Connecting-IP` is set by
 * Cloudflare and cannot be forged by the client *provided the origin is only
 * reachable through the tunnel*, which is how this is deployed.
 *
 * `X-Forwarded-For` is only read when `NOGGIN_TRUST_PROXY` says to, because any
 * client can send that header: trusting it by default would hand an attacker a
 * fresh identity per request, which is worse than having no limit at all.
 *
 * Returns null when there is no address worth distinguishing — the caller then
 * falls back to throttling by account alone, which is always accurate.
 */
export function clientIp(req, { trustProxy = process.env.NOGGIN_TRUST_PROXY === "1" } = {}) {
  const h = req.headers ?? {}
  const cf = String(h["cf-connecting-ip"] ?? "").trim()
  if (cf) return cf
  if (trustProxy) {
    const fwd = String(h["x-forwarded-for"] ?? "").split(",")[0].trim()
    if (fwd) return fwd
  }
  const raw = req.socket?.remoteAddress ?? ""
  // Loopback tells us nothing when a proxy is in front, and grouping every
  // caller under it is the lockout this function exists to avoid.
  if (!raw || raw === "127.0.0.1" || raw === "::1" || raw === "::ffff:127.0.0.1") return null
  return raw
}
