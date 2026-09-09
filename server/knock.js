/**
 * Vendored from Knock — ../Knock, commit 8592cc6.
 *
 * A copy rather than a dependency, and not by preference: `knock-audio` is not
 * published to npm, and a `file:../Knock` dependency cannot survive the Docker
 * build, whose context is this directory alone. So this is a fork with a date
 * on it. **Fix bugs upstream in Knock first**, then re-copy — a change made
 * only here is a change the next copy silently reverts.
 *
 * Unmodified. This is the replay defence, and it is a plain data structure with
 * no HTTP in it, so it drops straight into the relay. See `/api/knock` in
 * `server/index.js`.
 */

// The replay defence, which is not a DSP problem.
//
// Sound is broadcast and recordable, so the audio must never carry a secret. It
// carries a challenge: a room id and a nonce the server issued seconds ago. The
// phone posts the nonce back over HTTPS and the server decides, here, whether it
// is fresh and unused. That turns replay from "who has ever been in earshot"
// into "who was in earshot in the last few seconds", which is the honest
// boundary this technology can offer.
//
// Pure data structure, no HTTP, so it drops into whatever server you already
// have. `serve.js` is one wiring of it.

// Four bytes, not two. A nonce is guessable, not just replayable: with a 16-bit
// nonce and a few dozen live at once, blind POSTs hit roughly one in two
// thousand, which a script clears in seconds. 32 bits puts that at one in
// millions, and the attempt limiter below covers the rest. The cost is two
// bytes, which is three symbols, which is 90ms.
const NONCE_BYTES = 4;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Room id and nonce -> the payload a host broadcasts. */
export function payload(room, nonce) {
  const id = new TextEncoder().encode(room);
  if (id.length !== 4) throw new RangeError('room id must be 4 ASCII bytes');
  return Uint8Array.from([...id, ...nonce]);
}

/** The payload a phone heard -> its parts, or null if it is not one of ours. */
export function parse(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 4 + NONCE_BYTES) return null;
  // Bytes off the air are attacker-controlled: anyone can play a tone, and CRC
  // is an accident detector, not a signature. Reject anything that is not a
  // plain printable ASCII room id rather than passing it onward.
  for (let i = 0; i < 4; i++) if (bytes[i] < 0x21 || bytes[i] > 0x7e) return null;
  return {
    room: String.fromCharCode(...bytes.subarray(0, 4)),
    nonce: hex(bytes.subarray(4)),
  };
}

export class Nonces {
  /**
   * @param {object}   opts
   * @param {number}   opts.ttlMs       how long a nonce stays valid
   * @param {number}   opts.maxPerRoom  cap on live nonces per room, so a host
   *                                    rotating forever cannot grow the map
   * @param {number}   opts.maxAttempts failed redemptions per room per ttl
   *                                    before the room stops answering
   * @param {Function} opts.random      (n) => Uint8Array, for tests
   */
  constructor({ ttlMs = 10_000, maxPerRoom = 32, maxAttempts = 20, random = secureRandom } = {}) {
    this.ttlMs = ttlMs;
    this.maxPerRoom = maxPerRoom;
    this.maxAttempts = maxAttempts;
    this.random = random;
    this.live = new Map(); // `${room}:${nonce}` -> expiry
    this.failures = new Map(); // room -> { count, until }
  }

  /** Issue a fresh nonce for `room`. The host broadcasts it and rotates often. */
  issue(room, now = Date.now()) {
    this.#sweep(now);

    let live = 0;
    for (const k of this.live.keys()) if (k.startsWith(`${room}:`)) live++;
    if (live >= this.maxPerRoom) return null;

    const bytes = this.random(NONCE_BYTES);
    const nonce = hex(bytes);
    this.live.set(`${room}:${nonce}`, now + this.ttlMs);
    return { nonce, bytes, payload: payload(room, bytes), expiresAt: now + this.ttlMs };
  }

  /**
   * Redeem a nonce a phone claims to have heard. True at most once per nonce:
   * a recording replayed a minute later, and the same capture posted twice,
   * both fail here. Guessing is capped by `maxAttempts`.
   */
  redeem(room, nonce, now = Date.now()) {
    this.#sweep(now);

    const fail = this.failures.get(room);
    if (fail && fail.until > now && fail.count >= this.maxAttempts) return false;

    const key = `${room}:${nonce}`;
    const expiry = this.live.get(key);
    if (expiry === undefined || expiry <= now) {
      const count = fail && fail.until > now ? fail.count + 1 : 1;
      this.failures.set(room, { count, until: now + this.ttlMs });
      return false;
    }
    this.live.delete(key); // single use
    return true;
  }

  #sweep(now) {
    for (const [k, expiry] of this.live) if (expiry <= now) this.live.delete(k);
    for (const [room, f] of this.failures) if (f.until <= now) this.failures.delete(room);
  }
}

function secureRandom(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}
