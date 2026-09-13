/**
 * Rendering a component in a test, without a browser or a framework.
 *
 * Four bugs escaped this project's suite in one sitting and were all caught by
 * hand afterwards: a wager selection wiped by an effect dependency, a clue
 * panel that vanished when its text was withheld, a tie-break editor showing an
 * empty box over a written question, and a buzzer order list on the wrong
 * screen. None were engine bugs, so none were catchable where the tests lived.
 *
 * `renderToStaticMarkup` is enough for all four. It runs the component body and
 * every `useMemo`/`useState` initialiser, which is where those bugs lived — it
 * does not run effects, and this deliberately does not pretend to. A component
 * whose bug is only reachable through an effect needs its logic lifted out to
 * somewhere testable, which is the better fix anyway.
 *
 * No jsdom: the point is to assert on what a component *renders*, and a string
 * of HTML answers that without a DOM implementation to keep in step.
 */
import { renderToStaticMarkup } from "react-dom/server"
/** Render to HTML. Throws exactly as React would, which is usually the point. */
export function render(element) {
  return renderToStaticMarkup(element)
}

/** Visible text, with tags stripped and whitespace collapsed. */
export function text(element) {
  return render(element)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim()
}

/** Whether the rendered output contains a string, ignoring runs of whitespace. */
export const shows = (element, needle) => text(element).includes(needle)

/**
 * Every `value` on a `<select>`, in order, so a test can assert what a host is
 * offered and which one is preselected.
 */
export function options(element) {
  const html = render(element)
  const select = html.match(/<select[^>]*>([\s\S]*?)<\/select>/)
  if (!select) return null
  const opts = [...select[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
  return opts.map(([, value, label]) => ({ value, label: label.replace(/<[^>]*>/g, "").trim() }))
}

/**
 * The value of whichever option React marked selected, or null if none is.
 *
 * Static markup puts `selected` on the option rather than `value` on the
 * select, and the attribute order is React's choice — so this matches either
 * way round rather than assuming one.
 */
export function selected(element) {
  const html = render(element)
  const option = html.match(/<option\b[^>]*\bselected\b[^>]*>/)?.[0]
  return option ? (option.match(/\bvalue="([^"]*)"/)?.[1] ?? "") : null
}

/** An attribute's value on the first matching tag, for things text() cannot see. */
export function attr(element, tag, name) {
  const open = render(element).match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? []
  for (const t of open) {
    const found = t.match(new RegExp(`\\b${name}="([^"]*)"`))
    if (found) return found[1]
  }
  return null
}

/** Count how many times a pattern appears in the rendered output. */
export const count = (element, re) => (render(element).match(re) ?? []).length
