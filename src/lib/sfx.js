/**
 * Cues, synthesised.
 *
 * A game show lives on its stings, but shipping audio files means shipping
 * licensing questions and a loading state on the one page that must never be
 * loading. WebAudio gets us a buzz, a ding and a fanfare in a few hundred bytes.
 *
 * Browsers won't start an AudioContext without a gesture, so the display page
 * calls `unlock()` from the "start" click and everything after that just works.
 */

let ctx = null
let master = null

export function unlock() {
  if (typeof window === "undefined") return
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
  }
  if (ctx.state === "suspended") ctx.resume()
}

export function setVolume(v) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v))
}

export const isUnlocked = () => !!ctx && ctx.state === "running"

/** One shaped note. Everything below is a handful of these. */
function tone(freq, start, dur, { type = "sine", gain = 0.3, sweep = null } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), t0 + dur)

  // Ramps rather than steps: an abrupt gain change is an audible click, which
  // over a PA at volume sounds like the cable just got kicked.
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  osc.connect(env).connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise(start, dur, gain = 0.15) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const frames = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const src = ctx.createBufferSource()
  const env = ctx.createGain()
  env.gain.value = gain
  src.buffer = buf
  src.connect(env).connect(master)
  src.start(t0)
}

export const sfx = {
  /** Tile picked off the board. */
  select: () => tone(660, 0, 0.09, { type: "triangle", gain: 0.18 }),
  /** Someone got there first. */
  buzz: () => {
    tone(180, 0, 0.28, { type: "square", gain: 0.22 })
    tone(240, 0.02, 0.26, { type: "square", gain: 0.14 })
  },
  /** Jumped the gun. */
  reject: () => tone(150, 0, 0.16, { type: "sawtooth", gain: 0.16, sweep: 80 }),
  correct: () => {
    tone(784, 0, 0.14, { type: "triangle", gain: 0.3 })
    tone(1046, 0.11, 0.3, { type: "triangle", gain: 0.3 })
  },
  wrong: () => {
    tone(300, 0, 0.18, { type: "sawtooth", gain: 0.24 })
    tone(200, 0.14, 0.3, { type: "sawtooth", gain: 0.24 })
  },
  dailyDouble: () => {
    const notes = [523, 659, 784, 1046, 1318]
    notes.forEach((f, i) => tone(f, i * 0.075, 0.5, { type: "triangle", gain: 0.26 }))
    noise(0.38, 0.5, 0.08)
  },
  timeUp: () => {
    tone(440, 0, 0.12, { type: "square", gain: 0.22 })
    tone(440, 0.16, 0.12, { type: "square", gain: 0.22 })
    tone(330, 0.32, 0.4, { type: "square", gain: 0.22 })
  },
  /** Last five seconds of any countdown. */
  tick: () => tone(1200, 0, 0.03, { type: "sine", gain: 0.1 }),
  lifeline: () => {
    tone(880, 0, 0.1, { type: "sine", gain: 0.2 })
    tone(660, 0.12, 0.1, { type: "sine", gain: 0.2 })
    tone(880, 0.24, 0.18, { type: "sine", gain: 0.2 })
  },
  reveal: () => tone(523, 0, 0.35, { type: "triangle", gain: 0.22 }),
  roundEnd: () => {
    ;[523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.6, { type: "triangle", gain: 0.26 }))
  },
}

/** Map a relay effect onto a cue, so pages don't each grow a switch statement. */
export function playForEffect(effect) {
  switch (effect.kind) {
    case "clue-open":
      return sfx.select()
    case "daily-double":
      return sfx.dailyDouble()
    case "buzz-in":
      return sfx.buzz()
    case "buzz-early":
      return sfx.reject()
    case "correct":
      return sfx.correct()
    case "wrong":
      return sfx.wrong()
    case "time-up":
      return sfx.timeUp()
    case "lifeline-start":
      return sfx.lifeline()
    case "reveal":
      return sfx.reveal()
    case "round-complete":
    case "game-end":
      return sfx.roundEnd()
  }
}
