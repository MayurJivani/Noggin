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
  readSeconds: 0,
  lifelines: { phone: 1 },
  penaltyForWrong: true,
}

export const makeClue = (value = 200) => ({
  id: uid("c"),
  value,
  prompt: "",
  media: null,
  answer: "",
  answerMedia: null,
  dailyDouble: false,
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
    const dds = round.categories.flatMap((c) => c.clues.filter((cl) => cl.dailyDouble))
    if (dds.length > 2) issues.push({ level: "warn", where: label, message: `${dds.length} daily doubles in one round.` })
  })
  return issues
}

export function boardStats(board) {
  let clues = 0
  let filled = 0
  let media = 0
  let dailyDoubles = 0
  for (const round of board.rounds) {
    for (const cat of round.categories) {
      for (const clue of cat.clues) {
        clues++
        if (clue.prompt.trim() || clue.media) filled++
        if (clue.media) media++
        if (clue.dailyDouble) dailyDoubles++
      }
    }
  }
  return { clues, filled, media, dailyDoubles, rounds: board.rounds.length }
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

/** Scatter daily doubles the way the show does — never on the cheapest row. */
export function sprinkleDailyDoubles(round, count = 1) {
  const cleared = {
    ...round,
    categories: round.categories.map((c) => ({ ...c, clues: c.clues.map((cl) => ({ ...cl, dailyDouble: false })) })),
  }
  const slots = []
  cleared.categories.forEach((cat, ci) => cat.clues.forEach((_, qi) => qi > 0 && slots.push([ci, qi])))
  for (let i = 0; i < Math.min(count, slots.length); i++) {
    const [ci, qi] = slots.splice(Math.floor(Math.random() * slots.length), 1)[0]
    cleared.categories[ci] = {
      ...cleared.categories[ci],
      clues: cleared.categories[ci].clues.map((cl, j) => (j === qi ? { ...cl, dailyDouble: true } : cl)),
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
