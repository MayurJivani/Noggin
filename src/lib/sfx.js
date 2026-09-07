/**
 * Sound.
 *
 * Two layers, and the split matters:
 *
 * - **Samples** (`public/sfx/*.mp3`) are what the room hears — the applause,
 *   the drumroll, the airhorn, the music bed. Real recordings, because
 *   oscillators can imitate a bell but not a crowd, and a synthesised "round of
 *   applause" sounds like static with ambitions. All CC0; see `public/sfx/
 *   CREDITS.md`.
 * - **Synthesis** covers the tight, latency-critical game cues — the buzz, the
 *   early-press reject, the countdown tick — where the cue has to land the
 *   instant it fires and a decode or a fetch is a risk not worth taking. It is
 *   also the **fallback** for every sample: delete the whole `sfx/` folder and
 *   the game still makes all its noises, just plainer.
 *
 * Three buses hang off the master so they can be balanced: cues fire loud, the
 * bed sits underneath, the soundboard lands between them. Browsers won't start
 * audio without a gesture, so the display page calls `unlock()` on the first
 * click anywhere and everything after that works.
 */

/**
 * Samples are off until someone picks them.
 *
 * The recordings that were here were placeholders and have been taken out
 * rather than left playing in a real game. Everything below still works —
 * `sample()` simply goes straight to its synthesised stand-in, so the game
 * keeps making its own noises and no request is made for a file that is not
 * there.
 *
 * **To turn sound back on:** drop MP3s into `public/sfx/` named for the keys of
 * `SAMPLES` below (`applause.mp3`, `drumroll.mp3`, … and `music.mp3` for the
 * bed) and set this to `true`. Nothing else changes: the soundboard reappears
 * on the host desk and the controller, and the bed becomes available.
 */
export const SAMPLES_ENABLED = false

/**
 * The interface's own noises — a tap, a toggle, a panel opening.
 *
 * **Off until approved.** These are new and they are the easiest sounds in the
 * app to get wrong: a game cue fires a dozen times an hour and is *meant* to be
 * noticed, whereas a UI tick fires every few seconds on the host desk and is
 * only good if it disappears into the furniture. Hear them all on `/sounds`
 * before this goes true.
 */
export const UI_SFX_ENABLED = false

/**
 * Which take of the game's own cues to play.
 *
 * `"current"` is what has always shipped: square waves and filtered noise,
 * plain and legible. `"gold"` is the same cues rebuilt out of struck bells and
 * brass to match the black-and-gold the rest of the app is made of. Both are
 * synthesised, both are latency-free, and they are A/B'd side by side on
 * `/sounds` — this constant is the whole switch.
 */
export const CUE_TAKE = "current"

let ctx = null
let master = null
let cueBus = null
let boardBus = null
let musicBus = null
let uiBus = null

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

    // Its own bus so it can be turned down to nothing without touching the
    // game. An operator who finds interface clicks irritating should be able to
    // silence them and still hear the buzzer.
    uiBus = ctx.createGain()
    uiBus.gain.value = 0.7
    uiBus.connect(master)

    // Warm the short ones now: a soundboard button that has to fetch and decode
    // before it makes a sound is a button the host presses twice.
    preload()
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

/** How loud the interface is, if at all. */
export function setUiVolume(v) {
  if (uiBus) uiBus.gain.value = Math.max(0, Math.min(1, v))
}

export const isUnlocked = () => !!ctx && ctx.state === "running"

// ── Samples ──────────────────────────────────────────────────────────────────

/** Where the files live. Same origin as the page, so no CORS to think about. */
const SFX_BASE = "/sfx"

const buffers = new Map()
const loading = new Map()
/** Files we have already failed to find — don't ask again on every press. */
const missing = new Set()

function load(id) {
  if (!ctx || missing.has(id)) return Promise.reject(new Error(id))
  if (buffers.has(id)) return Promise.resolve(buffers.get(id))
  if (loading.has(id)) return loading.get(id)

  const job = fetch(`${SFX_BASE}/${id}.mp3`)
    .then((res) => {
      if (!res.ok) throw new Error(`${id}: ${res.status}`)
      return res.arrayBuffer()
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buf) => {
      buffers.set(id, buf)
      loading.delete(id)
      return buf
    })
    .catch((err) => {
      // A missing or undecodable file is not an error worth breaking a quiz
      // over. Remember it and let the synth take over.
      missing.add(id)
      loading.delete(id)
      throw err
    })

  loading.set(id, job)
  return job
}

/** Everything except the bed, which is a megabyte and can wait for its cue. */
function preload() {
  if (!SAMPLES_ENABLED) return
  for (const id of Object.keys(SAMPLES)) load(id).catch(() => {})
}

function playBuffer(buf, { bus, gain = 1, loop = false, when = 0 } = {}) {
  const src = ctx.createBufferSource()
  const env = ctx.createGain()
  env.gain.value = gain
  src.buffer = buf
  src.loop = loop
  src.connect(env).connect(bus ?? boardBus)
  src.start(ctx.currentTime + when)
  return { src, env }
}

/**
 * Play a sample, or the synthesised stand-in if it isn't there.
 *
 * Synchronous when the buffer is warm, which after `unlock()` it always is —
 * the async path only runs on the first press of something that failed to
 * preload, and even then the fallback fires immediately rather than leaving a
 * silence while a fetch is in flight.
 */
function sample(id, fallback, opts = {}) {
  if (!ctx) return
  // No samples chosen yet: the stand-in *is* the sound, and asking for a file
  // that is not there would be a 404 per cue per page.
  if (!SAMPLES_ENABLED) return fallback?.()
  const warm = buffers.get(id)
  if (warm) return playBuffer(warm, opts)
  if (missing.has(id)) return fallback?.()
  load(id).then(
    (buf) => playBuffer(buf, opts),
    () => fallback?.(),
  )
}

// ── Synthesis ────────────────────────────────────────────────────────────────

/** One shaped note. The synthesised cues below are a handful of these. */
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
 * A struck bell — the sound the theme is asking for.
 *
 * Gold reads as metal, and metal is *inharmonic*: a bell's overtones sit at
 * ratios like 2.76 and 5.40 rather than the neat 2 and 3 of a plucked string,
 * which is exactly why it rings instead of playing a note. The high partials
 * are also given shorter decays than the low ones, because that decay order is
 * what makes a strike sound struck rather than held — get it wrong and the
 * same frequencies sound like an organ.
 */
const BELL_PARTIALS = [
  // ratio, share of the gain, share of the decay
  [1, 1, 1],
  [2.76, 0.5, 0.7],
  [5.4, 0.26, 0.45],
  [8.93, 0.12, 0.26],
]

function bell(freq, start = 0, dur = 1.2, { gain = 0.22, bus = null } = {}) {
  for (const [ratio, g, decay] of BELL_PARTIALS) {
    tone(freq * ratio, start, dur * decay, { type: "sine", gain: gain * g, bus })
  }
}

/**
 * A brass note: a sawtooth heard through a filter that opens as it is blown.
 *
 * The two details that stop this sounding like a buzzer are both in the attack
 * — the filter sweeping up over the first 70ms, and the pitch starting a hair
 * flat and settling. That scoop is what a player does with their lip, and its
 * absence is most of why synthesised fanfares sound like alarms.
 */
function brass(freq, start = 0, dur = 0.5, { gain = 0.18, bus = null, open = 6 } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const lp = ctx.createBiquadFilter()
  const env = ctx.createGain()

  osc.type = "sawtooth"
  osc.frequency.setValueAtTime(freq * 0.985, t0)
  osc.frequency.exponentialRampToValueAtTime(freq, t0 + 0.09)

  lp.type = "lowpass"
  lp.Q.value = 1.2
  lp.frequency.setValueAtTime(freq * 1.2, t0)
  lp.frequency.exponentialRampToValueAtTime(freq * open, t0 + 0.07)
  lp.frequency.exponentialRampToValueAtTime(freq * 1.6, t0 + dur)

  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.03)
  env.gain.setValueAtTime(gain, t0 + dur * 0.6)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  osc.connect(lp).connect(env).connect(bus ?? cueBus)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

/** Weight under a cue. Felt through a PA more than heard through a laptop. */
function thud(start = 0, { gain = 0.3, freq = 90, bus = null } = {}) {
  tone(freq, start, 0.24, { type: "sine", gain, sweep: freq * 0.45, bus })
  noise(start, 0.09, gain * 0.35, { filter: { type: "lowpass", freq: 400 }, bus })
}

/** Plain stand-ins, used only when a sample is missing. */
const synth = {
  applause: () => noise(0, 2.2, 0.14, { filter: { type: "bandpass", freq: 1900 }, q: 0.6 }),
  drumroll: () => {
    for (let i = 0; i < 40; i++) noise((i / 40) ** 2 * 1.8, 0.035, 0.12, { filter: { type: "bandpass", freq: 260 } })
    noise(1.85, 1.2, 0.2, { filter: { type: "highpass", freq: 2600 } })
  },
  airhorn: () => [233, 311, 466].forEach((f) => tone(f, 0, 0.8, { type: "sawtooth", gain: 0.14 })),
  fanfare: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.6, { type: "square", gain: 0.14 })),
  trombone: () => [233, 220, 196, 174].forEach((f, i) => tone(f, i * 0.3, 0.34, { type: "sawtooth", gain: 0.2, sweep: f * 0.94 })),
  boo: () => [98, 116, 131].forEach((f) => tone(f, 0, 1.4, { type: "sawtooth", gain: 0.09, sweep: f * 0.8 })),
  gong: () => {
    tone(110, 0, 3, { type: "sine", gain: 0.22 })
    noise(0, 2.4, 0.08, { filter: { type: "lowpass", freq: 900 } })
  },
  whoosh: () => noise(0, 0.7, 0.14, { filter: { type: "bandpass", freq: 900 }, q: 0.4 }),
  ding: () => {
    tone(1760, 0, 0.5, { type: "sine", gain: 0.22 })
    tone(2637, 0.01, 0.4, { type: "sine", gain: 0.1 })
  },
  buzzer: () => {
    tone(140, 0, 0.75, { type: "square", gain: 0.22 })
    tone(147, 0, 0.75, { type: "square", gain: 0.18 })
  },
  tada: () => {
    tone(784, 0, 0.14, { type: "triangle", gain: 0.3 })
    tone(1046, 0.11, 0.4, { type: "triangle", gain: 0.3 })
  },
  crickets: () => {
    for (let i = 0; i < 12; i++) {
      const at = 0.15 + i * 0.28
      for (let n = 0; n < 3; n++) tone(4200, at + n * 0.035, 0.028, { type: "square", gain: 0.05 })
    }
  },
  cheer: () => noise(0, 1.8, 0.12, { filter: { type: "bandpass", freq: 1400 }, q: 0.5 }),
  laugh: () => [220, 196, 220, 175].forEach((f, i) => tone(f, i * 0.16, 0.14, { type: "sawtooth", gain: 0.12 })),
  ovation: () => noise(0, 4, 0.16, { filter: { type: "bandpass", freq: 1900 }, q: 0.6 }),
}

// ── The soundboard ───────────────────────────────────────────────────────────

/**
 * Cues the host fires by hand: everything a game show needs between the
 * questions. Each is a real recording with a synthesised stand-in behind it.
 */
const SAMPLES = {
  applause: { gain: 0.9 },
  ovation: { gain: 1 },
  cheer: { gain: 0.9 },
  drumroll: { gain: 0.9 },
  fanfare: { gain: 0.8 },
  airhorn: { gain: 0.7 },
  tada: { gain: 0.9 },
  ding: { gain: 0.8 },
  trombone: { gain: 0.9 },
  boo: { gain: 0.9 },
  crickets: { gain: 0.8 },
  gong: { gain: 0.8 },
  whoosh: { gain: 0.8 },
  buzzer: { gain: 0.8 },
  laugh: { gain: 0.9 },
}

export const board = Object.fromEntries(
  Object.entries(SAMPLES).map(([id, opts]) => [id, () => sample(id, synth[id], { bus: boardBus, ...opts })]),
)

/** What the host desk lists, in the order it lists them. */
export const BOARD_CUES = [
  { id: "applause", label: "Applause", icon: "👏" },
  { id: "ovation", label: "Ovation", icon: "🎉" },
  { id: "cheer", label: "Cheer", icon: "🙌" },
  { id: "drumroll", label: "Drumroll", icon: "🥁" },
  { id: "fanfare", label: "Fanfare", icon: "🎺" },
  { id: "airhorn", label: "Airhorn", icon: "📯" },
  { id: "tada", label: "Ta-da", icon: "✨" },
  { id: "ding", label: "Ding", icon: "🔔" },
  { id: "gong", label: "Gong", icon: "🥁" },
  { id: "trombone", label: "Sad trombone", icon: "🎷" },
  { id: "boo", label: "Boo", icon: "👎" },
  { id: "laugh", label: "Laugh", icon: "😂" },
  { id: "crickets", label: "Crickets", icon: "🦗" },
  { id: "whoosh", label: "Whoosh", icon: "💨" },
  { id: "buzzer", label: "Wrong buzzer", icon: "🚫" },
]

export function playCue(id) {
  board[id]?.()
}

// ── Game cues ────────────────────────────────────────────────────────────────

/**
 * The game's own noises.
 *
 * The fast ones stay synthesised on purpose: a buzz-in has to land the moment
 * it happens, and the difference between an oscillator and a decoded sample is
 * the difference between the sound arriving with the press and arriving after
 * it. The big moments — the answer, the miss, a Nitro, the end of the game —
 * are samples, because those are the ones the room reacts to.
 */
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
  /** Last five seconds of any countdown. */
  tick: () => tone(1200, 0, 0.03, { type: "sine", gain: 0.1 }),
  /** The buzzer opens. */
  arm: () => tone(1046, 0, 0.09, { type: "sine", gain: 0.14 }),
  /** Back to the grid after a clue. */
  clueClose: () => tone(520, 0, 0.14, { type: "sine", gain: 0.1, sweep: 300 }),
  reveal: () => tone(523, 0, 0.35, { type: "triangle", gain: 0.22 }),
  /** A ruling taken back. */
  undo: () => tone(700, 0, 0.16, { type: "sine", gain: 0.12, sweep: 420 }),
  /** A phone takes a seat in the lobby. */
  join: () => {
    tone(880, 0, 0.07, { type: "sine", gain: 0.13 })
    tone(1318, 0.06, 0.12, { type: "sine", gain: 0.11 })
  },
  timeUp: () => {
    tone(440, 0, 0.12, { type: "square", gain: 0.22 })
    tone(440, 0.16, 0.12, { type: "square", gain: 0.22 })
    tone(330, 0.32, 0.4, { type: "square", gain: 0.22 })
  },
  lifeline: () => {
    tone(880, 0, 0.1, { type: "sine", gain: 0.2 })
    tone(660, 0.12, 0.1, { type: "sine", gain: 0.2 })
    tone(880, 0.24, 0.18, { type: "sine", gain: 0.2 })
  },
  /** The room is held, and let go. */
  pause: () => {
    tone(523, 0, 0.16, { type: "sine", gain: 0.16 })
    tone(392, 0.13, 0.3, { type: "sine", gain: 0.16 })
  },
  resume: () => {
    tone(392, 0, 0.14, { type: "sine", gain: 0.16 })
    tone(523, 0.11, 0.26, { type: "sine", gain: 0.16 })
  },
  /** The wager is locked and the clue is about to show. */
  wagerLock: () => {
    tone(392, 0, 0.12, { type: "square", gain: 0.16 })
    tone(523, 0.1, 0.2, { type: "square", gain: 0.16 })
  },

  // The big moments, on tape.
  correct: () => sample("tada", synth.tada, { bus: cueBus, gain: 0.9 }),
  wrong: () => sample("buzzer", synth.buzzer, { bus: cueBus, gain: 0.75 }),
  nitro: () => sample("fanfare", synth.fanfare, { bus: cueBus, gain: 0.85 }),
  /** The board goes up for the first time. */
  boardOpen: () => sample("whoosh", synth.whoosh, { bus: cueBus, gain: 0.7 }),
  /** A new round's board arrives. */
  roundStart: () => sample("whoosh", synth.whoosh, { bus: cueBus, gain: 0.7 }),
  /** Into the final. Low, slow and a bit ominous. */
  finalOpen: () => sample("gong", synth.gong, { bus: cueBus, gain: 0.8 }),
  roundEnd: () => sample("applause", synth.applause, { bus: boardBus, gain: 0.7 }),
  /** That's the game. */
  gameOver: () => sample("ovation", synth.ovation, { bus: boardBus, gain: 1 }),
}

/**
 * The same cues, rebuilt in the app's own material.
 *
 * Everything here is a bell or a brass note rather than a raw oscillator, so
 * the game sounds like the thing it looks like: struck metal over a black
 * stage. Still synthesised, so still free of the one risk that matters — a
 * buzz-in lands with the press rather than after a decode.
 *
 * Not live until `CUE_TAKE` says so. Compare them on `/sounds`.
 */
export const ALT = {
  select: () => bell(1046, 0, 0.35, { gain: 0.12 }),
  /** Body, blat and ring, in that order — the whole event in 40ms of attack. */
  buzz: () => {
    thud(0, { gain: 0.3, freq: 80 })
    brass(233, 0, 0.42, { gain: 0.16 })
    bell(880, 0.02, 0.9, { gain: 0.14 })
  },
  reject: () => {
    thud(0, { gain: 0.16, freq: 110 })
    tone(160, 0, 0.2, { type: "sawtooth", gain: 0.1, sweep: 70 })
  },
  arm: () => bell(2093, 0, 0.5, { gain: 0.1 }),
  tick: () => bell(2637, 0, 0.06, { gain: 0.06 }),
  clueClose: () => bell(660, 0, 0.4, { gain: 0.09 }),
  undo: () => bell(784, 0, 0.4, { gain: 0.09 }),
  reveal: () => {
    bell(523, 0, 1.1, { gain: 0.16 })
    bell(784, 0.08, 0.9, { gain: 0.1 })
  },
  join: () => {
    bell(1318, 0, 0.3, { gain: 0.09 })
    bell(1976, 0.06, 0.4, { gain: 0.07 })
  },
  /** Two brass notes climbing, and gold left ringing over the top. */
  correct: () => {
    brass(392, 0, 0.3, { gain: 0.14 })
    brass(523, 0.1, 0.32, { gain: 0.14 })
    bell(1046, 0.2, 1.4, { gain: 0.16 })
  },
  /** A closed, flat pair a semitone apart. Dissonant on purpose; no ring. */
  wrong: () => {
    thud(0, { gain: 0.28, freq: 70 })
    brass(146, 0.02, 0.7, { gain: 0.14, open: 3 })
    brass(155, 0.02, 0.7, { gain: 0.1, open: 3 })
  },
  timeUp: () => {
    bell(440, 0, 0.5, { gain: 0.16 })
    bell(440, 0.22, 0.5, { gain: 0.16 })
    bell(330, 0.44, 1.6, { gain: 0.18 })
  },
  lifeline: () => {
    bell(880, 0, 0.4, { gain: 0.14 })
    bell(660, 0.12, 0.4, { gain: 0.14 })
    bell(1318, 0.24, 1.1, { gain: 0.14 })
  },
  wagerLock: () => {
    brass(392, 0, 0.16, { gain: 0.13, open: 4 })
    brass(523, 0.1, 0.26, { gain: 0.13, open: 4 })
  },
  pause: () => {
    bell(523, 0, 0.4, { gain: 0.11 })
    bell(392, 0.13, 0.8, { gain: 0.11 })
  },
  resume: () => {
    bell(392, 0, 0.35, { gain: 0.11 })
    bell(523, 0.11, 0.8, { gain: 0.11 })
  },
  nitro: () => {
    ;[392, 523, 659, 784].forEach((f, i) => brass(f, i * 0.09, 0.34, { gain: 0.15 }))
    bell(1046, 0.36, 1.8, { gain: 0.18 })
  },
  boardOpen: () => {
    noise(0, 0.6, 0.1, { filter: { type: "bandpass", freq: 900 }, q: 0.4 })
    bell(523, 0.28, 1.6, { gain: 0.14 })
  },
  roundStart: () => {
    noise(0, 0.5, 0.09, { filter: { type: "bandpass", freq: 1100 }, q: 0.4 })
    bell(659, 0.22, 1.2, { gain: 0.13 })
  },
  /** Low and long. The final should sound like the room getting quieter. */
  finalOpen: () => {
    thud(0, { gain: 0.3, freq: 60 })
    bell(110, 0.02, 3.4, { gain: 0.2 })
    brass(146, 0.1, 1.2, { gain: 0.1, open: 2.5 })
  },
}

/**
 * The interface's noises.
 *
 * Deliberately tiny — a fifth the gain of a game cue, and none of them longer
 * than half a second. The test for one of these is not "does it sound good on
 * its own" but "can the host press this two hundred times in an evening".
 */
export const ui = {
  /** Any ordinary button. */
  tap: () => bell(1568, 0, 0.18, { gain: 0.05, bus: uiBus }),
  toggleOn: () => {
    bell(1046, 0, 0.22, { gain: 0.05, bus: uiBus })
    bell(1568, 0.05, 0.3, { gain: 0.045, bus: uiBus })
  },
  toggleOff: () => {
    bell(1568, 0, 0.2, { gain: 0.045, bus: uiBus })
    bell(1046, 0.05, 0.28, { gain: 0.05, bus: uiBus })
  },
  /** Moving between tabs on the desk. The most-fired cue in the app. */
  tab: () => bell(1318, 0, 0.14, { gain: 0.04, bus: uiBus }),
  open: () => {
    noise(0, 0.22, 0.03, { filter: { type: "bandpass", freq: 1200 }, q: 0.5, bus: uiBus })
    bell(880, 0.03, 0.4, { gain: 0.05, bus: uiBus })
  },
  close: () => {
    bell(880, 0, 0.16, { gain: 0.04, bus: uiBus })
    noise(0.02, 0.18, 0.025, { filter: { type: "lowpass", freq: 900 }, bus: uiBus })
  },
  /** Something was written down: a board saved, a clue committed. */
  save: () => {
    bell(1046, 0, 0.3, { gain: 0.06, bus: uiBus })
    bell(1568, 0.07, 0.5, { gain: 0.05, bus: uiBus })
  },
  /**
   * A refusal — a bad code, a form that won't go.
   *
   * Dull and low, with no ring at all, so it can never be mistaken across a
   * room for the wrong-answer cue. An operator's mistake is not an event in
   * the game and must not sound like one.
   */
  error: () => {
    thud(0, { gain: 0.14, freq: 120, bus: uiBus })
    tone(196, 0.02, 0.22, { type: "triangle", gain: 0.08, bus: uiBus })
  },
  /** Arriving somewhere new: a room opened, a screen switched. */
  nav: () => noise(0, 0.34, 0.045, { filter: { type: "bandpass", freq: 800 }, q: 0.35, bus: uiBus }),
}

/**
 * Fire an interface cue by name.
 *
 * Every caller goes through here rather than touching `ui` directly, so the
 * whole layer is one constant away from silence and no component has to know
 * whether it is switched on.
 */
export function playUi(id) {
  if (!UI_SFX_ENABLED) return
  ui[id]?.()
}

/**
 * The plain take, kept aside before the chosen one is folded in.
 *
 * Only the audition page wants this: once `sfx` has been overwritten there is
 * otherwise no way left to hear what the alternative replaced.
 */
export const PLAIN = { ...sfx }

// One assignment rather than a branch at every call site: pick the take once
// and every `sfx.buzz()` in the app follows it.
if (CUE_TAKE === "gold") Object.assign(sfx, ALT)

// ── The music bed ────────────────────────────────────────────────────────────

let bedSource = null
let bedWanted = false

/**
 * A loop for the lobby and the dead air.
 *
 * Fetched on first use rather than with the rest — it is by far the biggest
 * file here, and a room that never turns the music on should never pay for it.
 */
export const music = {
  get playing() {
    return bedWanted
  },

  start(level = 0.45) {
    // There is no bed until someone picks one. See `SAMPLES_ENABLED`.
    if (!SAMPLES_ENABLED) return
    unlock()
    if (!ctx || bedWanted) return
    bedWanted = true
    load("music").then(
      (buf) => {
        // The host may have turned it off again while this was in flight.
        if (!bedWanted || bedSource) return
        bedSource = playBuffer(buf, { bus: musicBus, loop: true, gain: 1 })
        musicBus.gain.cancelScheduledValues(ctx.currentTime)
        musicBus.gain.setValueAtTime(0.0001, ctx.currentTime)
        musicBus.gain.exponentialRampToValueAtTime(Math.max(0.01, level), ctx.currentTime + 1.2)
      },
      () => {
        // No bed available. Silence is a perfectly good bed.
        bedWanted = false
      },
    )
  },

  stop() {
    if (!bedWanted) return
    bedWanted = false
    if (!ctx) return
    // Fade, then cut. Yanking the gain to zero under a playing buffer is the
    // click this file exists to avoid.
    const at = ctx.currentTime
    musicBus.gain.cancelScheduledValues(at)
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), at)
    musicBus.gain.exponentialRampToValueAtTime(0.0001, at + 0.8)
    const dying = bedSource
    bedSource = null
    setTimeout(() => dying?.src.stop(), 900)
  },

  /** Drop the bed under a clue without stopping it, then bring it back. */
  duck(on) {
    if (!ctx || !bedWanted || !bedSource) return
    const at = ctx.currentTime
    musicBus.gain.cancelScheduledValues(at)
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), at)
    musicBus.gain.exponentialRampToValueAtTime(on ? 0.05 : 0.45, at + 0.35)
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
