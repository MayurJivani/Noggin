/**
 * Board helpers shared by the builder and the control desk.
 *
 * The shapes here mirror `server/game.js` exactly — the relay re-normalises
 * anything it is sent, so this side can stay optimistic and fast to type into.
 */

let seq = 0
const uid = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const DEFAULT_VALUES = [200, 400, 600, 800, 1000]

/**
 * Mirrors `DEFAULTS` in server/game.js. The builder renders before the room's
 * first snapshot arrives, and a rules field that starts life as `undefined`
 * turns a controlled input into an uncontrolled one for the first few frames.
 */
export const DEFAULT_SETTINGS = {
  earlyPenaltyMs: 500,
  answerSeconds: 8,
  autoArm: false,
  readSeconds: 0,
  lifelines: { phone: 1 },
  penaltyForWrong: true,
  teams: false,
  mirrorClue: true,
  pingCorrection: false,
}

export const makeClue = (value = 200) => ({
  id: uid("c"),
  value,
  prompt: "",
  media: null,
  answer: "",
  answerMedia: null,
  nitro: false,
  status: "open",
})

export const makeCategory = (title = "", values = DEFAULT_VALUES) => ({
  id: uid("cat"),
  title,
  clues: values.map(makeClue),
})

export const makeRound = (name, values = DEFAULT_VALUES, categories = 5) => ({
  id: uid("r"),
  name,
  values,
  categories: Array.from({ length: categories }, () => makeCategory("", values)),
})

export const makeBoard = () => ({
  id: uid("b"),
  title: "Untitled Game",
  updatedAt: Date.now(),
  rounds: [makeRound("Round 1", DEFAULT_VALUES), makeRound("Round 2", DEFAULT_VALUES.map((v) => v * 2))],
})

/** Re-price a round's tiles after its value ladder changes. */
export function applyValues(round, values) {
  return {
    ...round,
    values,
    categories: round.categories.map((cat) => ({
      ...cat,
      clues: cat.clues.map((clue, i) => ({ ...clue, value: values[i] ?? clue.value })),
    })),
  }
}

/** Add or remove rows so every category matches the value ladder's length. */
export function resizeRound(round, rows) {
  const values = Array.from({ length: rows }, (_, i) => round.values[i] ?? (round.values.at(-1) ?? 200) + 200 * (i - round.values.length + 1))
  return {
    ...round,
    values,
    categories: round.categories.map((cat) => ({
      ...cat,
      clues: Array.from({ length: rows }, (_, i) => cat.clues[i] ?? makeClue(values[i])),
    })),
  }
}

/**
 * What's stopping this board from being playable. The builder shows these as
 * warnings rather than blocking — a half-written board is a perfectly normal
 * thing to have on screen at 11pm the night before.
 */
export function boardIssues(board) {
  const issues = []
  board.rounds.forEach((round, ri) => {
    const label = round.name || `Round ${ri + 1}`
    round.categories.forEach((cat, ci) => {
      if (!cat.title.trim()) issues.push({ level: "warn", where: `${label} · category ${ci + 1}`, message: "No category title." })
      cat.clues.forEach((clue, qi) => {
        const at = `${label} · ${cat.title || `category ${ci + 1}`} · ${clue.value}`
        const hasPrompt = clue.prompt.trim() || clue.media
        if (!hasPrompt) issues.push({ level: "warn", where: at, message: "Empty clue — it will still show on the board." })
        else if (!clue.answer.trim()) issues.push({ level: "warn", where: at, message: "No answer recorded." })
        void qi
      })
    })
    const hot = round.categories.flatMap((c) => c.clues.filter((cl) => cl.nitro))
    if (hot.length > 2) issues.push({ level: "warn", where: label, message: `${hot.length} Nitro tiles in one round.` })
  })
  return issues
}

export function boardStats(board) {
  let clues = 0
  let filled = 0
  let media = 0
  let nitros = 0
  for (const round of board.rounds) {
    for (const cat of round.categories) {
      for (const clue of cat.clues) {
        clues++
        if (clue.prompt.trim() || clue.media) filled++
        if (clue.media) media++
        if (clue.nitro) nitros++
      }
    }
  }
  return { clues, filled, media, nitros, rounds: board.rounds.length }
}

/** Immutably replace one clue. Used by every editor control in the builder. */
export function patchClue(board, roundIndex, catIndex, clueIndex, patch) {
  return {
    ...board,
    rounds: board.rounds.map((round, ri) =>
      ri !== roundIndex
        ? round
        : {
            ...round,
            categories: round.categories.map((cat, ci) =>
              ci !== catIndex
                ? cat
                : { ...cat, clues: cat.clues.map((clue, qi) => (qi === clueIndex ? { ...clue, ...patch } : clue)) },
            ),
          },
    ),
  }
}

export function patchCategory(board, roundIndex, catIndex, patch) {
  return {
    ...board,
    rounds: board.rounds.map((round, ri) =>
      ri !== roundIndex
        ? round
        : { ...round, categories: round.categories.map((cat, ci) => (ci === catIndex ? { ...cat, ...patch } : cat)) },
    ),
  }
}

export function patchRound(board, roundIndex, patch) {
  return {
    ...board,
    rounds: board.rounds.map((round, ri) => (ri === roundIndex ? { ...round, ...patch } : round)),
  }
}

/** Scatter Nitro tiles the way the show does — never on the cheapest row. */
export function scatterNitro(round, count = 1) {
  const cleared = {
    ...round,
    categories: round.categories.map((c) => ({ ...c, clues: c.clues.map((cl) => ({ ...cl, nitro: false })) })),
  }
  const slots = []
  cleared.categories.forEach((cat, ci) => cat.clues.forEach((_, qi) => qi > 0 && slots.push([ci, qi])))
  for (let i = 0; i < Math.min(count, slots.length); i++) {
    const [ci, qi] = slots.splice(Math.floor(Math.random() * slots.length), 1)[0]
    cleared.categories[ci] = {
      ...cleared.categories[ci],
      clues: cleared.categories[ci].clues.map((cl, j) => (j === qi ? { ...cl, nitro: true } : cl)),
    }
  }
  return cleared
}

/**
 * A copy, with fresh ids all the way down.
 *
 * Next month's quiz usually starts as last month's skeleton — same categories,
 * same ladder, new clues. Reusing the ids would make the copy and the original
 * the same record as far as storage is concerned, and saving one would quietly
 * overwrite the other.
 */
export function duplicateBoard(board) {
  return {
    ...board,
    id: uid("b"),
    title: `${board.title} (copy)`,
    updatedAt: Date.now(),
    rounds: board.rounds.map((round) => ({
      ...round,
      id: uid("r"),
      categories: round.categories.map((cat) => ({
        ...cat,
        id: uid("cat"),
        clues: cat.clues.map((clue) => ({ ...clue, id: uid("c"), status: "open" })),
      })),
    })),
  }
}

export const downloadBoard = (board) => {
  const blob = new Blob([JSON.stringify(board, null, 2)], { type: "application/json" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${(board.title || "board").replace(/[^\w-]+/g, "-").toLowerCase()}.noggin.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── Spreadsheet import ───────────────────────────────────────────────────────

/**
 * Split a delimited line, honouring quotes.
 *
 * Clue text is prose, and prose contains commas — a naive `split(",")` turns
 * one good question into three broken columns, which is exactly the failure a
 * host would not notice until showtime.
 */
function splitRow(line, sep) {
  const out = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** Tabs win if there are any — a paste out of a spreadsheet is tab-separated. */
const sniffSeparator = (text) => (text.includes("\t") ? "\t" : ",")

const TRUTHY = new Set(["1", "y", "yes", "true", "dd", "daily", "x", "✓"])

/**
 * Build a board from CSV or TSV.
 *
 * One clue per row: `category, value, clue, answer, nitro?`. Categories
 * become columns in the order they first appear and values become rows sorted
 * low to high, which is how people lay a quiz out in a spreadsheet anyway.
 *
 * Deliberately forgiving. A header row is optional, a missing answer is a
 * warning rather than a rejection, and ragged rows are reported by line number
 * instead of failing the whole file — someone importing forty clues at 11pm
 * wants to be told which two are wrong, not handed one error.
 *
 * @returns {{ board: object|null, issues: string[] }}
 */
export function parseBoardCsv(text, title = "Imported Game") {
  const issues = []
  const sep = sniffSeparator(text)
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim())

  if (!lines.length) return { board: null, issues: ["The file is empty."] }

  const first = splitRow(lines[0], sep).map((c) => c.toLowerCase())
  const hasHeader = first[0] === "category" || (first.includes("category") && first.includes("answer"))
  const rows = hasHeader ? lines.slice(1) : lines

  /** Column order matters, so categories are collected in a Map. */
  const byCategory = new Map()
  const values = new Set()

  rows.forEach((line, i) => {
    const lineNo = i + (hasHeader ? 2 : 1)
    const cells = splitRow(line, sep)
    const [category, rawValue, prompt, answer, daily] = cells

    if (cells.length < 3 || !category) {
      issues.push(`Line ${lineNo}: need at least category, value and clue.`)
      return
    }
    const value = Math.trunc(Number(String(rawValue).replace(/[^0-9.-]/g, "")))
    if (!Number.isFinite(value) || value === 0) {
      issues.push(`Line ${lineNo}: "${rawValue}" is not a points value.`)
      return
    }
    if (!answer?.trim()) issues.push(`Line ${lineNo}: no answer for "${(prompt ?? "").slice(0, 30)}".`)

    values.add(value)
    if (!byCategory.has(category)) byCategory.set(category, new Map())
    const cat = byCategory.get(category)
    if (cat.has(value)) issues.push(`Line ${lineNo}: ${category} already has a ${value}.`)
    cat.set(value, {
      ...makeClue(value),
      prompt: prompt ?? "",
      answer: answer ?? "",
      nitro: TRUTHY.has(String(daily ?? "").trim().toLowerCase()),
    })
  })

  if (!byCategory.size) return { board: null, issues: issues.length ? issues : ["No clues found."] }

  const ladder = [...values].sort((a, b) => a - b)
  const categories = [...byCategory.entries()].map(([name, clues]) => ({
    ...makeCategory(name, ladder),
    // A gap in the grid is a real thing to have — an empty tile is better than
    // a shifted one, which would silently mislabel every clue below it.
    clues: ladder.map((v) => clues.get(v) ?? makeClue(v)),
  }))

  return {
    board: { ...makeBoard(), title, rounds: [{ ...makeRound("Round 1", ladder, 0), categories }] },
    issues,
  }
}
