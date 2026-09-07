/**
 * Just enough Web Audio to run a cue to the end.
 *
 * Node has no `AudioContext`, so every cue in `sfx.js` returns at its first
 * line — which means a test that calls all of them proves only that the module
 * loads. That gap hid a real bug: `noise()` referenced a `sweep` variable that
 * was never declared as a parameter, so every cue built on it threw a
 * `ReferenceError` partway through and fell silent from that point on. The node
 * tests were green throughout, because the throw was three lines past a guard
 * they never got past.
 *
 * This stub is deliberately not a simulator. It makes no sound and models no
 * DSP. It exists to make the bodies *run*, and to be strict about the two
 * things real Web Audio is strict about and which are easy to get wrong:
 *
 * - `exponentialRampToValueAtTime` throws on a target of zero. Ramping to
 *   silence is the single most natural thing to write and it is illegal; the
 *   idiom is 0.0001.
 * - Scheduling times must be finite. `NaN` from an arithmetic slip is
 *   otherwise completely silent.
 */

class Param {
  constructor(value = 0) {
    this.value = value
  }
  #at(t, what) {
    if (!Number.isFinite(t)) throw new TypeError(`${what}: time is ${t}`)
  }
  setValueAtTime(v, t) {
    this.#at(t, "setValueAtTime")
    if (!Number.isFinite(v)) throw new TypeError(`setValueAtTime: value is ${v}`)
    this.value = v
    return this
  }
  linearRampToValueAtTime(v, t) {
    this.#at(t, "linearRampToValueAtTime")
    this.value = v
    return this
  }
  exponentialRampToValueAtTime(v, t) {
    this.#at(t, "exponentialRampToValueAtTime")
    // The real one throws RangeError here, and silently doing something else
    // would defeat the point of the stub.
    if (!(v > 0)) throw new RangeError(`exponentialRampToValueAtTime: target must be > 0, got ${v}`)
    this.value = v
    return this
  }
  cancelScheduledValues() {
    return this
  }
}

/** `connect` returns its destination, which is what makes chaining work. */
const connectable = (node) => Object.assign(node, { connect: (to) => to, disconnect() {} })

class StubContext {
  constructor() {
    this.currentTime = 0
    this.state = "running"
    this.sampleRate = 48000
    this.destination = connectable({})
    /** Everything created, so a test can assert a cue actually built something. */
    this.made = { osc: 0, buffer: 0, gain: 0, filter: 0 }
  }
  resume() {
    this.state = "running"
    return Promise.resolve()
  }
  createGain() {
    this.made.gain++
    return connectable({ gain: new Param(1) })
  }
  createOscillator() {
    this.made.osc++
    const ctx = this
    return connectable({
      type: "sine",
      frequency: new Param(440),
      detune: new Param(0),
      start(t) {
        if (!Number.isFinite(t)) throw new TypeError(`osc.start: ${t}`)
        ctx.started = true
      },
      stop(t) {
        if (!Number.isFinite(t)) throw new TypeError(`osc.stop: ${t}`)
      },
    })
  }
  createBufferSource() {
    this.made.buffer++
    return connectable({
      buffer: null,
      loop: false,
      start(t) {
        if (!Number.isFinite(t)) throw new TypeError(`src.start: ${t}`)
      },
      stop() {},
    })
  }
  createBuffer(channels, frames) {
    if (!(frames > 0)) throw new RangeError(`createBuffer: ${frames} frames`)
    const data = new Float32Array(frames)
    return { getChannelData: () => data, length: frames }
  }
  createBiquadFilter() {
    this.made.filter++
    return connectable({ type: "lowpass", frequency: new Param(350), Q: new Param(1), gain: new Param(0) })
  }
  decodeAudioData() {
    return Promise.reject(new Error("no decoding in the stub"))
  }
}

/**
 * Install the stub as the page's audio context and return it.
 *
 * `sfx.js` reads `window.AudioContext` once, inside `unlock()`, so this has to
 * be in place before the first unlock — and there is exactly one context per
 * module instance, so the same stub serves the whole file.
 */
export function installAudioStub() {
  const made = []
  globalThis.window = globalThis.window ?? globalThis
  globalThis.window.AudioContext = class extends StubContext {
    constructor() {
      super()
      made.push(this)
    }
  }
  return { contexts: made }
}
