import { resolveMediaUrl } from "./mediaUrl"

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

export const isUnlocked = () => !!ctx && ctx.state === "running"

// ── Samples ──────────────────────────────────────────────────────────────────

/** Where the bundled files live. Same origin, so no CORS to think about. */
const SFX_BASE = "/sfx"

/**
 * A room's own sounds, from its theme.
 *
 * These win over the bundled set and work even with `SAMPLES_ENABLED` off —
 * that flag is about whether *defaults* ship, and a room that has uploaded its
 * own applause has plainly chosen. Keyed by cue id; anything not overridden
 * falls through to the bundled file and then to the synthesised stand-in.
 */
let overrides = {}

export function setSoundOverrides(map) {
  const next = map ?? {}
  // Drop the decoded buffer for anything whose URL changed, or the old sound
  // keeps playing after the host has replaced it.
  for (const [id, url] of Object.entries({ ...overrides, ...next })) {
    if (overrides[id] !== next[id]) {
      buffers.delete(`@${id}`)
      loading.delete(`@${id}`)
      missing.delete(`@${id}`)
    }
    void url
  }
  overrides = next
}

export const hasCustomSounds = () => Object.keys(overrides).length > 0

const buffers = new Map()
const loading = new Map()
/** Files we have already failed to find — don't ask again on every press. */
const missing = new Set()

/**
 * Where a cue's audio comes from, and what to file it under.
 *
 * A room's own upload is cached separately from the bundled file (`@applause`
 * vs `applause`) so switching rooms — or clearing an override — falls straight
 * back to the default without a re-fetch.
 */
function sourceFor(id) {
  const custom = overrides[id]
  if (custom) return { key: `@${id}`, url: resolveMediaUrl(custom) }
  return SAMPLES_ENABLED ? { key: id, url: `${SFX_BASE}/${id}.mp3` } : null
}

function load(id) {
  const src = sourceFor(id)
  if (!ctx || !src || missing.has(src.key)) return Promise.reject(new Error(id))
  if (buffers.has(src.key)) return Promise.resolve(buffers.get(src.key))
  if (loading.has(src.key)) return loading.get(src.key)

  const job = fetch(src.url)
    .then((res) => {
      if (!res.ok) throw new Error(`${id}: ${res.status}`)
      return res.arrayBuffer()
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buf) => {
      buffers.set(src.key, buf)
      loading.delete(src.key)
      return buf
    })
    .catch((err) => {
      // A missing or undecodable file is not an error worth breaking a quiz
      // over. Remember it and let the synth take over.
      missing.add(src.key)
      loading.delete(src.key)
      throw err
    })

  loading.set(src.key, job)
  return job
}

/** Everything except the bed, which is a megabyte and can wait for its cue. */
function preload() {
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
  const src = sourceFor(id)
  // Nothing chosen for this cue: the stand-in *is* the sound, and asking for a
  // file that is not there would be a 404 per cue per page.
  if (!src) return fallback?.()
  const warm = buffers.get(src.key)
  if (warm) return playBuffer(warm, opts)
  if (missing.has(src.key)) return fallback?.()
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
    // No bed until one is bundled or the room uploads its own.
    if (!SAMPLES_ENABLED && !overrides.music) return
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
