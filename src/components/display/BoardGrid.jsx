import { forwardRef } from "react"

/**
 * The board as the room sees it. Tiles stagger in on a diagonal so a fresh
 * round arrives as a wave rather than a flash — the same trick every game show
 * uses to give the audience a beat to read the categories.
 */
export const BoardGrid = forwardRef(function BoardGrid({ round, cellRef }, ref) {
  if (!round) return null
  const cols = round.categories.length
  const rows = round.values.length

  return (
    <div ref={ref} className="flex h-full w-full flex-col gap-[0.7vmin] p-[1.5vmin]">
      <div className="grid gap-[0.7vmin]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {round.categories.map((cat, ci) => (
          <div
            key={cat.id}
            className="flex items-center justify-center rounded-[0.8vmin] border border-gold-deep/45 bg-gradient-to-b from-onyx/85 to-void/90 px-[0.6vmin] py-[1.4vmin] text-center animate-tile-in"
            style={{ animationDelay: `${ci * 55}ms` }}
          >
            <span className="font-display uppercase leading-[1.05] text-gold brass-sm" style={{ fontSize: `clamp(11px, ${2.4 - cols * 0.08}vw, 30px)` }}>
              {cat.title || " "}
            </span>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-[0.7vmin]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows }).flatMap((_, qi) =>
          round.categories.map((cat, ci) => {
            const clue = cat.clues[qi]
            if (!clue) return <div key={`${ci}-${qi}`} />
            const played = clue.status === "played"
            return (
              <div
                key={clue.id}
                ref={(el) => cellRef?.(ci, qi, el)}
                className={`flex items-center justify-center rounded-[0.8vmin] border transition-all duration-700 animate-tile-in ${
                  played
                    ? "border-edge/30 bg-black/35"
                    : "border-gold-dim/35 bg-gradient-to-b from-onyx/90 to-void/95 shadow-[inset_0_1px_0_rgba(242,201,107,0.14)]"
                }`}
                style={{ animationDelay: `${(ci + qi) * 45 + 180}ms` }}
              >
                {/* A spent tile keeps its number and dims, rather than emptying.
                    A hole in the grid reads as a rendering fault from across a
                    room; a burnt-out bulb reads as a tile that has been played,
                    and the board keeps its shape either way. */}
                <span
                  className={`font-value tabular-nums transition-all duration-700 ${played ? "text-gold-dim/45" : "text-gold brass"}`}
                  style={{ fontSize: `clamp(20px, ${6 - cols * 0.35}vw, 78px)` }}
                >
                  {clue.value}
                </span>
              </div>
            )
          }),
        )}
      </div>
    </div>
  )
})
