import { useRef, useState } from "react"
import { parseBoardCsv } from "../../lib/board"

/**
 * Bring a quiz in from a spreadsheet.
 *
 * Almost nobody writes forty clues by clicking forty tiles — they write them in
 * Sheets or Excel and then look for the import button. Paste is offered first
 * because that is what people actually do with a spreadsheet: select the range
 * and copy, which lands as tab-separated text.
 *
 * The preview is the point. An import that silently reshapes someone's board is
 * worse than no import, so this shows what it found and everything it did not
 * understand before anything is replaced.
 */
export function ImportCsv({ onImport, onClose }) {
  const [text, setText] = useState("")
  const [result, setResult] = useState(null)
  const file = useRef(null)

  const parse = (raw, title) => {
    setText(raw)
    setResult(raw.trim() ? parseBoardCsv(raw, title) : null)
  }

  const stats = result?.board && {
    categories: result.board.rounds[0].categories.length,
    values: result.board.rounds[0].values,
    clues: result.board.rounds[0].categories.reduce((n, c) => n + c.clues.filter((cl) => cl.prompt.trim()).length, 0),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel flex max-h-[86vh] w-full max-w-2xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-lg text-gold">Import from a spreadsheet</h2>
          <button className="ml-auto text-xs text-faint hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="mt-1 text-xs leading-relaxed text-muted">
          One clue per row: <code className="text-ink">category, value, clue, answer</code>, and an optional last column marking a daily
          double. A header row is fine. Categories become columns in the order they first appear.
        </p>

        <textarea
          className="field mt-3 min-h-[9rem] flex-1 resize-y font-body text-xs"
          placeholder={"STONE\t200\tBlack, veined with gold\tmarble\nMETALS\t200\tAu\tgold"}
          value={text}
          onChange={(e) => parse(e.target.value, "Imported Game")}
        />

        <div className="mt-2 flex items-center gap-2">
          <button className="btn text-xs" onClick={() => file.current?.click()}>
            Choose a file…
          </button>
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (!f) return
              parse(await f.text(), f.name.replace(/\.[^.]+$/, ""))
            }}
          />
          <span className="text-[0.7rem] text-faint">…or paste above</span>
        </div>

        {result && (
          <div className="mt-3 min-h-0 overflow-y-auto">
            {stats ? (
              <div className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-xs text-ink">
                {stats.clues} clues in {stats.categories} categor{stats.categories === 1 ? "y" : "ies"} · values{" "}
                {stats.values.join(", ")}
              </div>
            ) : (
              <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">Nothing importable found.</div>
            )}

            {result.issues.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[0.7rem] text-muted">
                {result.issues.map((i, n) => (
                  <li key={n}>· {i}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            className="btn btn-gold flex-1 py-2 text-xs"
            disabled={!result?.board}
            onClick={() => {
              if (!confirm("Replace the board in the builder with this import?")) return
              onImport(result.board)
              onClose()
            }}
          >
            Replace the board
          </button>
          <button className="btn px-4 py-2 text-xs" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
