import { useEffect, useState } from "react"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { Backdrop } from "../ui/Backdrop"
import { Brand } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

/**
 * "We asked a hundred people" — the bit where you ask them.
 *
 * A public page, handed to anyone: colleagues, a group chat, strangers in a
 * queue. No account, no room code to type, no seat taken, and nothing about the
 * game visible — it shows the question and takes an answer, and that is all it
 * can do. The people filling this in are not players and mostly never will be.
 *
 * One answer per visit, with the option to add another, because the useful
 * shape of this is "what's the first thing you think of" and a form that lets
 * someone sit and list eight things skews the board towards whoever is bored.
 */
export function SurveyApp() {
  const [code] = useState(() => (new URLSearchParams(location.search).get("code") ?? "").toUpperCase())
  const [survey, setSurvey] = useState(null)
  const [error, setError] = useState(null)
  const [text, setText] = useState("")
  const [at, setAt] = useState(0)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) return
    fetch(`${getRelayOrigin()}/api/survey?code=${encodeURIComponent(code)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? "That survey isn't open.")
        setSurvey(j)
      })
      .catch((e) => setError(e.message))
  }, [code])

  async function submit(e) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${getRelayOrigin()}/api/survey?code=${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.id, text }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? "That didn't go through.")
      setText("")
      // Straight on to the next one. Five short questions answered in a row is
      // a very different ask from a form with five boxes on it.
      if (at < questions.length - 1) setAt(at + 1)
      else setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!code) return <Shell>This link is missing its survey code.</Shell>
  if (error && !survey) return <Shell>{error}</Shell>
  if (!survey) return <Shell>One moment…</Shell>

  const questions = survey.questions ?? []
  const q = questions[at]
  if (!questions.length) return <Shell>There is nothing to answer yet.</Shell>

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Backdrop veins={6} glow={3} />

      <div className="relative z-10 w-full max-w-md text-center">
        <Brand size="clamp(2.25rem, 7vw, 3.5rem)" />
        <VeinLine className="mx-auto mt-2 w-48" height={16} />

        <div className="panel mt-6 p-6">
          {!survey.open ? (
            <p className="text-[13px] text-muted">This survey has closed. Thanks all the same.</p>
          ) : done ? (
            <div>
              <div className="font-display text-lg text-good">That's all of them — thanks.</div>
              <p className="mt-1 text-[12px] text-muted">Your answers are going onto a game show board.</p>
            </div>
          ) : (
            // Keyed on the question, so moving on looks like a new card
            // arriving rather than the words on the old one changing — the
            // difference between "next question" and "that didn't send".
            <div key={q.id} className="animate-settle">
              <div className="flex items-baseline justify-center gap-2">
                {q.category && (
                  <span className="label" style={{ letterSpacing: "0.3em" }}>
                    {q.category}
                  </span>
                )}
                {questions.length > 1 && (
                  <span className="text-[10px] text-faint">
                    {at + 1} of {questions.length}
                  </span>
                )}
              </div>

              <p className="mt-2 font-display text-[clamp(17px,4.5vw,22px)] leading-snug text-ink">{q.prompt}</p>

            <form onSubmit={submit} className="mt-4">
              <input
                className="field text-center font-display text-lg"
                autoFocus
                maxLength={60}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="First thing you think of"
                aria-label="Your answer"
              />
              <button className="btn btn-gold mt-3 w-full py-3" disabled={!text.trim() || busy}>
                {busy ? "Sending…" : at < questions.length - 1 ? "Next question" : "Send it"}
              </button>
              {error && <div className="mt-2 text-[12px] text-bad">{error}</div>}
            </form>

            {/* Skipping is allowed. A blank forced answer is worse than none. */}
            {at < questions.length - 1 && (
              <button className="mt-2 text-[11px] text-faint transition-colors hover:text-muted" onClick={() => setAt(at + 1)}>
                skip this one
              </button>
            )}
            </div>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          Answers go into a game show board. Nothing here is attached to you, and you don't need an account.
        </p>
      </div>
    </div>
  )
}

function Shell({ children }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-6 text-center">
      <Backdrop veins={5} glow={2} />
      <div className="relative z-10 max-w-sm text-muted">{children}</div>
    </div>
  )
}
