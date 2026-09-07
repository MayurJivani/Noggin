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
 * only good if it disappears into the furniture. They are also not wired to a
 * single button yet, so turning this on alone changes nothing — see `playUi`.
 */
export const UI_SFX_ENABLED = false

/**
 * Which take of the game's own cues to play.
 *
 * Four of these are the same family — squares, triangles and filtered noise —
 * and differ in production rather than material:
 *
 * - `"current"` — the original. Plain and legible, now without the clicks and
 *   the static that were never intended.
 * - `"v2"` — the original made properly: an onset, a body of two detuned
 *   voices, and sub weight under the three moments a room reacts to.
 * - `"v3"` — V2 tightened. Shorter, brighter, further forward; for a hall,
 *   where a long tail smears into whatever happens next.
 * - `"v4"` — V2 warmed. Longer, lower, softer; for a living room, where
 *   nothing needs to cut through a crowd.
 *
 * Two are a change of material rather than of degree:
 *
 * - `"gold"` — struck bells and brass, to match what the app looks like.
 * - `"arcade"` — a chip blip with a gold tail on it.
 *
 * All six are synthesised, so all six are latency-free. They were compared side
 * by side on a listening page that has since been removed, its job done; the
 * result is `CHOSEN` below.
 */

/**
 * The cues that ship, chosen one at a time.
 *
 * This is the outcome of an actual listening session rather than a designer's
 * preference, and it is a *mix* — which is the right shape for it. A take is a
 * consistent set of decisions about length, weight and brightness, but no
 * single set of those decisions is right for twenty cues that do completely
 * different jobs. The tick fires five times in five seconds and wants to stay
 * out of the way; the buzz has to stop a room mid-sentence. Asking both to
 * come from the same take is asking one of them to be wrong.
 *
 * The pattern that came out of it is worth naming, because it is not random:
 * **the heavy moments went warm and the quick ones stayed plain.** Everything
 * that marks a change of state — the buzz, the pause, the board arriving, the
 * final — took V4, the longest and lowest. Everything that happens *during*
 * play and must not interrupt it — the tick, the arm, the clock, the lifeline
 * — stayed on the original. The middle went to V2 and V3.
 *
 * Set `FORCE_TAKE` below to hear one take across the board instead.
 */
export const CHOSEN = {
  // Warm and weighted: the moments the room reacts to bodily.
  buzz: "v4",
  reject: "v4",
  undo: "v4",
  pause: "v4",
  resume: "v4",
  finalOpen: "v4",
  boardOpen: "v4",
  roundStart: "v4",

  // Plain and out of the way: the ones that fire during play.
  arm: "current",
  tick: "current",
  timeUp: "current",
  nitro: "current",
  lifeline: "current",
  clueClose: "current",

  // The middle ground.
  select: "v2",
  correct: "v2",
  wrong: "v2",
  reveal: "v3",
  wagerLock: "v3",
  join: "v3",
}

/**
 * Play every cue from one take, ignoring `CHOSEN`.
 *
 * `null` in normal use. Set it to a take name to hear the whole game in one
 * voice — which is the only way to judge whether a mix has gone incoherent,
 * and is much easier than reverting twenty entries by hand.
 */
export const FORCE_TAKE = null

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

function noise(start, dur, gain = 0.15, { bus = null, filter = null, q = 1, sweep = null } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const src = ctx.createBufferSource()
  const env = ctx.createGain()
  src.buffer = buf

  /*
    An attack, however short.

    The buffer's first sample is already at full amplitude — the `1 - i/frames`
    taper only shapes the tail — so starting the gain flat at `gain` steps the
    output from silence to maximum in one sample. That step is a click, and a
    click on the front of a noise burst is what makes a whoosh sound like a
    buzz. Milliseconds are enough; the cue still lands on time.
  */
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.25))

  let node = src
  if (filter) {
    const bp = ctx.createBiquadFilter()
    bp.type = typeof filter === "number" ? "bandpass" : filter.type
    const from = typeof filter === "number" ? filter : filter.freq
    bp.Q.value = q
    bp.frequency.setValueAtTime(from, t0)
    /*
      A band that moves.

      This is the other half of the same bug. Noise through a *stationary*
      bandpass is exactly what an untuned radio is, and no amount of choosing
      the centre frequency changes that — the ear reads movement, not position.
      Sweeping the band is what turns the same white noise into air moving past
      something.
    */
    if (sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + dur)
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

/**
 * A chip blip: square wave, no filter, and an envelope with corners on it.
 *
 * The abruptness *is* the sound. A 1980s sound chip had no envelope generator
 * worth the name — a channel was on at full or off at nothing — so the gentle
 * 12ms exponential swell that makes `tone()` pleasant is exactly the thing that
 * stops this being arcade. Linear ramps of two milliseconds, and a hard gate at
 * the end.
 */
function blip(freq, start = 0, dur = 0.08, { gain = 0.14, type = "square", bus = null, to = null } = {}) {
  if (!ctx) return
  const t0 = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur)

  env.gain.setValueAtTime(0.0001, t0)
  env.gain.linearRampToValueAtTime(gain, t0 + 0.002)
  env.gain.setValueAtTime(gain, t0 + Math.max(0.004, dur - 0.006))
  env.gain.linearRampToValueAtTime(0.0001, t0 + dur)

  osc.connect(env).connect(bus ?? cueBus)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/**
 * Notes one after another, fast.
 *
 * A chip could only sound one note per channel, so a chord had to be played as
 * a sprint through its notes — and that limitation became the sound of getting
 * something right. Kept genuinely fast: past about 60ms a step it stops being
 * an arpeggio and starts being a tune.
 */
function arp(notes, start = 0, step = 0.045, { gain = 0.13, type = "square", bus = null, hold = 1.4 } = {}) {
  notes.forEach((f, i) => blip(f, start + i * step, step * hold, { gain, type, bus }))
}

/** Weight under a cue. Felt through a PA more than heard through a laptop. */
function thud(start = 0, { gain = 0.3, freq = 90, bus = null } = {}) {
  tone(freq, start, 0.24, { type: "sine", gain, sweep: freq * 0.45, bus })
  noise(start, 0.09, gain * 0.35, { filter: { type: "lowpass", freq: 400 }, bus })
}

/**
 * A crowd, out of individual hands.
 *
 * The old version of this was one long noise burst through a fixed bandpass,
 * which is not what a crowd is — it is what a radio between stations is. A
 * clap is a *transient*: three milliseconds of broadband crack and nothing
 * after it, and a room full of people is a few hundred of those at random
 * offsets with no two quite the same brightness.
 *
 * This still will not fool anyone, and it is not meant to. It is meant to
 * sound like applause heard through a wall rather than like a fault on the
 * line, which is the difference between a stand-in and a bug. Real recordings
 * remain the answer — see `CROWD`.
 */
function crowd(dur, density, gain, { bus = null, spread = 1 } = {}) {
  const claps = Math.round(dur * density)
  for (let i = 0; i < claps; i++) {
    // Front-loaded: a room does not start applauding in unison, but it does
    // start together enough that a flat distribution sounds like rain.
    const at = Math.random() ** 0.75 * dur
    const bright = 1400 + Math.random() * 2600 * spread
    noise(at, 0.02 + Math.random() * 0.025, gain * (0.5 + Math.random() * 0.7), {
      filter: { type: "bandpass", freq: bright },
      q: 1.1,
      bus,
    })
  }
}

/** Plain stand-ins, used only when a sample is missing. */
const synth = {
  applause: () => crowd(2.2, 55, 0.075),
  drumroll: () => {
    for (let i = 0; i < 40; i++) noise((i / 40) ** 2 * 1.8, 0.035, 0.12, { filter: { type: "bandpass", freq: 260 }, q: 1.6 })
    noise(1.85, 1.2, 0.2, { filter: { type: "highpass", freq: 2600 } })
  },
  airhorn: () => [233, 311, 466].forEach((f) => tone(f, 0, 0.8, { type: "sawtooth", gain: 0.14 })),
  fanfare: () => {
    ;[392, 523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.6, { type: "square", gain: 0.14 }))
    // A riser under the climb, arriving with the top note rather than the
    // bottom one, so the run has somewhere to be going.
    noise(0, 0.52, 0.07, { filter: { type: "bandpass", freq: 500 }, q: 2, sweep: 4000 })
  },
  trombone: () => [233, 220, 196, 174].forEach((f, i) => tone(f, i * 0.3, 0.34, { type: "sawtooth", gain: 0.2, sweep: f * 0.94 })),
  boo: () => [98, 116, 131].forEach((f) => tone(f, 0, 1.4, { type: "sawtooth", gain: 0.09, sweep: f * 0.8 })),
  gong: () => {
    tone(110, 0, 3, { type: "sine", gain: 0.22 })
    // The wash under it now falls away rather than sitting still, so it reads
    // as a struck thing ringing out instead of a hum arriving alongside.
    noise(0, 2.4, 0.09, { filter: { type: "lowpass", freq: 2200 }, q: 0.8, sweep: 260 })
  },
  /*
    A riser, not a hiss.

    This was a fixed 900Hz bandpass at Q 0.4 — so wide it barely filtered
    anything, which left plain white noise with a click on the front. That is
    the "noise buzz" on the board going up and on a new round starting, both of
    which play this. A band that climbs, and narrow enough to have a pitch to
    it, is what makes moving air out of the same random numbers.
  */
  whoosh: () => noise(0, 0.7, 0.16, { filter: { type: "bandpass", freq: 320 }, q: 2.2, sweep: 3600 }),
  ding: () => {
    tone(1760, 0, 0.5, { type: "sine", gain: 0.22 })
    tone(2637, 0.01, 0.4, { type: "sine", gain: 0.1 })
  },
  buzzer: () => {
    // 140 against 147 beats seven times a second, which is what makes a game
    // show buzzer sound wrong rather than merely low. The sub under it is new.
    thud(0, { gain: 0.2, freq: 68 })
    tone(140, 0, 0.75, { type: "square", gain: 0.22 })
    tone(147, 0, 0.75, { type: "square", gain: 0.18 })
  },
  tada: () => {
    tone(784, 0, 0.14, { type: "triangle", gain: 0.3 })
    tone(1046, 0.11, 0.4, { type: "triangle", gain: 0.3 })
    tone(1568, 0.13, 0.3, { type: "triangle", gain: 0.1 })
  },
  crickets: () => {
    for (let i = 0; i < 12; i++) {
      const at = 0.15 + i * 0.28
      for (let n = 0; n < 3; n++) tone(4200, at + n * 0.035, 0.028, { type: "square", gain: 0.05 })
    }
  },
  cheer: () => crowd(1.8, 45, 0.07, { spread: 1.3 }),
  laugh: () => [220, 196, 220, 175].forEach((f, i) => tone(f, i * 0.16, 0.14, { type: "sawtooth", gain: 0.12 })),
  ovation: () => crowd(4, 60, 0.08),
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
  select: () => {
    tone(660, 0, 0.09, { type: "triangle", gain: 0.18 })
    // A tick on the front. Two milliseconds of air is the difference between a
    // note starting and a thing being *pressed*.
    noise(0, 0.02, 0.05, { filter: { type: "bandpass", freq: 3200 }, q: 1.4 })
  },
  /** Someone got there first. */
  buzz: () => {
    // Sub underneath. On a laptop this is barely there; over a PA it is the
    // whole reason a buzz-in stops the room.
    thud(0, { gain: 0.22, freq: 75 })
    tone(180, 0, 0.28, { type: "square", gain: 0.22 })
    tone(240, 0.02, 0.26, { type: "square", gain: 0.14 })
  },
  /** Jumped the gun. */
  reject: () => {
    tone(150, 0, 0.16, { type: "sawtooth", gain: 0.16, sweep: 80 })
    thud(0, { gain: 0.1, freq: 105 })
  },
  /** Last five seconds of any countdown. */
  tick: () => tone(1200, 0, 0.03, { type: "sine", gain: 0.1 }),
  /** The buzzer opens. */
  arm: () => {
    tone(1046, 0, 0.09, { type: "sine", gain: 0.14 })
    tone(1568, 0.02, 0.07, { type: "sine", gain: 0.07 })
  },
  /** Back to the grid after a clue. */
  clueClose: () => {
    tone(520, 0, 0.14, { type: "sine", gain: 0.1, sweep: 300 })
    noise(0, 0.18, 0.05, { filter: { type: "bandpass", freq: 1800 }, q: 1.8, sweep: 400 })
  },
  reveal: () => {
    tone(523, 0, 0.35, { type: "triangle", gain: 0.22 })
    // A fifth over it, quieter and shorter. Fills the cue out without turning
    // it into a chord that has to resolve.
    tone(784, 0.03, 0.26, { type: "triangle", gain: 0.09 })
  },
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
    // Weight on the last one only. Three equal beeps is an alarm clock; two
    // and a landing is a verdict.
    thud(0.32, { gain: 0.16, freq: 80 })
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
 * A stab: two voices a few cents apart, with a tick of air on the front.
 *
 * The detune is the whole trick, and it is the single thing most missing from
 * the original set. One oscillator is a test tone. Two of them seven cents
 * apart beat slowly against each other, and that slow movement is what the ear
 * hears as an instrument rather than as a signal generator. The tick of noise
 * on the front does the same job at the other end: it gives the note an onset,
 * so it sounds struck rather than switched on.
 */
function stab(freq, start = 0, dur = 0.22, { gain = 0.16, type = "triangle", bus = null, sweep = null, air = 2600 } = {}) {
  tone(freq, start, dur, { type, gain, bus, sweep, detune: -7 })
  tone(freq, start, dur * 0.9, { type, gain: gain * 0.66, bus, sweep, detune: 7 })
  if (air) noise(start, 0.022, gain * 0.3, { filter: { type: "bandpass", freq: air }, q: 1.5, bus })
}

/**
 * V2 — the same idea as the original set, made properly.
 *
 * Not a change of material. This is still squares, triangles and filtered
 * noise, and every cue is recognisably the one it replaces: the buzz is still
 * a low square pair, the wrong answer is still two notes beating against each
 * other, the tick is still a tick. Anyone who knows the current set will not
 * have to relearn a thing.
 *
 * What changed is production. Every cue now has the three parts a sound needs
 * and the originals mostly lacked:
 *
 * - **An onset.** A tick of air on the front, so a note is struck rather than
 *   switched on.
 * - **A body.** Two detuned voices instead of one, so it beats slowly and
 *   reads as an instrument.
 * - **Weight, where the moment deserves it.** Sub under the buzz, the miss and
 *   the last beep of the clock — the three the room reacts to physically.
 *
 * The transitions are risers rather than washes, which is the fix for the
 * static that started all this.
 */
export const V2 = {
  select: () => stab(660, 0, 0.1, { gain: 0.16, type: "triangle", air: 3200 }),
  /** Low, loud and physical. The one cue that has to stop a room mid-sentence. */
  buzz: () => {
    thud(0, { gain: 0.26, freq: 72 })
    stab(180, 0, 0.3, { gain: 0.2, type: "square", air: 2400 })
    stab(270, 0.02, 0.24, { gain: 0.11, type: "square", air: null })
    noise(0, 0.22, 0.07, { filter: { type: "bandpass", freq: 2600 }, q: 1.6, sweep: 500 })
  },
  /** Down and out. Nothing here rises, because nothing here was earned. */
  reject: () => {
    thud(0, { gain: 0.12, freq: 105 })
    tone(150, 0, 0.18, { type: "sawtooth", gain: 0.15, sweep: 72 })
    noise(0, 0.16, 0.05, { filter: { type: "bandpass", freq: 1400 }, q: 1.8, sweep: 300 })
  },
  arm: () => {
    stab(1046, 0, 0.1, { gain: 0.12, type: "sine", air: 4200 })
    tone(1568, 0.03, 0.08, { type: "sine", gain: 0.06 })
  },
  /** Fires five times in a row, so it stays one clean transient and nothing more. */
  tick: () => tone(1300, 0, 0.028, { type: "sine", gain: 0.1 }),
  clueClose: () => {
    stab(520, 0, 0.16, { gain: 0.1, type: "sine", sweep: 300, air: null })
    noise(0, 0.2, 0.055, { filter: { type: "bandpass", freq: 2000 }, q: 1.8, sweep: 380 })
  },
  reveal: () => {
    stab(523, 0, 0.4, { gain: 0.19, type: "triangle" })
    tone(784, 0.04, 0.3, { type: "triangle", gain: 0.08 })
  },
  undo: () => stab(700, 0, 0.18, { gain: 0.11, type: "sine", sweep: 420, air: null }),
  join: () => {
    stab(880, 0, 0.08, { gain: 0.11, type: "sine", air: 3600 })
    stab(1318, 0.07, 0.14, { gain: 0.1, type: "sine", air: null })
  },
  timeUp: () => {
    stab(440, 0, 0.13, { gain: 0.19, type: "square", air: 2600 })
    stab(440, 0.17, 0.13, { gain: 0.19, type: "square", air: 2600 })
    stab(330, 0.34, 0.42, { gain: 0.2, type: "square", air: 2200 })
    thud(0.34, { gain: 0.17, freq: 78 })
  },
  lifeline: () => {
    stab(880, 0, 0.11, { gain: 0.16, type: "sine", air: 3800 })
    stab(660, 0.13, 0.11, { gain: 0.16, type: "sine", air: null })
    stab(880, 0.26, 0.22, { gain: 0.16, type: "sine", air: null })
  },
  pause: () => {
    stab(523, 0, 0.17, { gain: 0.14, type: "sine", air: 2800 })
    stab(392, 0.14, 0.32, { gain: 0.14, type: "sine", air: null })
  },
  resume: () => {
    stab(392, 0, 0.15, { gain: 0.14, type: "sine", air: 2800 })
    stab(523, 0.12, 0.28, { gain: 0.14, type: "sine", air: null })
  },
  wagerLock: () => {
    stab(392, 0, 0.13, { gain: 0.14, type: "square", air: 2400 })
    stab(523, 0.11, 0.22, { gain: 0.14, type: "square", air: null })
  },
  /** Up, and it keeps going up. */
  correct: () => {
    stab(784, 0, 0.15, { gain: 0.18, type: "triangle" })
    stab(1046, 0.11, 0.18, { gain: 0.18, type: "triangle", air: null })
    stab(1318, 0.21, 0.38, { gain: 0.15, type: "triangle", air: null })
    noise(0, 0.34, 0.05, { filter: { type: "bandpass", freq: 700 }, q: 2.2, sweep: 5000 })
  },
  /** The seven-beats-a-second pair, with a floor under it and a fall over it. */
  wrong: () => {
    thud(0, { gain: 0.24, freq: 66 })
    tone(140, 0, 0.7, { type: "square", gain: 0.2 })
    tone(147, 0, 0.7, { type: "square", gain: 0.16 })
    noise(0, 0.3, 0.055, { filter: { type: "bandpass", freq: 1600 }, q: 1.6, sweep: 240 })
  },
  nitro: () => {
    ;[392, 523, 659, 784, 1046].forEach((f, i) => stab(f, i * 0.11, 0.5, { gain: 0.13, type: "square", air: i ? null : 3000 }))
    noise(0, 0.5, 0.075, { filter: { type: "bandpass", freq: 480 }, q: 2, sweep: 5200 })
    thud(0.44, { gain: 0.16, freq: 82 })
  },
  /** A riser and a chord landing on top of it. The board arriving, not appearing. */
  boardOpen: () => {
    noise(0, 0.75, 0.11, { filter: { type: "bandpass", freq: 260 }, q: 2.4, sweep: 4200 })
    ;[262, 392, 523].forEach((f) => stab(f, 0.62, 0.6, { gain: 0.12, type: "triangle", air: null }))
    thud(0.62, { gain: 0.14, freq: 70 })
  },
  roundStart: () => {
    noise(0, 0.5, 0.09, { filter: { type: "bandpass", freq: 340 }, q: 2.4, sweep: 3800 })
    ;[330, 440, 659].forEach((f) => stab(f, 0.4, 0.44, { gain: 0.11, type: "triangle", air: null }))
  },
  /** The only one that falls. Everything about the final is downward. */
  finalOpen: () => {
    thud(0, { gain: 0.3, freq: 55 })
    tone(110, 0, 3, { type: "sine", gain: 0.2 })
    tone(146, 0.05, 1.4, { type: "sawtooth", gain: 0.07, sweep: 138 })
    noise(0, 1.6, 0.07, { filter: { type: "bandpass", freq: 2600 }, q: 1.4, sweep: 180 })
  },
}

/**
 * V3 — the same set, tightened.
 *
 * Everything is shorter, brighter and further forward. Where V2 lets a cue
 * ring, this one cuts it off; where V2 sits a note at 523, this sits it an
 * octave's worth of attention higher and takes the sub away. The result reads
 * as a modern broadcast package — quick, clean, slightly clinical.
 *
 * It exists because the right length for a cue depends on the room. In a
 * living room V2's tails are warmth; in a hall with any reverb at all they
 * smear into the next thing that happens, and a host talking over a cue that
 * is still going will turn it down until it may as well not be there.
 *
 * One thing is *not* shortened: the wrong-answer pair. That cue's whole
 * identity is 140 against 147 beating seven times a second, and a beat needs
 * time to happen — cut it to a fifth of a second and it stops being a buzzer
 * and becomes a click.
 */
export const V3 = {
  select: () => stab(880, 0, 0.06, { gain: 0.15, type: "triangle", air: 4000 }),
  buzz: () => {
    thud(0, { gain: 0.18, freq: 88 })
    stab(220, 0, 0.18, { gain: 0.2, type: "square", air: 3200 })
    stab(330, 0.015, 0.14, { gain: 0.1, type: "square", air: null })
    noise(0, 0.14, 0.07, { filter: { type: "bandpass", freq: 3400 }, q: 1.8, sweep: 900 })
  },
  reject: () => {
    tone(190, 0, 0.11, { type: "sawtooth", gain: 0.15, sweep: 95 })
    noise(0, 0.1, 0.05, { filter: { type: "bandpass", freq: 1800 }, q: 2, sweep: 500 })
  },
  arm: () => stab(1318, 0, 0.06, { gain: 0.12, type: "sine", air: 5000 }),
  tick: () => tone(1600, 0, 0.022, { type: "sine", gain: 0.09 }),
  clueClose: () => {
    stab(660, 0, 0.09, { gain: 0.09, type: "sine", sweep: 420, air: null })
    noise(0, 0.12, 0.05, { filter: { type: "bandpass", freq: 2600 }, q: 2, sweep: 700 })
  },
  reveal: () => {
    stab(659, 0, 0.22, { gain: 0.17, type: "triangle", air: 3800 })
    tone(988, 0.03, 0.16, { type: "triangle", gain: 0.07 })
  },
  undo: () => stab(880, 0, 0.1, { gain: 0.1, type: "sine", sweep: 560, air: null }),
  join: () => {
    stab(1046, 0, 0.05, { gain: 0.1, type: "sine", air: 4400 })
    stab(1568, 0.05, 0.09, { gain: 0.09, type: "sine", air: null })
  },
  timeUp: () => {
    stab(523, 0, 0.08, { gain: 0.18, type: "square", air: 3400 })
    stab(523, 0.12, 0.08, { gain: 0.18, type: "square", air: 3400 })
    stab(392, 0.24, 0.26, { gain: 0.19, type: "square", air: 3000 })
  },
  lifeline: () => {
    stab(1046, 0, 0.07, { gain: 0.15, type: "sine", air: 4400 })
    stab(784, 0.08, 0.07, { gain: 0.15, type: "sine", air: null })
    stab(1046, 0.16, 0.14, { gain: 0.15, type: "sine", air: null })
  },
  pause: () => {
    stab(659, 0, 0.09, { gain: 0.13, type: "sine", air: 3400 })
    stab(494, 0.09, 0.18, { gain: 0.13, type: "sine", air: null })
  },
  resume: () => {
    stab(494, 0, 0.08, { gain: 0.13, type: "sine", air: 3400 })
    stab(659, 0.08, 0.16, { gain: 0.13, type: "sine", air: null })
  },
  wagerLock: () => {
    stab(523, 0, 0.07, { gain: 0.13, type: "square", air: 3000 })
    stab(659, 0.07, 0.13, { gain: 0.13, type: "square", air: null })
  },
  correct: () => {
    stab(1046, 0, 0.08, { gain: 0.17, type: "triangle", air: 4200 })
    stab(1318, 0.07, 0.09, { gain: 0.17, type: "triangle", air: null })
    stab(1568, 0.14, 0.2, { gain: 0.14, type: "triangle", air: null })
    noise(0, 0.2, 0.045, { filter: { type: "bandpass", freq: 1200 }, q: 2.4, sweep: 6000 })
  },
  /** Not shortened. See the note above — the beat is the cue. */
  wrong: () => {
    thud(0, { gain: 0.16, freq: 78 })
    tone(140, 0, 0.55, { type: "square", gain: 0.19 })
    tone(147, 0, 0.55, { type: "square", gain: 0.15 })
    noise(0, 0.16, 0.05, { filter: { type: "bandpass", freq: 2400 }, q: 1.8, sweep: 500 })
  },
  nitro: () => {
    ;[523, 659, 784, 1046, 1318].forEach((f, i) => stab(f, i * 0.07, 0.24, { gain: 0.12, type: "square", air: i ? null : 4000 }))
    noise(0, 0.34, 0.065, { filter: { type: "bandpass", freq: 900 }, q: 2.2, sweep: 6500 })
  },
  boardOpen: () => {
    noise(0, 0.42, 0.09, { filter: { type: "bandpass", freq: 500 }, q: 2.6, sweep: 5200 })
    ;[523, 784, 1046].forEach((f) => stab(f, 0.34, 0.3, { gain: 0.1, type: "triangle", air: null }))
  },
  roundStart: () => {
    noise(0, 0.3, 0.08, { filter: { type: "bandpass", freq: 620 }, q: 2.6, sweep: 4800 })
    ;[659, 880, 1318].forEach((f) => stab(f, 0.24, 0.24, { gain: 0.095, type: "triangle", air: null }))
  },
  finalOpen: () => {
    thud(0, { gain: 0.24, freq: 62 })
    tone(147, 0, 1.6, { type: "sine", gain: 0.17 })
    tone(196, 0.04, 0.8, { type: "sawtooth", gain: 0.06, sweep: 185 })
    noise(0, 0.9, 0.06, { filter: { type: "bandpass", freq: 3000 }, q: 1.6, sweep: 300 })
  },
}

/**
 * V4 — the same set, warmed.
 *
 * The opposite trade to V3. Longer tails, more weight underneath, sine and
 * triangle where the others use square, and softer onsets. It is the version
 * for a living room and a television rather than a hall and a PA: nothing here
 * is trying to cut through a crowd, so nothing here is harsh.
 *
 * The risk it takes on purpose is *slowness* — these cues occupy more time,
 * and in a fast round played over a big board that will feel like the game
 * waiting for the sound. That is the trade, stated rather than hidden: pick
 * this one if the room is small and the pace is conversation.
 */
export const V4 = {
  select: () => stab(523, 0, 0.16, { gain: 0.15, type: "sine", air: 2200 }),
  buzz: () => {
    thud(0, { gain: 0.3, freq: 62 })
    stab(147, 0, 0.44, { gain: 0.19, type: "triangle", air: 1800 })
    stab(220, 0.03, 0.36, { gain: 0.11, type: "triangle", air: null })
  },
  reject: () => {
    thud(0, { gain: 0.14, freq: 92 })
    tone(130, 0, 0.28, { type: "triangle", gain: 0.15, sweep: 62 })
  },
  arm: () => stab(880, 0, 0.18, { gain: 0.12, type: "sine", air: 3000 }),
  tick: () => tone(1046, 0, 0.04, { type: "sine", gain: 0.09 }),
  clueClose: () => stab(440, 0, 0.3, { gain: 0.1, type: "sine", sweep: 262, air: 1600 }),
  reveal: () => {
    stab(392, 0, 0.7, { gain: 0.18, type: "sine", air: 2000 })
    tone(588, 0.06, 0.52, { type: "sine", gain: 0.08 })
  },
  undo: () => stab(587, 0, 0.3, { gain: 0.11, type: "sine", sweep: 350, air: null }),
  join: () => {
    stab(659, 0, 0.14, { gain: 0.11, type: "sine", air: 2600 })
    stab(988, 0.1, 0.26, { gain: 0.1, type: "sine", air: null })
  },
  timeUp: () => {
    stab(392, 0, 0.2, { gain: 0.18, type: "triangle", air: 2000 })
    stab(392, 0.24, 0.2, { gain: 0.18, type: "triangle", air: 2000 })
    stab(262, 0.48, 0.75, { gain: 0.2, type: "triangle", air: 1600 })
    thud(0.48, { gain: 0.2, freq: 66 })
  },
  lifeline: () => {
    stab(659, 0, 0.18, { gain: 0.15, type: "sine", air: 2600 })
    stab(523, 0.18, 0.18, { gain: 0.15, type: "sine", air: null })
    stab(784, 0.36, 0.42, { gain: 0.15, type: "sine", air: null })
  },
  pause: () => {
    stab(440, 0, 0.26, { gain: 0.14, type: "sine", air: 2200 })
    stab(330, 0.2, 0.5, { gain: 0.14, type: "sine", air: null })
  },
  resume: () => {
    stab(330, 0, 0.22, { gain: 0.14, type: "sine", air: 2200 })
    stab(440, 0.17, 0.44, { gain: 0.14, type: "sine", air: null })
  },
  wagerLock: () => {
    stab(330, 0, 0.2, { gain: 0.14, type: "triangle", air: 2000 })
    stab(440, 0.16, 0.34, { gain: 0.14, type: "triangle", air: null })
  },
  correct: () => {
    stab(523, 0, 0.24, { gain: 0.17, type: "sine", air: 2600 })
    stab(659, 0.16, 0.28, { gain: 0.17, type: "sine", air: null })
    stab(880, 0.32, 0.7, { gain: 0.15, type: "sine", air: null })
  },
  wrong: () => {
    thud(0, { gain: 0.28, freq: 60 })
    tone(110, 0, 0.9, { type: "triangle", gain: 0.2 })
    tone(116, 0, 0.9, { type: "triangle", gain: 0.16 })
  },
  nitro: () => {
    ;[262, 330, 392, 523, 659].forEach((f, i) => stab(f, i * 0.14, 0.8, { gain: 0.12, type: "triangle", air: i ? null : 2400 }))
    thud(0.56, { gain: 0.18, freq: 66 })
  },
  boardOpen: () => {
    noise(0, 1.1, 0.1, { filter: { type: "bandpass", freq: 180 }, q: 2.2, sweep: 2400 })
    ;[131, 196, 262].forEach((f) => stab(f, 0.9, 1, { gain: 0.12, type: "triangle", air: null }))
    thud(0.9, { gain: 0.16, freq: 62 })
  },
  /**
   * A new round arriving.
   *
   * This used to be `boardOpen` with the numbers nudged — the same slow low
   * riser onto the same triad, a third of a second shorter. Two different
   * moments cannot share a gesture and stay legible: the board going up is the
   * night beginning and wants to be the biggest sound in the game, whereas a
   * new round is a page turning and happens two or three times.
   *
   * So this one goes *up* and resolves. The riser is half the length and twice
   * as bright, and instead of settling onto a low chord it lands on three
   * ascending notes — a turn rather than a curtain. It is also over in about a
   * second, because the host is usually already talking over it.
   */
  roundStart: () => {
    noise(0, 0.42, 0.085, { filter: { type: "bandpass", freq: 300 }, q: 2.4, sweep: 3000 })
    ;[392, 523, 784].forEach((f, i) => stab(f, 0.3 + i * 0.1, 0.42, { gain: 0.12, type: "triangle", air: i ? null : 2600 }))
    thud(0.3, { gain: 0.12, freq: 74 })
  },
  finalOpen: () => {
    thud(0, { gain: 0.32, freq: 48 })
    tone(87, 0, 4, { type: "sine", gain: 0.21 })
    tone(131, 0.08, 2.2, { type: "triangle", gain: 0.07, sweep: 124 })
    noise(0, 2.4, 0.07, { filter: { type: "bandpass", freq: 1800 }, q: 1.3, sweep: 120 })
  },
}

/**
 * The same cues, rebuilt in the app's own material.
 *
 * Everything here is a bell or a brass note rather than a raw oscillator, so
 * the game sounds like the thing it looks like: struck metal over a black
 * stage. Still synthesised, so still free of the one risk that matters — a
 * buzz-in lands with the press rather than after a decode.
 *
 * Nothing here is live: the review picked from the plain family throughout.
 * Kept rather than deleted, because the next time a cue needs rethinking the
 * expensive part is having something to compare it against.
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
 * The third take: an arcade cabinet that cost a great deal of money.
 *
 * One idea, applied everywhere — **arcade attack, gold tail**. Every cue fires
 * as a chip blip, square-edged and instant, and then decays into a struck bell.
 * The blip is the part you react to; the ring is the part that makes it sound
 * expensive rather than cheap, and it arrives late enough never to blunt the
 * attack.
 *
 * Two rules keep it from becoming a novelty:
 *
 * - **Nothing the room is punished by gets a tail.** A wrong answer and an
 *   early buzz end flat and dead, because a ring is a reward and rewarding a
 *   mistake is how a game show starts feeling sarcastic.
 * - **Frequencies are shared with the gold take**, so the two are the same game
 *   in different clothes rather than two different games — a room that switches
 *   between them should notice the material, not the tune.
 */
export const ARCADE = {
  select: () => {
    blip(880, 0, 0.045, { gain: 0.12 })
    bell(1760, 0.05, 0.3, { gain: 0.06 })
  },
  /** The one that matters: a hard descending pair, then gold. */
  buzz: () => {
    thud(0, { gain: 0.26, freq: 80 })
    blip(523, 0, 0.05, { gain: 0.17 })
    blip(392, 0.05, 0.07, { gain: 0.17 })
    bell(880, 0.09, 0.8, { gain: 0.12 })
  },
  /** Flat, ugly, no tail. Jumping the gun is not an achievement. */
  reject: () => {
    blip(200, 0, 0.13, { gain: 0.14, type: "sawtooth", to: 60 })
    thud(0.02, { gain: 0.12, freq: 110 })
  },
  arm: () => {
    blip(1318, 0, 0.035, { gain: 0.1 })
    blip(1760, 0.04, 0.05, { gain: 0.1 })
    bell(2093, 0.08, 0.35, { gain: 0.06 })
  },
  /** Fires five times in a row, so it stays a tick and never grows a tail. */
  tick: () => blip(2093, 0, 0.022, { gain: 0.07 }),
  clueClose: () => blip(660, 0, 0.09, { gain: 0.09, to: 330 }),
  undo: () => blip(784, 0, 0.09, { gain: 0.09, to: 440 }),
  /** A coin dropping. Two notes, and everyone under fifty knows what it means. */
  join: () => {
    blip(988, 0, 0.04, { gain: 0.1 })
    blip(1319, 0.04, 0.12, { gain: 0.1 })
    bell(1976, 0.1, 0.4, { gain: 0.05 })
  },
  reveal: () => {
    arp([523, 659, 784], 0, 0.05, { gain: 0.11 })
    bell(1046, 0.16, 0.9, { gain: 0.12 })
  },
  /** The power-up: a run up the chord, and gold left hanging over the top. */
  correct: () => {
    arp([523, 659, 784, 1046], 0, 0.05, { gain: 0.13 })
    bell(2093, 0.21, 1.1, { gain: 0.13 })
  },
  /** Down, not up, and it ends where it lands. */
  wrong: () => {
    thud(0, { gain: 0.26, freq: 70 })
    arp([330, 247, 185], 0, 0.075, { gain: 0.14, type: "sawtooth", hold: 1.6 })
  },
  timeUp: () => {
    blip(440, 0, 0.11, { gain: 0.16 })
    blip(440, 0.16, 0.11, { gain: 0.16 })
    blip(330, 0.32, 0.2, { gain: 0.16 })
    bell(330, 0.36, 1.4, { gain: 0.13 })
  },
  lifeline: () => {
    arp([880, 660, 880, 1318], 0, 0.06, { gain: 0.11 })
    bell(1318, 0.26, 0.9, { gain: 0.1 })
  },
  wagerLock: () => {
    blip(392, 0, 0.06, { gain: 0.13 })
    blip(523, 0.07, 0.1, { gain: 0.13 })
    bell(1046, 0.13, 0.5, { gain: 0.07 })
  },
  pause: () => {
    blip(523, 0, 0.06, { gain: 0.11 })
    blip(392, 0.07, 0.11, { gain: 0.11 })
  },
  resume: () => {
    blip(392, 0, 0.06, { gain: 0.11 })
    blip(523, 0.07, 0.11, { gain: 0.11 })
  },
  /** The 1-up: the longest run here, and the only one that earns it. */
  nitro: () => {
    arp([392, 523, 659, 784, 1046, 1318], 0, 0.055, { gain: 0.14 })
    brass(784, 0.33, 0.4, { gain: 0.13 })
    bell(1568, 0.38, 1.8, { gain: 0.15 })
  },
  boardOpen: () => {
    arp([262, 330, 392, 523], 0, 0.06, { gain: 0.12 })
    bell(1046, 0.26, 1.5, { gain: 0.13 })
  },
  roundStart: () => {
    arp([330, 440, 659], 0, 0.055, { gain: 0.11 })
    bell(1318, 0.18, 1.1, { gain: 0.11 })
  },
  /**
   * Into the final. The one cue that inverts the rule.
   *
   * Everything else is a bright blip over a gold tail; this is a low square
   * drone *under* a struck bell, because the final is the moment the cabinet
   * stops being fun and the room goes quiet.
   */
  finalOpen: () => {
    thud(0, { gain: 0.3, freq: 60 })
    blip(110, 0, 0.5, { gain: 0.1, type: "sawtooth", to: 82 })
    bell(110, 0.06, 3.2, { gain: 0.19 })
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

/** Every take, by the name `CHOSEN` uses. `current` needs no table. */
export const TAKES = { current: PLAIN, v2: V2, v3: V3, v4: V4, gold: ALT, arcade: ARCADE }

/**
 * The two cues no take may claim.
 *
 * A round ending and a game ending are a *crowd*, and a crowd is the one sound
 * on this list that synthesis genuinely cannot do — filtered noise is static
 * with ambitions, and it will still be static after it has been gilded or
 * bit-crushed. So these stay on the sample layer whichever take is chosen: when
 * real applause is finally dropped into `public/sfx/`, every take gets it.
 *
 * Everything else is fair game. A "ta-da" or a wrong-answer buzzer is a
 * *sound*, not a room full of people, and a take is entitled to its own.
 */
export const CROWD = ["roundEnd", "gameOver"]

/**
 * Fold the chosen cues into `sfx`, once, here.
 *
 * Resolving per call site would mean every component knowing about takes; this
 * way `sfx.buzz()` stays `sfx.buzz()` everywhere in the app and there is one
 * place to look when a cue sounds wrong.
 *
 * A name that matches no take is skipped rather than allowed to blank a cue —
 * a typo in `CHOSEN` should cost you the choice, not the sound.
 */
for (const [id, take] of Object.entries(CHOSEN)) {
  const cue = TAKES[FORCE_TAKE ?? take]?.[id]
  if (cue) sfx[id] = cue
}

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
