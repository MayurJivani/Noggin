import { holdsBuzz, isCalling, isSpent } from "../../lib/sides"
import { scoreSize, useRolling } from "../../lib/useRolling"

/**
 * Podiums along the bottom of the big screen.
 *
 * `rows` is whatever is being scored tonight — five people, or three teams. The
 * only difference a team makes here is that it carries a colour and says how
 * many phones are behind it.
 */
export function ScoreBar({ rows, buzzer, lifeline, lastCorrect = null }) {
  if (!rows.length) return null
  /*
    How crowded the bar is. Each podium had a 15vmin floor, so past ten or so
    the row was wider than the screen and the names ran off both edges. Now a
    big room gets narrower podiums in smaller type, wrapping onto a second line
    rather than leaving the screen.
  */
  const n = rows.length
  const tier = n <= 8 ? 0 : n <= 14 ? 1 : 2
  // Tier 2 wraps to a second line instead of slicing names to two letters.
  const minW = ["15vmin", "11vmin", "12vmin"][tier]
  const maxW = ["26vmin", "16vmin", "16vmin"][tier]
  const nameSize = [1.5, 1.15, 0.95][tier]
  const scoreStages = [3.4, 2.4, 1.8][tier]
  return (
    <div className="shrink-0">
      <LastCorrect entry={lastCorrect} />
      <div className={`flex flex-wrap items-end justify-center px-[2vmin] pb-[1.5vmin] ${tier ? "gap-[0.6vmin]" : "gap-[1vmin]"}`}>
      {rows.map((row) => {
        const holds = holdsBuzz(row, buzzer)
        const spent = isSpent(row, buzzer)
        const calling = isCalling(row, lifeline)
        return (
          <div
            key={row.id}
            style={{ minWidth: minW, maxWidth: maxW, ...(holds && row.color ? { borderColor: row.color } : {}) }}
            className={`min-w-0 flex-1 rounded-t-[1vmin] border-t border-x text-center transition-all duration-300 ${tier ? "px-[0.7vmin] py-[0.6vmin]" : "px-[1.2vmin] py-[1vmin]"} ${
              holds
                ? "border-live bg-live/15 -translate-y-[0.8vmin]"
                : calling
                  ? "border-amethyst bg-royal/40"
                  : spent
                    ? "border-edge/50 bg-black/20 opacity-45"
                    : "border-gold-deep/25 bg-gradient-to-b from-onyx/70 to-void/70"
            }`}
          >
            <div className="flex items-center justify-center gap-[0.6vmin]">
              {row.color && <span className="h-[0.9vmin] w-[0.9vmin] shrink-0 rounded-full" style={{ background: row.color }} />}
              {!row.connected && <span className="h-[0.8vmin] w-[0.8vmin] rounded-full bg-faint" title="away" />}
              <div
                className="min-w-0 truncate font-display uppercase tracking-wide text-ink/90"
                style={{ fontSize: `max(9px, calc(var(--stage) * ${nameSize}))` }}
                title={row.name}
              >
                {row.name}
              </div>
              {(row.lifelines?.phone ?? 0) > 0 && <span className="text-gold-dim" style={{ fontSize: "max(8px, calc(var(--stage) * 1))" }}>☎</span>}
            </div>
            <Rolling value={row.score} stages={scoreStages} />
            {/* Who is actually behind a team, in the smallest type on the
                screen — enough to find your own side, not enough to compete
                with the number above it. */}
            {row.memberNames?.length > 0 && (
              <div className="truncate text-muted/70" style={{ fontSize: "max(7px, calc(var(--stage) * 0.95))" }}>
                {row.memberNames.join(" · ")}
              </div>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Who got the last one right.
 *
 * The question a room asks out loud more than any other, and until now the
 * only answer was somebody's memory — the board goes back up and whoever just
 * won a tile is indistinguishable from everyone else on it. One line above the
 * podiums, in the smallest type that can be read from the back: it is a
 * reminder, not a result, and it must never compete with the scores under it.
 */
function LastCorrect({ entry }) {
  if (!entry?.by) return null
  return (
    <div className="flex items-baseline justify-center gap-[0.8vmin] pb-[0.6vmin] text-center">
      <span className="font-display uppercase tracking-[0.25em] text-faint" style={{ fontSize: "max(7px, calc(var(--stage) * 0.95))" }}>
        last correct
      </span>
      <span className="truncate font-display uppercase text-muted" style={{ fontSize: "max(9px, calc(var(--stage) * 1.2))" }}>
        {entry.by}
      </span>
      {entry.clue && (
        <span className="truncate text-faint" style={{ fontSize: "max(7px, calc(var(--stage) * 0.95))" }}>
          {entry.clue}
        </span>
      )}
      {/* A play-off seat pays nothing, so a "+0" would be a lie about what
          happened rather than a detail. */}
      {entry.amount > 0 && (
        <span className="font-value tabular-nums text-gold-dim" style={{ fontSize: "max(9px, calc(var(--stage) * 1.2))" }}>
          +{entry.amount}
        </span>
      )}
    </div>
  )
}

function Rolling({ value, stages = 3.4 }) {
  const [shown, moving] = useRolling(value)
  return (
    <div
      className={`max-w-full whitespace-nowrap font-value tabular-nums leading-none ${shown < 0 ? "text-bad" : "text-gold"} ${moving ? "" : "brass-sm"}`}
      style={{ fontSize: scoreSize(shown, stages, stages < 3 ? 13 : 20) }}
    >
      {shown}
    </div>
  )
}
