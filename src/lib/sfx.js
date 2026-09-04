/**
 * Cues, synthesised.
 *
 * A game show lives on its stings, but shipping audio files means shipping
 * licensing questions and a loading state on the one page that must never be
 * loading. WebAudio gets us the whole show — buzzes, fanfares, an applause
 * break and a music bed — out of oscillators and noise, in a few KB.
 *
 * Three buses hang off the master so they can be balanced against each other:
 * cues fire loud, the bed sits underneath, and the soundboard lands between
 * them. Browsers won't start an AudioContext without a gesture, so the display
 * page calls `unlock()` from the first click and everything after that works.
 */

let ctx = null
let master = null
let cueBus = null
let boardBus = null
let musicBus = null

export function unlock() {
  if (typeof window === "undefined") return
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)

    cueBus = ctx.createGain()
    cueBus.gain.value = 1
    cueBus.connect(master)

    boardBus = ctx.createGain()
    boardBus.gain.value = 0.9
    boardBus.connect(master)

    musicBus = ctx.createGain()
    musicBus.gain.value = 0
    musicBus.connect(master)
  }
  if (ctx.state === "suspended") ctx.resume()
}

export function setVolume(v) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v))
}

/** How loud the bed sits under everything else. */
export function setMusicVolume(v) {
  if (musicBus) musicBus.gain.value = Math.max(0, Math.min(1, v))
}

export const isUnlocked = () => !!ctx && ctx.state === "running"

// ── Primitives ───────────────────────────────────────────────────────────────

/** One shaped note. Most of what follows is a handful of these. */
function tone(freq, start, dur, { type = "sine", gain = 0.3, sweep = null, bus = null, detune = 0 } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.detune.value = detune
  osc.frequency.setValueAtTime(freq, t0)
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), t0 + dur)

  // Ramps rather than steps: an abrupt gain change is an audible click, which
  // over a PA at volume sounds like the cable just got kicked.
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  osc.connect(env).connect(bus ?? cueBus)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise(start, dur, gain = 0.15, { bus = null, filter = null, q = 1 } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const src = ctx.createBufferSource()
  const env = ctx.createGain()
  env.gain.value = gain
  src.buffer = buf

  let node = src
  if (filter) {
    const bp = ctx.createBiquadFilter()
    bp.type = typeof filter === "number" ? "bandpass" : filter.type
    bp.frequency.value = typeof filter === "number" ? filter : filter.freq
    bp.Q.value = q
    node = src.connect(bp)
  }
  node.connect(env).connect(bus ?? cueBus)
  src.start(t0)
}

/**
 * A crowd, from grains.
 *
 * Real applause is a few hundred sharp uncorrelated transients per second in a
 * narrow band around 2kHz. Rendering it as one buffer of scattered impulses is
 * both far cheaper than scheduling hundreds of nodes and — because the ear is
 * listening for density rather than any one clap — indistinguishable.
 */
function crowd(start, dur, { gain = 0.3, rate = 900, swell = 0.25, bus = null } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const frames = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(2, frames, ctx.sampleRate)

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    const claps = Math.floor(rate * dur)
    for (let i = 0; i < claps; i++) {
      const at = Math.floor(Math.random() * frames)
      // Rise, hold, fall — a room that starts clapping together and trails off.
      const p = at / frames
      const shape = p < swell ? p / swell : 1 - Math.max(0, (p - 0.65) / 0.35) ** 1.5
      const amp = shape * (0.35 + Math.random() * 0.65)
      const len = 20 + Math.floor(Math.random() * 50)
      for (let n = 0; n < len && at + n < frames; n++) {
        data[at + n] += (Math.random() * 2 - 1) * amp * (1 - n / len)
      }
    }
  }

  const src = ctx.createBufferSource()
  src.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = "bandpass"
  bp.frequency.value = 1900
  bp.Q.value = 0.7
  const env = ctx.createGain()
  env.gain.value = gain
  src.connect(bp).connect(env).connect(bus ?? boardBus)
  src.start(t0)
}

// ── Game cues ────────────────────────────────────────────────────────────────

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

  /**
   * Noggin' Nitro.
   *
   * The biggest moment on the board deserves more than the five-note run it
   * used to get: a rising sweep to lift the room, a hit on the landing, and a
   * bright arpeggio over the top of the splash animation, which runs 2s.
   */
  nitro: () => {
    // The lift.
    tone(180, 0, 0.55, { type: "sawtooth", gain: 0.12, sweep: 900 })
    noise(0, 0.55, 0.05, { filter: { type: "highpass", freq: 900 } })
    // The hit.
    tone(110, 0.5, 0.7, { type: "square", gain: 0.22 })
    tone(220, 0.5, 0.6, { type: "triangle", gain: 0.16 })
    noise(0.5, 0.5, 0.12, { filter: { type: "highpass", freq: 2000 } })
    // The flourish.
    ;[523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, 0.56 + i * 0.07, 0.5, { type: "triangle", gain: 0.22 }))
    ;[1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 1.02 + i * 0.05, 0.7, { type: "sine", gain: 0.14 }))
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

  // ── Transitions ──
  // Short, and deliberately quieter than the verdict cues: these mark the shape
  // of the night rather than the drama in it, and a sting on every screen
  // change becomes noise the room stops hearing.

  /** A phone takes a seat in the lobby. */
  join: () => {
    tone(880, 0, 0.07, { type: "sine", gain: 0.13 })
    tone(1318, 0.06, 0.12, { type: "sine", gain: 0.11 })
  },
  /** The board goes up for the first time. */
  boardOpen: () => {
    noise(0, 0.5, 0.07, { filter: { type: "highpass", freq: 500 } })
    ;[261, 329, 392, 523].forEach((f, i) => tone(f, i * 0.06, 0.7, { type: "triangle", gain: 0.2 }))
  },
  /** A new round's board arrives. */
  roundStart: () => {
    tone(392, 0, 0.5, { type: "triangle", gain: 0.2, sweep: 784 })
    tone(196, 0, 0.55, { type: "sine", gain: 0.14 })
  },
  /** Back to the grid after a clue. */
  clueClose: () => tone(520, 0, 0.14, { type: "sine", gain: 0.1, sweep: 300 }),
  /** The buzzer opens. */
  arm: () => tone(1046, 0, 0.09, { type: "sine", gain: 0.14 }),
  /** The wager is locked and the clue is about to show. */
  wagerLock: () => {
    tone(392, 0, 0.12, { type: "square", gain: 0.16 })
    tone(523, 0.1, 0.2, { type: "square", gain: 0.16 })
  },
  /** The room is held. */
  pause: () => {
    tone(523, 0, 0.16, { type: "sine", gain: 0.16 })
    tone(392, 0.13, 0.3, { type: "sine", gain: 0.16 })
  },
  resume: () => {
    tone(392, 0, 0.14, { type: "sine", gain: 0.16 })
    tone(523, 0.11, 0.26, { type: "sine", gain: 0.16 })
  },
  /** Into the final. Low, slow and a bit ominous. */
  finalOpen: () => {
    tone(110, 0, 1.6, { type: "sine", gain: 0.18 })
    tone(164.81, 0.1, 1.5, { type: "sine", gain: 0.12 })
    tone(220, 0.2, 1.4, { type: "triangle", gain: 0.1 })
    noise(0, 1.2, 0.04, { filter: { type: "lowpass", freq: 700 } })
  },
  /** That's the game. */
  gameOver: () => {
    ;[523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.1, 0.9, { type: "triangle", gain: 0.24 }))
    tone(130.81, 0.5, 1.6, { type: "sine", gain: 0.2 })
    crowd(0.45, 3.4, { gain: 0.26 })
  },
  /** A ruling taken back. */
  undo: () => tone(700, 0, 0.16, { type: "sine", gain: 0.12, sweep: 420 }),
}

// ── The soundboard ───────────────────────────────────────────────────────────

/**
 * Cues the host fires by hand.
 *
 * Everything a game show needs between the questions: a round of applause when
 * someone clears a category, a drumroll before the final, an airhorn for the
 * comeback. These are deliberately longer and more theatrical than the game
 * cues — they are the thing the room is meant to be listening to, not a
 * confirmation that a button worked.
 */
export const board = {
  applause: () => crowd(0, 2.6, { gain: 0.3, rate: 800 }),
  ovation: () => {
    crowd(0, 5, { gain: 0.42, rate: 1500, swell: 0.12 })
    ;[523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.8, { type: "triangle", gain: 0.14 }))
  },
  cheer: () => {
    crowd(0, 2.4, { gain: 0.3, rate: 700 })
    // A crowd's vowel, roughly: a wide filtered whoop over the clapping.
    tone(320, 0, 1.4, { type: "sawtooth", gain: 0.05, sweep: 520 })
    tone(404, 0.1, 1.3, { type: "sawtooth", gain: 0.04, sweep: 610 })
  },

  drumroll: () => {
    // Accelerating hits, then a crash. 60 strokes over 2s, tightening.
    for (let i = 0; i < 60; i++) {
      const p = i / 60
      noise(p * p * 2.0, 0.035, 0.1 + p * 0.12, { filter: { type: "bandpass", freq: 260 }, q: 1.2 })
    }
    noise(2.05, 1.4, 0.22, { filter: { type: "highpass", freq: 2600 } })
    tone(196, 2.05, 0.8, { type: "sine", gain: 0.16 })
  },

  airhorn: () => {
    const blast = (at, dur) => {
      ;[233, 311, 466].forEach((f, i) => {
        tone(f, at, dur, { type: "sawtooth", gain: 0.16, detune: i === 1 ? 9 : -7 })
        tone(f, at, dur, { type: "square", gain: 0.07, detune: 14 })
      })
    }
    blast(0, 0.34)
    blast(0.42, 0.34)
    blast(0.84, 0.95)
  },

  /** The wrong answer that deserved a bigger reaction than a beep. */
  trombone: () => {
    const steps = [233.08, 220, 196, 174.61]
    steps.forEach((f, i) => {
      const at = i * 0.3
      tone(f, at, 0.34, { type: "sawtooth", gain: 0.2, sweep: f * 0.94 })
      tone(f * 2, at, 0.3, { type: "triangle", gain: 0.05 })
    })
    tone(155.56, 1.2, 0.9, { type: "sawtooth", gain: 0.2, sweep: 130 })
  },

  boo: () => {
    ;[98, 116, 131].forEach((f, i) => tone(f, i * 0.04, 1.5, { type: "sawtooth", gain: 0.09, sweep: f * 0.8 }))
    noise(0, 1.6, 0.05, { filter: { type: "lowpass", freq: 500 } })
  },

  /** Money. Two bright hits and a drawer. */
  cash: () => {
    tone(1568, 0, 0.14, { type: "sine", gain: 0.24 })
    tone(2093, 0.02, 0.2, { type: "sine", gain: 0.18 })
    tone(1318, 0.14, 0.3, { type: "sine", gain: 0.16 })
    noise(0.3, 0.35, 0.1, { filter: { type: "bandpass", freq: 3200 }, q: 0.6 })
  },

  fanfare: () => {
    const notes = [
      [392, 0],
      [392, 0.14],
      [392, 0.28],
      [523, 0.44],
      [659, 0.72],
      [784, 0.92],
      [1046, 1.15],
    ]
    notes.forEach(([f, at]) => {
      tone(f, at, 0.42, { type: "square", gain: 0.13 })
      tone(f, at, 0.5, { type: "triangle", gain: 0.16 })
    })
    tone(130.81, 1.15, 1.4, { type: "sine", gain: 0.2 })
    crowd(1.3, 2.6, { gain: 0.24 })
  },

  /** Nobody knew it. */
  crickets: () => {
    for (let i = 0; i < 14; i++) {
      const at = 0.15 + i * 0.28 + Math.random() * 0.06
      for (let n = 0; n < 3; n++) tone(4200 + Math.random() * 400, at + n * 0.035, 0.028, { type: "square", gain: 0.05 })
    }
    noise(0, 4.2, 0.012, { filter: { type: "lowpass", freq: 300 } })
  },

  /** The bed of tension under a wager, or a host stalling for time. */
  suspense: () => {
    for (let i = 0; i < 10; i++) {
      tone(110, i * 0.42, 0.36, { type: "sine", gain: 0.14 })
      tone(164.81, i * 0.42, 0.34, { type: "sine", gain: 0.06 })
    }
    tone(55, 0, 4.4, { type: "sine", gain: 0.1 })
  },

  /** Scene change. */
  whoosh: () => {
    noise(0, 0.7, 0.14, { filter: { type: "bandpass", freq: 900 }, q: 0.4 })
    tone(120, 0, 0.7, { type: "sawtooth", gain: 0.06, sweep: 1600 })
  },

  ding: () => {
    tone(1760, 0, 0.5, { type: "sine", gain: 0.22 })
    tone(2637, 0.01, 0.4, { type: "sine", gain: 0.1 })
  },

  buzzer: () => {
    tone(140, 0, 0.75, { type: "square", gain: 0.22 })
    tone(147, 0, 0.75, { type: "square", gain: 0.18 })
  },
}

/** What the host desk lists, in the order it lists them. */
export const BOARD_CUES = [
  { id: "applause", label: "Applause", icon: "👏" },
  { id: "ovation", label: "Ovation", icon: "🎉" },
  { id: "cheer", label: "Cheer", icon: "🙌" },
  { id: "drumroll", label: "Drumroll", icon: "🥁" },
  { id: "fanfare", label: "Fanfare", icon: "🎺" },
  { id: "airhorn", label: "Airhorn", icon: "📯" },
  { id: "cash", label: "Ka-ching", icon: "💰" },
  { id: "ding", label: "Ding", icon: "🔔" },
  { id: "trombone", label: "Sad trombone", icon: "🎷" },
  { id: "boo", label: "Boo", icon: "👎" },
  { id: "crickets", label: "Crickets", icon: "🦗" },
  { id: "suspense", label: "Suspense", icon: "😬" },
  { id: "whoosh", label: "Whoosh", icon: "💨" },
  { id: "buzzer", label: "Wrong buzzer", icon: "🚫" },
]

export function playCue(id) {
  board[id]?.()
}

// ── The music bed ────────────────────────────────────────────────────────────

/**
 * A loop to fill the lobby, and the silence while a room reads a clue.
 *
 * Scheduled a bar ahead on a timer rather than as one long buffer, because a
 * bed that has to be stoppable *now* — the moment someone buzzes — cannot be a
 * single node already committed to the graph. Four bars of A minor, vamping:
 * unobtrusive on purpose, since the host has to talk over it.
 */
const BARS = [
  { root: 110.0, chord: [220.0, 261.63, 329.63] }, // Am
  { root: 87.31, chord: [174.61, 220.0, 261.63] }, // F
  { root: 130.81, chord: [261.63, 329.63, 392.0] }, // C
  { root: 98.0, chord: [196.0, 246.94, 293.66] }, // G
]
const BAR_SECONDS = 2.4
const LOOKAHEAD = 0.7

let musicTimer = 0
let nextBarAt = 0
let barIndex = 0
let musicOn = false

function scheduleBar(at, bar) {
  if (!ctx) return
  const t = at - ctx.currentTime

  // Bass: one long note under the whole bar.
  tone(bar.root, t, BAR_SECONDS * 0.92, { type: "triangle", gain: 0.16, bus: musicBus })
  tone(bar.root / 2, t, BAR_SECONDS * 0.92, { type: "sine", gain: 0.1, bus: musicBus })

  // Pad: the chord, entering softly.
  bar.chord.forEach((f, i) => tone(f, t + i * 0.02, BAR_SECONDS * 0.85, { type: "sine", gain: 0.05, bus: musicBus }))

  // A plucked arpeggio over the top, so the loop has somewhere to go.
  const arp = [bar.chord[0], bar.chord[1], bar.chord[2], bar.chord[1] * 2]
  arp.forEach((f, i) => tone(f * 2, t + 0.3 + i * 0.5, 0.34, { type: "triangle", gain: 0.035, bus: musicBus }))

  // Pulse on the beat — barely there, but it is what makes it feel like time
  // passing rather than a chord being held.
  for (let i = 0; i < 4; i++) noise(t + i * (BAR_SECONDS / 4), 0.03, 0.012, { bus: musicBus, filter: { type: "highpass", freq: 5000 } })
}

function pump() {
  if (!ctx || !musicOn) return
  while (nextBarAt < ctx.currentTime + LOOKAHEAD) {
    scheduleBar(nextBarAt, BARS[barIndex % BARS.length])
    barIndex += 1
    nextBarAt += BAR_SECONDS
  }
}

export const music = {
  get playing() {
    return musicOn
  },
  start(level = 0.5) {
    unlock()
    if (!ctx || musicOn) return
    musicOn = true
    barIndex = 0
    nextBarAt = ctx.currentTime + 0.1
    musicBus.gain.cancelScheduledValues(ctx.currentTime)
    musicBus.gain.setValueAtTime(0.0001, ctx.currentTime)
    musicBus.gain.exponentialRampToValueAtTime(Math.max(0.01, level), ctx.currentTime + 1.2)
    pump()
    musicTimer = setInterval(pump, 250)
  },
  stop() {
    if (!musicOn) return
    musicOn = false
    clearInterval(musicTimer)
    musicTimer = 0
    if (!ctx) return
    // Fade rather than cut. Notes already scheduled keep sounding, and yanking
    // the gain to zero under them is the click this file exists to avoid.
    musicBus.gain.cancelScheduledValues(ctx.currentTime)
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime)
    musicBus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8)
  },
  /** Drop the bed under a clue without stopping it, then bring it back. */
  duck(on) {
    if (!ctx || !musicOn) return
    const target = on ? 0.06 : 0.5
    musicBus.gain.cancelScheduledValues(ctx.currentTime)
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), ctx.currentTime)
    musicBus.gain.exponentialRampToValueAtTime(target, ctx.currentTime + 0.35)
  },
}

/** Map a relay effect onto a cue, so pages don't each grow a switch statement. */
export function playForEffect(effect) {
  switch (effect.kind) {
    case "clue-open":
      return sfx.select()
    case "clue-close":
      return sfx.clueClose()
    case "nitro":
      return sfx.nitro()
    case "wager-set":
      return sfx.wagerLock()
    case "buzz-in":
      return sfx.buzz()
    case "buzz-early":
      return sfx.reject()
    case "buzzer-open":
    case "buzzer-reopen":
      return sfx.arm()
    case "correct":
    case "final-correct":
      return sfx.correct()
    case "wrong":
    case "final-wrong":
      return sfx.wrong()
    case "undo":
      return sfx.undo()
    case "time-up":
      return sfx.timeUp()
    case "lifeline-start":
      return sfx.lifeline()
    case "reveal":
      return sfx.reveal()
    case "game-start":
      return sfx.boardOpen()
    case "round-start":
      return sfx.roundStart()
    case "final-open":
      return sfx.finalOpen()
    case "paused":
      return sfx.pause()
    case "resumed":
      return sfx.resume()
    case "round-complete":
      return sfx.roundEnd()
    case "game-end":
      return sfx.gameOver()
    // Fired by hand from the host desk. See `board`.
    case "sfx":
      return playCue(effect.cue)
  }
}
