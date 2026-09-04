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
