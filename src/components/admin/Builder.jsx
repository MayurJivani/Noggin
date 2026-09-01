import { useEffect, useMemo, useRef, useState } from "react"
import {
  applyValues,
  boardIssues,
  boardStats,
  downloadBoard,
  makeCategory,
  makeRound,
  patchCategory,
  patchClue,
  patchRound,
  resizeRound,
  sprinkleDailyDoubles,
} from "../../lib/board"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { MediaField } from "../ui/MediaField"

/**
 * Part one of the host's night: writing the game.
 *
 * The grid on the left is the board as the room will see it; clicking a tile
 * opens it in the inspector on the right. Everything autosaves to the relay, so
 * closing the tab at 1am doesn't cost you the quiz.
 */
export function Builder({ board, setBoard, roundIndex, setRoundIndex, settings, onSettings, onPush, pushState }) {
  const [selected, setSelected] = useState(null) // { catIndex, clueIndex }
  const [saved, setSaved] = useState("idle")
  const [boards, setBoards] = useState([])
  const firstRun = useRef(true)

  const round = board.rounds[roundIndex] ?? board.rounds[0]
  const stats = useMemo(() => boardStats(board), [board])
  const issues = useMemo(() => boardIssues(board), [board])

  // Autosave. Debounced hard — this fires on every keystroke in a clue body.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setSaved("saving")
    const id = setTimeout(async () => {
      try {
        await fetch(`${getRelayOrigin()}/boards/${board.id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...board, updatedAt: Date.now() }),
        })
        setSaved("saved")
      } catch {
        setSaved("error")
      }
    }, 700)
    return () => clearTimeout(id)
  }, [board])

  useEffect(() => {
    fetch(`${getRelayOrigin()}/boards`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setBoards(j.boards ?? []))
      .catch(() => {})
  }, [saved])

  const clue = selected ? round?.categories[selected.catIndex]?.clues[selected.clueIndex] : null
  const patch = (p) => setBoard(patchClue(board, roundIndex, selected.catIndex, selected.clueIndex, p))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_minmax(380px,24%)]">
      <div className="min-w-0 space-y-4">
        <div className="panel p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <div className="label mb-1">Game title</div>
              <input className="field font-display text-base" value={board.title} onChange={(e) => setBoard({ ...board, title: e.target.value })} />
            </div>
            <div>
              <div className="label mb-1">Rounds</div>
              <div className="flex gap-1">
                {board.rounds.map((r, i) => (
                  <button
                    key={r.id}
                    className={`btn ${i === roundIndex ? "btn-gold" : ""}`}
                    onClick={() => {
                      setRoundIndex(i)
                      setSelected(null)
                    }}
                  >
                    {r.name || `R${i + 1}`}
                  </button>
                ))}
                <button
                  className="btn px-2.5"
                  title="Add a round"
                  onClick={() =>
                    setBoard({
                      ...board,
                      rounds: [...board.rounds, makeRound(`Round ${board.rounds.length + 1}`, round.values.map((v) => v * 2))],
                    })
                  }
                >
                  +
                </button>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <SaveDot state={saved} />
              <button className="btn" onClick={() => downloadBoard(board)}>
                Export
              </button>
              <ImportButton
                onImport={(b) => {
                  setBoard(b)
                  setRoundIndex(0)
                  setSelected(null)
                }}
              />
            </div>
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-2.5">
            <input
              className="field max-w-[160px] font-display"
              value={round.name}
              onChange={(e) => setBoard(patchRound(board, roundIndex, { name: e.target.value }))}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              rows
              <input
                type="number"
                min={1}
                max={10}
                className="field w-14 py-1"
                value={round.values.length}
                onChange={(e) => setBoard(patchRound(board, roundIndex, resizeRound(round, Math.max(1, Math.min(10, +e.target.value || 1)))))}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              base
              <input
                type="number"
                min={50}
                step={50}
                className="field w-20 py-1"
                value={round.values[0] ?? 200}
                onChange={(e) => {
                  const base = Math.max(0, +e.target.value || 0)
                  setBoard(patchRound(board, roundIndex, applyValues(round, round.values.map((_, i) => base * (i + 1)))))
                }}
                title="Re-price the ladder as multiples of this"
              />
            </label>
            <button
              className="btn"
              onClick={() => setBoard(patchRound(board, roundIndex, { categories: [...round.categories, makeCategory("", round.values)] }))}
            >
              + Category
            </button>
            <button className="btn" onClick={() => setBoard(patchRound(board, roundIndex, sprinkleDailyDoubles(round, roundIndex === 0 ? 1 : 2)))}>
              ✦ Scatter daily doubles
            </button>
            <div className="ml-auto text-[11px] text-faint">
              {stats.filled}/{stats.clues} written · {stats.media} media · {stats.dailyDoubles} DD
            </div>
          </div>

          <div className="overflow-x-auto p-3">
            <div className="grid min-w-max gap-2" style={{ gridTemplateColumns: `repeat(${round.categories.length}, minmax(150px, 1fr))` }}>
              {round.categories.map((cat, ci) => (
                <div key={cat.id} className="group/col">
                  <div className="relative">
                    <input
                      className="field h-14 text-center font-display text-[13px] uppercase leading-tight tracking-wide"
                      placeholder={`Category ${ci + 1}`}
                      value={cat.title}
                      onChange={(e) => setBoard(patchCategory(board, roundIndex, ci, { title: e.target.value }))}
                    />
                    {round.categories.length > 1 && (
                      <button
                        className="absolute -right-1 -top-1 hidden h-5 w-5 rounded-full border border-edge bg-panel-2 text-[10px] text-muted group-hover/col:block hover:border-bad hover:text-bad"
                        title="Remove category"
                        onClick={() => {
                          setSelected(null)
                          setBoard(patchRound(board, roundIndex, { categories: round.categories.filter((_, i) => i !== ci) }))
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    {cat.clues.map((cl, qi) => {
                      const on = selected?.catIndex === ci && selected?.clueIndex === qi
                      const written = cl.prompt.trim() || cl.media
                      return (
                        <button
                          key={cl.id}
                          onClick={() => setSelected({ catIndex: ci, clueIndex: qi })}
                          className={`relative h-14 w-full rounded-lg border font-value text-2xl transition-all ${
                            on
                              ? "border-gold bg-royal/70 text-gold shadow-lg shadow-black/40"
                              : written
                                ? "border-edge bg-panel-2 text-gold/90 hover:border-violet"
                                : "border-dashed border-edge/70 bg-black/20 text-faint hover:border-violet"
                          }`}
                        >
                          {cl.value}
                          {cl.dailyDouble && <span className="absolute right-1.5 top-1 text-[10px] text-live">✦</span>}
                          {written && !cl.answer.trim() && (
                            <span className="absolute bottom-1 left-1.5 text-[9px] text-bad" title="No answer recorded">
                              !
                            </span>
                          )}
                          {cl.media && <span className="absolute bottom-1 right-1.5 text-[9px] text-muted">{cl.media.kind === "audio" ? "♪" : "▣"}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {issues.length > 0 && (
          <details className="panel px-4 py-3 text-[12px]">
            <summary className="cursor-pointer text-muted">
              {issues.length} thing{issues.length === 1 ? "" : "s"} to look at before showtime
            </summary>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-faint">
              {issues.map((i, n) => (
                <li key={n}>
                  <span className="text-muted">{i.where}</span> — {i.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <div className="panel p-4">
          {clue ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="label">
                  {round.categories[selected.catIndex].title || `Category ${selected.catIndex + 1}`} · {clue.value}
                </div>
                <button className="btn px-2 py-1 text-[11px]" onClick={() => setSelected(null)}>
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex-1">
                  <div className="label mb-1">Points</div>
                  <input type="number" step={50} className="field" value={clue.value} onChange={(e) => patch({ value: +e.target.value || 0 })} />
                </label>
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                  <input type="checkbox" checked={clue.dailyDouble} onChange={(e) => patch({ dailyDouble: e.target.checked })} />
                  Daily double
                </label>
              </div>

              <label className="block">
                <div className="label mb-1">Clue</div>
                <textarea
                  className="field min-h-[92px] resize-y font-display text-[14px] leading-snug"
                  placeholder="What the room sees…"
                  value={clue.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                />
              </label>

              <MediaField value={clue.media} onChange={(media) => patch({ media })} label="Clue media" />

              <label className="block">
                <div className="label mb-1">Answer</div>
                <textarea
                  className="field min-h-[56px] resize-y"
                  placeholder="Only you and the reveal see this"
                  value={clue.answer}
                  onChange={(e) => patch({ answer: e.target.value })}
                />
              </label>

              <MediaField value={clue.answerMedia} onChange={(answerMedia) => patch({ answerMedia })} label="Reveal media" />
            </div>
          ) : (
            <div className="py-8 text-center text-[12px] text-faint">Pick a tile to write it.</div>
          )}
        </div>

        <div className="panel p-4">
          <div className="label mb-2">Game rules</div>
          <div className="space-y-2.5">
            <Rule
              label="Answer clock"
              hint="seconds once someone buzzes in · 0 = untimed"
              value={settings.answerSeconds}
              onChange={(v) => onSettings({ answerSeconds: v })}
              min={0}
              max={120}
            />
            <Rule
              label="Early-buzz penalty"
              hint="ms locked out for jumping the gun"
              value={settings.earlyPenaltyMs}
              onChange={(v) => onSettings({ earlyPenaltyMs: v })}
              min={0}
              max={5000}
              step={100}
            />
            <Rule
              label="Phone a Friend"
              hint="lifelines each player starts with"
              value={settings.lifelines?.phone ?? 1}
              onChange={(v) => onSettings({ lifelines: { ...settings.lifelines, phone: v } })}
              min={0}
              max={5}
            />
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!settings.penaltyForWrong}
                onChange={(e) => onSettings({ penaltyForWrong: e.target.checked })}
              />
              <span>
                Wrong answers deduct
                <span className="block text-[10px] text-faint">turn off for a friendlier game</span>
              </span>
            </label>
          </div>
        </div>

        <div className="panel p-4">
          <div className="label mb-2">Saved games</div>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {boards.length === 0 && <div className="text-[11px] text-faint">Nothing saved yet.</div>}
            {boards.map((b) => (
              <button
                key={b.id}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  b.id === board.id ? "border-gold-deep bg-royal/40" : "border-edge hover:border-violet"
                }`}
                onClick={async () => {
                  if (b.id === board.id) return
                  const j = await fetch(`${getRelayOrigin()}/boards/${b.id}`, { credentials: "include" }).then((r) => r.json())
                  if (j.board) {
                    setBoard(j.board)
                    setRoundIndex(0)
                    setSelected(null)
                  }
                }}
              >
                <span className="min-w-0 flex-1 truncate">{b.title}</span>
                <span className="shrink-0 text-[10px] text-faint">{b.clues} clues</span>
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-gold w-full py-3 text-base" onClick={onPush} disabled={pushState === "pushing"}>
          {pushState === "pushed" ? "Board is live ✓" : "Push board to the room"}
        </button>
      </div>
    </div>
  )
}

function Rule({ label, hint, value, onChange, min, max, step = 1 }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <input
          type="number"
          className="field w-20 py-1 text-right"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value || 0)))}
        />
      </div>
      <div className="text-[10px] text-faint">{hint}</div>
    </label>
  )
}

function SaveDot({ state }) {
  const map = {
    idle: ["bg-faint", "ready"],
    saving: ["bg-live animate-glow", "saving…"],
    saved: ["bg-good", "saved"],
    error: ["bg-bad", "not saved"],
  }
  const [dot, text] = map[state] ?? map.idle
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-faint">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  )
}

function ImportButton({ onImport }) {
  const input = useRef(null)
  return (
    <>
      <button className="btn" onClick={() => input.current?.click()}>
        Import
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          try {
            onImport(JSON.parse(await file.text()))
          } catch {
            alert("That file isn't a Noggin board.")
          }
        }}
      />
    </>
  )
}
