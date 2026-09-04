import { useEffect, useState } from "react"

/**
 * Who else is driving, and what they just did.
 *
 * The desk, the cue cards and the controller all have the same authority and
 * until now none of them could see the others. The failure that produces is
 * quiet and specific: two people arm the buzzer within a second of each other,
 * each sees it armed, each assumes their own press did it — and then one of
 * them locks it again because they think they double-pressed. Nothing in the
 * state says a second person is there, so nothing contradicts them.
 *
 * So: a line naming everyone connected, and a line saying who moved last. Both
 * privileged-only. It is deliberately small — this is peripheral information
 * that has to be *available* under pressure, not competing with the clue.
 */

const SURFACE = {
  desk: { icon: "▤", label: "desk" },
  cards: { icon: "▭", label: "cue cards" },
  control: { icon: "◉", label: "controller" },
}

export function Operators({ state, className = "" }) {
  const operators = state?.operators ?? []
  // Alone is the normal case, and saying "1 operator" then is just clutter.
  if (operators.length <= 1 && !state?.lastAction) return null

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] ${className}`}>
      {operators.map((op) => {
        const s = SURFACE[op.surface] ?? SURFACE.control
        return (
          <span key={op.id} className="flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-muted" title={`On the ${s.label}`}>
            <span className="text-gold-dim">{s.icon}</span>
            <span className="max-w-[9rem] truncate">{op.name}</span>
          </span>
        )
      })}
      <LastAction action={state?.lastAction} operators={operators} />
    </div>
  )
}

/**
 * The last move, and who made it.
 *
 * It fades after a minute rather than persisting: "Alice armed the buzzer" is
 * useful for the few seconds in which you might be about to do it too, and
 * stale after that — a line that is always there stops being read.
 */
function LastAction({ action, operators }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!action) return
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [action])

  if (!action) return null
  const age = Date.now() - action.at
  if (age > 60_000) return null

  // Only worth saying when somebody else did it — you know what you pressed.
  const still = operators.some((o) => o.id === action.by)
  return (
    <span className="text-faint">
      {action.name}
      {!still && " (gone)"} {action.what} · {ago(age)}
    </span>
  )
}

const ago = (ms) => (ms < 3000 ? "just now" : ms < 60_000 ? `${Math.round(ms / 1000)}s ago` : "a while ago")
