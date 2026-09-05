import { useEffect, useMemo, useRef, useState } from "react"
import {
  applyValues,
  boardIssues,
  boardStats,
  downloadBoard,
  duplicateBoard,
  makeBoard,
  makeCategory,
  makeRound,
  MAX_SURVEY_QUESTIONS,
  makeSurveyAnswer,
  makeSurveyQuestion,
  patchCategory,
  patchClue,
  patchRound,
  resizeRound,
  scatterNitro,
} from "../../lib/board"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { surveyUrl } from "../../lib/net"
import { MediaField } from "../ui/MediaField"
import { ImportCsv } from "./ImportCsv"

/**
 * Part one of the host's night: writing the game.
 *
 * The grid on the left is the board as the room will see it; clicking a tile
 * opens it in the inspector on the right. Everything autosaves to the relay, so
 * closing the tab at 1am doesn't cost you the quiz.
 */
export function Builder({ board, setBoard, roundIndex, setRoundIndex, settings, onSettings, onPush, pushState, state }) {
  const [selected, setSelected] = useState(null) // { catIndex, clueIndex }
  const [saved, setSaved] = useState("idle")
  const [boards, setBoards] = useState([])
  const [importing, setImporting] = useState(false)
  const firstRun = useRef(true)

  const round = board.rounds[roundIndex] ?? board.rounds[0]
  const onFinal = roundIndex < 0
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

  const fetchBoard = (id) =>
    fetch(`${getRelayOrigin()}/boards/${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.board ?? null)

  const open = async (id) => {
    const b = await fetchBoard(id)
    if (!b) return
    setBoard(b)
    setRoundIndex(0)
    setSelected(null)
  }

  const copy = async (id) => {
    const b = await fetchBoard(id)
    if (!b) return
    // Land on the copy: duplicating is nearly always the first step of editing
    // it, and the autosave effect writes it out from here.
    setBoard(duplicateBoard(b))
    setRoundIndex(0)
    setSelected(null)
  }

  const remove = async (b) => {
    if (!confirm(`Delete the board "${b.title}"? This cannot be undone.`)) return
    await fetch(`${getRelayOrigin()}/boards/${b.id}`, { method: "DELETE", credentials: "include" }).catch(() => {})
    setBoards((list) => list.filter((x) => x.id !== b.id))
    // Deleting the one on screen would leave the builder editing a ghost that
    // the next autosave would silently recreate.
    if (b.id === board.id) {
      setBoard(makeBoard())
      setRoundIndex(0)
      setSelected(null)
    }
  }

  /**
   * Remove a round, clues and all.
   *
   * The index has to move as well as the array: leaving `roundIndex` pointing
   * past the end would fall back to round one silently, which looks like the
   * wrong round was deleted.
   */
  const deleteRound = (i) => {
    const r = board.rounds[i]
    const written = r.categories.reduce((n, c) => n + c.clues.filter((cl) => cl.prompt.trim() || cl.media).length, 0)
    const detail = written ? ` ${written} written clue${written === 1 ? "" : "s"} go with it.` : ""
    if (!confirm(`Delete ${r.name || `Round ${i + 1}`}?${detail} This cannot be undone.`)) return

    setBoard({ ...board, rounds: board.rounds.filter((_, n) => n !== i) })
    setRoundIndex((cur) => (cur > i ? cur - 1 : Math.min(cur, board.rounds.length - 2)))
    setSelected(null)
  }

  const clue = selected && !onFinal ? round?.categories[selected.catIndex]?.clues[selected.clueIndex] : null
  const patch = (p) => setBoard(patchClue(board, roundIndex, selected.catIndex, selected.clueIndex, p))

  return (
    <>
    {importing && (
      <ImportCsv
        onClose={() => setImporting(false)}
        onImport={(b) => {
          // Keep the final clue: it is written separately and an import of the
          // grid should not quietly discard it.
          setBoard({ ...b, id: board.id, final: board.final })
          setRoundIndex(0)
          setSelected(null)
        }}
      />
    )}
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
                  <span key={r.id} className="relative inline-flex">
                    <button
                      className={`btn ${i === roundIndex ? "btn-gold pr-7" : ""}`}
                      onClick={() => {
                        setRoundIndex(i)
                        setSelected(null)
                      }}
                    >
                      {r.name || `R${i + 1}`}
                    </button>
                    {/* Only on the round you are looking at, and never on the
                        last one — a board with no rounds is not a board. Shown
                        rather than revealed on hover, because half of this is
                        used on a tablet where there is no hover. */}
                    {i === roundIndex && board.rounds.length > 1 && (
                      <button
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-[13px] leading-none text-[#17110a]/60 transition-colors hover:text-bad"
                        title={`Delete ${r.name || `Round ${i + 1}`}`}
                        aria-label={`Delete ${r.name || `Round ${i + 1}`}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteRound(i)
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
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
                {/* Three endings, three tabs. They were one screen and it was
                    a wall — a form for the final, a form for the survey and a
                    form for the tie-break, only one of which you are thinking
                    about at a time. */}
                {[
                  [-1, "✦ Final", board.final?.enabled, "The last clue — everyone wagers, writes, and is turned over one at a time"],
                  [-2, "◎ Survey", board.survey?.enabled, "We asked a hundred people — played last, after everything else"],
                  [-3, "⚖ Tie-break", !!board.tiebreak?.prompt?.trim(), "Sudden death, if the game ends level"],
                ].map(([i, label, on, title]) => (
                  <button
                    key={i}
                    className={`btn ${i === -1 ? "ml-1" : ""} ${roundIndex === i ? "btn-gold" : ""} ${on ? "" : "opacity-60"}`}
                    title={title}
                    onClick={() => {
                      setRoundIndex(i)
                      setSelected(null)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <SaveDot state={saved} />
              <button className="btn" onClick={() => downloadBoard(board)}>
                Export
              </button>
              <button className="btn" onClick={() => setImporting(true)} title="Bring a quiz in from CSV or a spreadsheet paste">
                CSV
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

        {roundIndex === -1 ? (
          <FinalEditor board={board} setBoard={setBoard} />
        ) : roundIndex === -2 ? (
          <SurveyEditor board={board} setBoard={setBoard} survey={state?.survey} code={state?.code} />
        ) : roundIndex === -3 ? (
          <TiebreakEditor board={board} setBoard={setBoard} />
        ) : (
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
            <button className="btn" onClick={() => setBoard(patchRound(board, roundIndex, scatterNitro(round, roundIndex === 0 ? 1 : 2)))}>
              ✦ Scatter Nitro
            </button>
            <div className="ml-auto text-[11px] text-faint">
              {stats.filled}/{stats.clues} written · {stats.media} media · {stats.nitros} nitro
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
                          {cl.nitro && <span className="absolute right-1.5 top-1 text-[10px] text-live">✦</span>}
                          {written && !cl.answer.trim() && (
                            <span className="absolute bottom-1 left-1.5 text-[9px] text-bad" title="No answer recorded">
                              !
                            </span>
                          )}
                          {cl.media && (
                            <span className="absolute bottom-1 right-1.5 text-[9px] text-muted">
                              {{ audio: "♪", video: "▶" }[cl.media.kind] ?? "▣"}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        )}

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
                  <input type="checkbox" checked={clue.nitro} onChange={(e) => patch({ nitro: e.target.checked })} />
                  Noggin' Nitro
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
            {/*
              First, because it changes what everything under it means — a
              lifeline count is per player or per team depending on this one box.
            */}
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input type="checkbox" className="mt-0.5" checked={!!settings.teams} onChange={(e) => onSettings({ teams: e.target.checked })} />
              <span>
                Play in teams
                <span className="block text-[10px] text-faint">
                  Several phones share one score and one buzz. Two teams to start; build them on the Run tab.
                </span>
              </span>
            </label>
            <Rule
              label="Answer clock"
              hint="seconds once someone buzzes in · 0 = untimed"
              value={settings.answerSeconds}
              onChange={(v) => onSettings({ answerSeconds: v })}
              min={0}
              max={120}
            />
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!settings.autoArm}
                onChange={(e) => onSettings({ autoArm: e.target.checked })}
              />
              <span>
                Arm the buzzer automatically
                <span className="block text-[10px] text-faint">opens when the clue appears, without waiting for you</span>
              </span>
            </label>
            {settings.autoArm && (
              <Rule
                label="Reading time"
                hint="seconds before it opens · 0 = instantly"
                value={settings.readSeconds ?? 0}
                onChange={(v) => onSettings({ readSeconds: v })}
                min={0}
                max={60}
              />
            )}
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!settings.pingCorrection}
                onChange={(e) => onSettings({ pingCorrection: e.target.checked })}
              />
              <span>
                Even out connections
                <span className="block text-[10px] text-faint">
                  judge the race on reaction time, not on whose wifi is faster · holds each race open a moment longer
                </span>
              </span>
            </label>
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
              hint={settings.teams ? "lifelines each team starts with" : "lifelines each player starts with"}
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
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.mirrorClue !== false}
                onChange={(e) => onSettings({ mirrorClue: e.target.checked })}
              />
              <span>
                Show the clue on phones
                <span className="block text-[10px] text-faint">
                  for anyone who can't see the TV · off keeps every eye on the big screen, and gives them a bigger buzzer
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="panel p-4">
          <div className="label mb-2">Your boards</div>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {boards.length === 0 && <div className="text-[11px] text-faint">Nothing saved yet.</div>}
            {boards.map((b) => (
              <div
                key={b.id}
                className={`group/board flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
                  b.id === board.id ? "border-gold-deep bg-royal/40" : "border-edge hover:border-violet"
                }`}
              >
                <button
                  className="min-w-0 flex-1 truncate text-left disabled:cursor-default"
                  disabled={b.id === board.id}
                  onClick={() => open(b.id)}
                  title={b.id === board.id ? "Open in the builder" : b.title}
                >
                  {b.title}
                </button>
                <span className="shrink-0 text-[10px] text-faint">{b.clues}</span>
                <button
                  className="shrink-0 px-1.5 py-0.5 text-[12px] text-faint opacity-70 transition hover:text-gold group-hover/board:opacity-100"
                  title="Duplicate — next month's quiz usually starts as this one"
                  onClick={() => copy(b.id)}
                >
                  ⧉
                </button>
                <button
                  className="shrink-0 px-1.5 py-0.5 text-[12px] text-faint opacity-70 transition hover:text-bad group-hover/board:opacity-100"
                  title="Delete this board"
                  onClick={() => remove(b)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-gold w-full py-3 text-base" onClick={onPush} disabled={pushState === "pushing"}>
          {pushState === "pushed" ? "Board is live ✓" : "Push board to the room"}
        </button>
      </div>
    </div>
    </>
  )
}

/**
 * The last clue.
 *
 * Off by default: plenty of quizzes just end when the board is cleared, and a
 * blank final appearing on the projector would be worse than none at all.
 */
function FinalEditor({ board, setBoard }) {
  const final = board.final ?? {}
  const patch = (p) => setBoard({ ...board, final: { ...final, ...p } })

  return (
    <div className="panel p-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={!!final.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        <span className="font-display text-base text-gold">Play a final round</span>
      </label>

      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        Everyone still in the black bets part of their score before seeing it, writes an answer on their phone, and is turned over one at a
        time — poorest first.
      </p>

      <div className={`mt-4 space-y-3 ${final.enabled ? "" : "pointer-events-none opacity-40"}`}>
        <div className="flex gap-3">
          <label className="min-w-0 flex-1">
            <div className="label mb-1">Category</div>
            <input
              className="field font-display uppercase"
              placeholder="Shown while everyone bets"
              value={final.category ?? ""}
              onChange={(e) => patch({ category: e.target.value })}
            />
          </label>
          <label className="w-28">
            <div className="label mb-1">Clock</div>
            <input
              type="number"
              min={5}
              max={600}
              className="field"
              value={final.seconds ?? 30}
              onChange={(e) => patch({ seconds: Math.max(5, Math.min(600, +e.target.value || 30)) })}
            />
          </label>
        </div>

        <label className="block">
          <div className="label mb-1">Clue</div>
          <textarea
            className="field min-h-[92px] resize-y font-display text-[14px] leading-snug"
            placeholder="Nobody sees this until the bets are locked"
            value={final.prompt ?? ""}
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </label>

        <MediaField value={final.media ?? null} onChange={(media) => patch({ media })} label="Clue media" />

        <label className="block">
          <div className="label mb-1">Answer</div>
          <textarea
            className="field min-h-[56px] resize-y"
            value={final.answer ?? ""}
            onChange={(e) => patch({ answer: e.target.value })}
          />
        </label>

        <MediaField value={final.answerMedia ?? null} onChange={(answerMedia) => patch({ answerMedia })} label="Reveal media" />
      </div>

    </div>
  )
}

/**
 * The one kept back in case the final leaves two people level.
 *
 * Lives under the final because that is when it is needed and when you are
 * already thinking about the end of the game. Optional — with nothing written
 * the host can still run the buzzer and read something out — but a tie is a bad
 * moment to be inventing a question, so it is worth two minutes now.
 */
/**
 * The survey round: its questions, its boards, and where they came from.
 *
 * Up to five questions, each with its own board. The editor's centre of gravity
 * is the **link** rather than the answer lists: write the questions, send the
 * link to a group chat for a day, then build each board out of what people
 * actually said — which is both less work and a far better round than forty
 * answers invented at a desk.
 *
 * One question open at a time. Five expanded forms is the wall this tab was
 * split up to avoid.
 */
function SurveyEditor({ board, setBoard, survey: live, code }) {
  const survey = board.survey ?? {}
  const questions = survey.questions ?? []
  const patch = (p) => setBoard({ ...board, survey: { ...survey, ...p } })
  const setQ = (i, p) => patch({ questions: questions.map((q, j) => (j === i ? { ...q, ...p } : q)) })

  const [open, setOpen] = useState(0)
  const [url, setUrl] = useState("")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (code && survey.enabled) surveyUrl(code).then(setUrl)
  }, [code, survey.enabled])

  /** What came back for each question, matched up by id. */
  const answersIn = (id) => live?.questions?.find((q) => q.id === id)

  return (
    <div className="panel p-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={!!survey.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        <span className="font-display text-base text-gold">Play a survey round</span>
      </label>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        "We asked a hundred people." Played <span className="text-muted">last</span> — after the final, and after any tie-break. Hidden
        answers with points; whoever buzzes first says one, and it is either on the board or it is a strike. A scramble rather than a
        reckoning, so a game somebody has already won stays live to the end.
      </p>

      <div className={`mt-4 space-y-3 ${survey.enabled ? "" : "pointer-events-none opacity-40"}`}>
        {/* The link. This is the point of the round. */}
        <div className="rounded-lg border border-gold-deep/40 bg-royal/20 px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="label">Ask people</span>
            <span className="text-[10px] text-faint">
              {live?.responses ? `${live.responses} answers in` : "no account needed at their end"}
            </span>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[10px] text-muted">
              <input type="checkbox" checked={survey.collecting !== false} onChange={(e) => patch({ collecting: e.target.checked })} />
              open
            </label>
          </div>

          {code ? (
            <>
              <div className="mt-1.5 break-all rounded-md border border-edge bg-black/30 px-2 py-1.5 text-[10px] text-muted">{url || "…"}</div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  className="btn btn-gold flex-1 py-1.5 text-[11px]"
                  disabled={!url}
                  onClick={() => {
                    navigator.clipboard?.writeText(url)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  }}
                >
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
                <a className="btn px-2.5 py-1.5 text-[11px]" href={url || "#"} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              </div>
            </>
          ) : (
            <div className="mt-1.5 text-[10px] text-faint">The link appears once the room is open — switch to Run for a moment.</div>
          )}
        </div>

        {questions.map((q, i) => (
          <SurveyQuestion
            key={q.id}
            n={i + 1}
            q={q}
            live={answersIn(q.id)}
            open={open === i}
            onToggle={() => setOpen(open === i ? -1 : i)}
            onChange={(p) => setQ(i, p)}
            onRemove={
              questions.length > 1
                ? () => {
                    if (!confirm(`Delete question ${i + 1}?`)) return
                    patch({ questions: questions.filter((_, j) => j !== i) })
                    setOpen(0)
                  }
                : null
            }
          />
        ))}

        <button
          className="btn w-full py-1.5 text-[11px]"
          disabled={questions.length >= MAX_SURVEY_QUESTIONS}
          onClick={() => {
            patch({ questions: [...questions, makeSurveyQuestion()] })
            setOpen(questions.length)
          }}
        >
          + Question {questions.length >= MAX_SURVEY_QUESTIONS ? `(${MAX_SURVEY_QUESTIONS} is the most)` : ""}
        </button>
      </div>
    </div>
  )
}

/** One question, collapsed to a line until you are working on it. */
function SurveyQuestion({ n, q, live, open, onToggle, onChange, onRemove }) {
  const answers = q.answers ?? []
  const set = (i, p) => onChange({ answers: answers.map((a, j) => (j === i ? { ...a, ...p } : a)) })
  const tally = live?.tally ?? []

  const build = () => {
    const top = tally.slice(0, 8)
    if (!top.length) return
    if (answers.length && !confirm(`Replace the ${answers.length} answers with the top ${top.length}?`)) return
    onChange({ answers: top.map((g) => ({ text: g.label, points: g.count * 50 })) })
  }

  return (
    <div className={`rounded-lg border ${open ? "border-gold-deep/60" : "border-edge"}`}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={onToggle}>
        <span className="w-4 shrink-0 text-center font-value text-[13px] text-gold-dim">{n}</span>
        <span className={`min-w-0 flex-1 truncate text-[12px] ${q.prompt.trim() ? "text-ink" : "text-faint"}`}>
          {q.prompt.trim() || "Not written yet"}
        </span>
        <span className="shrink-0 text-[10px] text-faint">
          {answers.length ? `${answers.length} on the board` : live?.responses ? `${live.responses} in` : "—"}
        </span>
        <span className="shrink-0 text-[10px] text-faint">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-edge px-3 py-3">
          <div className="flex gap-2">
            <label className="w-32 shrink-0">
              <div className="label mb-1">Category</div>
              <input className="field py-1 font-display uppercase" value={q.category} onChange={(e) => onChange({ category: e.target.value })} />
            </label>
            <label className="min-w-0 flex-1">
              <div className="label mb-1">Question</div>
              <input
                className="field py-1"
                placeholder="Name something you always forget to buy"
                value={q.prompt}
                onChange={(e) => onChange({ prompt: e.target.value })}
              />
            </label>
          </div>

          {tally.length > 0 && (
            <div className="rounded-md border border-edge px-2.5 py-2">
              <div className="flex items-baseline gap-2">
                <span className="label">Answers in</span>
                <span className="text-[10px] text-faint">
                  {live.responses} replies · {tally.length} distinct
                </span>
                <button className="btn ml-auto px-2 py-0.5 text-[10px]" onClick={build}>
                  Build the board
                </button>
              </div>
              <div className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto">
                {tally.slice(0, 20).map((g) => (
                  <div key={g.key} className="flex items-baseline gap-2 text-[11px]">
                    <span className="w-8 shrink-0 text-right font-value text-gold">{g.count}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{g.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="label mb-1.5">The board</div>
            <div className="space-y-1.5">
              {answers.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-4 shrink-0 text-center font-value text-[12px] text-gold-dim">{i + 1}</span>
                  <input
                    className="field min-w-0 flex-1 py-1 text-[12px]"
                    placeholder="Answer"
                    value={a.text}
                    onChange={(e) => set(i, { text: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    className="field w-16 py-1 text-right font-value text-[12px]"
                    value={a.points}
                    onChange={(e) => set(i, { points: Math.max(0, +e.target.value || 0) })}
                  />
                  <button
                    className="shrink-0 px-1 text-[11px] text-faint transition-colors hover:text-bad"
                    onClick={() => onChange({ answers: answers.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {answers.length === 0 && <div className="px-1 text-[11px] text-faint">Nothing on the board yet.</div>}
            </div>

            <div className="mt-2 flex gap-1.5">
              <button
                className="btn flex-1 py-1.5 text-[11px]"
                disabled={answers.length >= 10}
                onClick={() => onChange({ answers: [...answers, makeSurveyAnswer()] })}
              >
                + Answer
              </button>
              {onRemove && (
                <button className="btn px-2.5 py-1.5 text-[11px] hover:border-bad hover:text-bad" onClick={onRemove}>
                  Delete question
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TiebreakEditor({ board, setBoard }) {
  const tiebreak = board.tiebreak ?? {}
  const patch = (p) => setBoard({ ...board, tiebreak: { ...tiebreak, ...p } })
  const written = !!tiebreak.prompt?.trim()

  return (
    <div className="mt-5 border-t border-edge pt-4">
      <div className="flex items-baseline gap-2">
        <span className="label">Tie-break</span>
        <span className={`text-[10px] ${written ? "text-good" : "text-faint"}`}>{written ? "ready" : "not written"}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        Sudden death, if the final leaves the top two level: the tied sides only, first correct answer wins, nothing scored. Leave it
        empty and you can still run the buzzer on something you read out — but a tie is a poor moment to be inventing a question.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <div className="label mb-1">Clue</div>
          <textarea
            className="field min-h-[72px] resize-y font-display text-[14px] leading-snug"
            placeholder="Something with one short, unarguable answer"
            value={tiebreak.prompt ?? ""}
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </label>

        <MediaField value={tiebreak.media ?? null} onChange={(media) => patch({ media })} label="Clue media" />

        <label className="block">
          <div className="label mb-1">Answer</div>
          <textarea
            className="field min-h-[48px] resize-y"
            value={tiebreak.answer ?? ""}
            onChange={(e) => patch({ answer: e.target.value })}
          />
        </label>

        <MediaField value={tiebreak.answerMedia ?? null} onChange={(answerMedia) => patch({ answerMedia })} label="Reveal media" />
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
