/**
 * A room's own look, applied at runtime.
 *
 * Everything the design is made of is already a CSS custom property — Tailwind's
 * `@theme` block in `global.css` declares `--color-gold`, `--font-display` and
 * the rest, and every utility resolves through them. So theming a room is not a
 * second stylesheet or a class on the body: it is *overriding those same
 * properties on `:root`*, and the entire app follows without knowing it happened.
 *
 * A theme is a diff. Absent means "house default", and removing a property is
 * how a reset works — so a room that changed one colour is not frozen against
 * the rest of the design, and keeps moving when the defaults do.
 */

/** The house palette, mirrored from `@theme` so the editor has something to show. */
export const DEFAULT_COLORS = {
  void: "#07060a",
  onyx: "#101017",
  royal: "#241038",
  violet: "#6a2fa6",
  amethyst: "#a86ce0",
  gold: "#f2c96b",
  "gold-deep": "#c9922a",
  "gold-dim": "#7a5c1c",
  ink: "#f5f0e4",
  muted: "#a09786",
  faint: "#6e675c",
  good: "#4fd6a0",
  bad: "#ff5f7a",
  live: "#ffcf3d",
  panel: "#0c0b11",
  "panel-2": "#15141d",
  edge: "#2b2733",
}

/**
 * Grouped for the editor, because seventeen colour wells in a column is a
 * paint chart rather than a control.
 */
export const COLOR_GROUPS = [
  {
    title: "Metal",
    hint: "the gold everything is lettered and lit in",
    keys: ["gold", "gold-deep", "gold-dim"],
  },
  {
    title: "Stage",
    hint: "the black the whole show sits on",
    keys: ["void", "onyx", "royal", "panel", "panel-2", "edge"],
  },
  {
    title: "Type",
    hint: "text, from loud to barely there",
    keys: ["ink", "muted", "faint"],
  },
  {
    title: "Signals",
    hint: "right, wrong, and whoever is buzzed in",
    keys: ["good", "bad", "live", "violet", "amethyst"],
  },
]

export const COLOR_LABELS = {
  void: "Backdrop",
  onyx: "Panels behind",
  royal: "Royal purple",
  violet: "Violet",
  amethyst: "Amethyst",
  gold: "Gold",
  "gold-deep": "Deep gold",
  "gold-dim": "Dim gold",
  ink: "Text",
  muted: "Muted text",
  faint: "Faint text",
  good: "Correct",
  bad: "Wrong",
  live: "Buzzed in",
  panel: "Panel",
  "panel-2": "Panel, raised",
  edge: "Edges",
}

/** The house faces, plus a shortlist that suits a game show. */
export const FONT_SLOTS = [
  { id: "display", label: "Headings", hint: "the wordmark, categories, clue text", fallback: "ui-sans-serif, system-ui, sans-serif" },
  { id: "value", label: "Numbers", hint: "scores and tile values — wants to be condensed", fallback: "'Arial Narrow', ui-sans-serif, sans-serif" },
  { id: "body", label: "Body", hint: "everything else", fallback: "ui-sans-serif, system-ui, sans-serif" },
]

export const DEFAULT_FONTS = { display: "Righteous", value: "Anton", body: "Space Grotesk" }

/**
 * Hosted families offered in the picker. Loaded on demand — the page already
 * pulls its three defaults from the same place, so this adds a request rather
 * than a dependency.
 */
export const FONT_CHOICES = {
  display: ["Righteous", "Bebas Neue", "Bungee", "Staatliches", "Archivo Black", "Orbitron", "Russo One", "Cinzel", "Playfair Display"],
  value: ["Anton", "Bebas Neue", "Teko", "Oswald", "Archivo Black", "Rubik Mono One"],
  body: ["Space Grotesk", "Inter", "Rubik", "Barlow", "Source Sans 3", "Lato"],
}

// ── Working with colours ─────────────────────────────────────────────────────

/**
 * Accept a hex the way a person types one.
 *
 * The native colour well is fine for *choosing* a colour and useless for
 * *entering* one — a host with a brand hex on a sticky note cannot drag a
 * gradient to `#0d3b66`. So the field takes text, and takes it loosely: with or
 * without the hash, three digits or six or eight, any case. Anything it cannot
 * read comes back null and the caller leaves the colour alone rather than
 * blanking it half way through a keystroke.
 */
export function normaliseHex(input) {
  if (typeof input !== "string") return null
  const raw = input.trim().replace(/^#/, "").toLowerCase()
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(raw)) return null
  // Expand shorthand, so what is stored is always what a picker can show.
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  return `#${full}`
}

const toRgb = (hex) => {
  const h = normaliseHex(hex) ?? "#000000"
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
}

const toHex = (rgb) => `#${rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`

/**
 * Move a colour towards black or white, keeping its hue.
 *
 * Mixing towards the endpoint rather than scaling the channels: scaling turns
 * a dark colour black and leaves a light one nearly unchanged, which is exactly
 * wrong for deriving a set of shades that have to look related.
 */
export function shade(hex, amount) {
  const target = amount < 0 ? 0 : 255
  const k = Math.abs(amount)
  return toHex(toRgb(hex).map((c) => c + (target - c) * k))
}

/**
 * Three metals from one.
 *
 * Gold, deep gold and dim gold have to read as the same material under
 * different light — picking them separately is fiddly and usually ends up with
 * three unrelated yellows. One colour and two darkenings is what the house
 * palette is, so it is what the shortcut does.
 */
export function metalFrom(hex) {
  const base = normaliseHex(hex)
  if (!base) return null
  return { gold: base, "gold-deep": shade(base, -0.28), "gold-dim": shade(base, -0.58) }
}

/**
 * Whole looks, as a starting point.
 *
 * Each is a *diff* like any other theme — it names the metal, the purple the
 * stage is lit with, and the buzzed-in colour, and leaves everything else to
 * the defaults. So picking one and then changing a single colour behaves
 * exactly the same as changing a single colour from scratch.
 */
export const PALETTES = [
  { id: "house", name: "Black marble & gold", metal: "#f2c96b", royal: "#241038", live: "#ffcf3d" },
  { id: "emerald", name: "Emerald", metal: "#5fd6a4", royal: "#0d2b22", live: "#7dffcb" },
  { id: "ruby", name: "Ruby", metal: "#ff8a8a", royal: "#3a0d18", live: "#ff6b8a" },
  { id: "ice", name: "Ice", metal: "#a8d8ff", royal: "#0e2338", live: "#9fe8ff" },
  { id: "sunset", name: "Sunset", metal: "#ff9f5a", royal: "#2e1030", live: "#ffc46b" },
  { id: "chrome", name: "Chrome", metal: "#dfe3ea", royal: "#1a1c22", live: "#ffffff" },
  { id: "neon", name: "Neon", metal: "#d98cff", royal: "#160b2e", live: "#61f5ff" },
]

/** The colours a palette sets, ready to merge over whatever is already there. */
export function paletteColors(palette) {
  return { ...metalFrom(palette.metal), royal: palette.royal, live: palette.live }
}

const STYLE_ID = "noggin-theme"
const LINK_ID = "noggin-theme-fonts"

/**
 * Push a theme onto the document, or clear it.
 *
 * Idempotent and safe to call on every state broadcast: it writes the
 * properties a theme names and *removes* the ones it doesn't, so switching
 * rooms or resetting cannot leave a stale colour behind.
 */
export function applyTheme(theme) {
  if (typeof document === "undefined") return
  const root = document.documentElement

  for (const key of Object.keys(DEFAULT_COLORS)) {
    const value = theme?.colors?.[key]
    if (value) root.style.setProperty(`--color-${key}`, value)
    else root.style.removeProperty(`--color-${key}`)
  }

  // The backdrop is painted on <body> in places, and the browser chrome takes
  // its colour from a meta tag — both want to follow the room.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", theme?.colors?.void ?? "#07060a")

  applyFonts(theme?.fonts)
}

function applyFonts(fonts) {
  const root = document.documentElement
  const families = []
  const faces = []

  for (const slot of FONT_SLOTS) {
    const font = fonts?.[slot.id]
    if (!font?.name) {
      root.style.removeProperty(`--font-${slot.id}`)
      continue
    }
    root.style.setProperty(`--font-${slot.id}`, `"${font.name}", ${slot.fallback}`)
    if (font.google) families.push(font.name)
    // An uploaded file needs a face declared for it; a hosted family does not.
    else if (font.url) faces.push(`@font-face{font-family:"${font.name}";src:url("${font.url}");font-display:swap}`)
  }

  // One <link> for however many hosted families are in play, rebuilt each time
  // rather than accumulated — otherwise every edit leaves another stylesheet.
  let link = document.getElementById(LINK_ID)
  if (families.length) {
    if (!link) {
      link = document.createElement("link")
      link.id = LINK_ID
      link.rel = "stylesheet"
      document.head.appendChild(link)
    }
    const q = families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&")
    const href = `https://fonts.googleapis.com/css2?${q}&display=swap`
    if (link.href !== href) link.href = href
  } else if (link) {
    link.remove()
  }

  let style = document.getElementById(STYLE_ID)
  if (faces.length) {
    if (!style) {
      style = document.createElement("style")
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = faces.join("\n")
  } else if (style) {
    style.remove()
  }
}

/** True when a theme actually changes anything. */
export const themeIsSet = (theme) =>
  !!theme && (Object.keys(theme.colors ?? {}).length > 0 || Object.keys(theme.fonts ?? {}).length > 0 || Object.keys(theme.sounds ?? {}).length > 0)

/** Drop empty branches, so an emptied editor sends `null` rather than `{}`. */
export function tidyTheme(theme) {
  const out = {}
  if (Object.keys(theme?.colors ?? {}).length) out.colors = theme.colors
  if (Object.keys(theme?.fonts ?? {}).length) out.fonts = theme.fonts
  if (Object.keys(theme?.sounds ?? {}).length) out.sounds = theme.sounds
  return Object.keys(out).length ? out : null
}
