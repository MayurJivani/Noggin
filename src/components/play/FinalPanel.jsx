import { useEffect, useState } from "react"
import { useCountdown } from "../../lib/useRoom"

/**
 * The final clue, in your hand.
 *
 * Two jobs, in order: stake something before you know the question, then write
 * an answer against a clock. Both are private — the relay never shows either to
 * another player until the host turns you over — so this is the only screen
 * where a player has something nobody else can see.
 */
export function FinalPanel({ state, me, send }) {
  const f = state.final
  // `state.unit` is the side being scored — the player on a normal night, their
  // team on a team one — and the final is keyed by whoever gets paid.
  const mine = f?.players?.find((p) => p.id === (state.unit ?? me?.id))
  const [wager, setWager] = useState("")
  const [answer, setAnswer] = useState("")
  const [sent, setSent] = useState(false)
  const left = useCountdown(state.timer?.kind === "final" ? state.timer.endsAt : null, () => Date.now())

  useEffect(() => {
    if (mine?.wager != null) setWager(String(mine.wager))
  }, [mine?.wager])

  if (!f) return null

  // Out of the running: nothing to stake, so nothing to do but watch.
  if (!mine) {
    return (
      <Card>
        <div className="text-center text-sm text-muted">
          The final is for players in the black. Sit this one out — you're still in the game.
        </div>
      </Card>
    )
  }

  if (f.stage === "wager") {
    const max = mine.score
    const value = Math.max(0, Math.min(Number(wager) || 0, max))
    return (
      <Card>
        <div className="label">{f.category || "Final"}</div>
        <p className="mt-1 text-xs text-muted">
          Bet anything up to <span className="font-value text-gold">{max}</span>. You cannot see the clue yet.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="field w-0 flex-1 text-center font-value text-2xl"
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            value={wager}
            onChange={(e) => setWager(e.target.value)}
          />
          <button className="btn shrink-0 px-3" onClick={() => setWager(String(max))}>
            all in
          </button>
        </div>
        <button className="btn btn-gold mt-2 w-full py-3" onClick={() => send("final:wager", { amount: value })}>
          {mine.wager != null ? `Bet locked: ${mine.wager} — change it` : "Place bet"}
        </button>
        {mine.wager != null && <div className="mt-1.5 text-center text-xs text-good">In. Waiting for everyone else…</div>}
      </Card>
    )
  }

  if (f.stage === "clue") {
    const locked = sent || (left != null && left <= 0)
    return (
      <Card>
        <div className="flex items-baseline gap-2">
          <div className="label">{f.category}</div>
          {left != null && (
            <span className={`ml-auto font-value text-lg tabular-nums ${left < 6000 ? "text-bad" : "text-gold"}`}>
              {Math.ceil(left / 1000)}
            </span>
          )}
        </div>
        <p className="mt-1 font-display text-[15px] leading-snug text-ink">{f.prompt}</p>
        <input
          className="field mt-3 text-center font-display text-lg"
          placeholder="Your answer"
          value={answer}
          disabled={locked}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            // Send as they type as well, so a player who runs out of time still
            // has whatever they had written counted.
            if (e.key === "Enter") {
              send("final:answer", { text: answer })
              setSent(true)
            }
          }}
          onBlur={() => answer && send("final:answer", { text: answer })}
        />
        <button
          className="btn btn-gold mt-2 w-full py-3"
          disabled={locked}
          onClick={() => {
            send("final:answer", { text: answer })
            setSent(true)
          }}
        >
          {locked ? "Locked in" : "Lock in answer"}
        </button>
        <div className="mt-1.5 text-center text-xs text-faint">Staked {mine.wager ?? 0}</div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="label">{f.category}</div>
      <p className="mt-1 font-display text-sm text-ink">{f.prompt}</p>
      {f.answer && <p className="mt-2 font-display text-base text-gold">{f.answer}</p>}
      <div className="mt-2 text-xs text-muted">
        You said <span className="text-ink">{mine.answer || "nothing"}</span> for {mine.wager ?? 0}.
      </div>
      {mine.judged != null && (
        <div className={`mt-1 text-sm font-semibold ${mine.judged ? "text-good" : "text-bad"}`}>
          {mine.judged ? "Correct" : "Not this time"} — {mine.score}
        </div>
      )}
    </Card>
  )
}

const Card = ({ children }) => <div className="relative z-10 mx-4 mt-3 rounded-xl border border-gold-dim/40 bg-black/30 px-3 py-3">{children}</div>
