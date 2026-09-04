import { useCallback, useState } from "react"
import { useCountdown, useRoom } from "../../lib/useRoom"
import { useAuth } from "../../lib/useAuth"
import { nameOf } from "../../lib/sides"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { AuthLoading, SignIn } from "../auth/SignIn"
import { Backdrop } from "../ui/Backdrop"
import { BrandMark } from "../ui/Brand"
import { Operators } from "../ui/Operators"

/**
 * Cue cards: what the host holds.
 *
 * The full desk at `/host` is a workshop — a builder, a roster, a soundboard, a
 * room menu. None of that is any use to someone standing up with a microphone,
 * and all of it is in the way of the two things that are: **the words to read
 * out** and **was that right**.
 *
 * So this is the other half of the original split. The controller at `/control`
 * drives the game in depth; this is the stack of cards the host reads from. Big
 * type, a grid to pick the next clue, and the verdict under a thumb. Everything
 * else is deliberately absent.
 *
 * It joins as a controller — same privileges, same commands, same key — because
 * a second privileged client is a layout problem, not a protocol one.
 */
export function CardsApp() {
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase())
  const [key] = useState(params.get("key") ?? "")
  const [entered, setEntered] = useState(!!params.get("code"))
  const [error, setError] = useState(null)

  const auth = useAuth()
  const { state, connected, send } = useRoom({
    role: "controller",
    surface: "cards",
    code,
    key,
    enabled: entered && !!code && (auth.ready ? !!auth.user || !!key : false),
    onError: (e) => {
      setError(e)
      if (e.code === "auth" || e.code === "no-room" || e.code === "revoked") setEntered(false)
    },
  })

  if (!auth.ready) return <AuthLoading />
  // A key stands in for an account — that is the point of handing one out.
  if (!auth.user && !key) return <SignIn auth={auth} what="pick up the cue cards" />

  if (!entered || !state) {
    return (
      <CodePrompt
        code={code}
        setCode={setCode}
        error={error}
        connecting={entered && !state}
        onGo={() => {
          setError(null)
          setEntered(true)
        }}
      />
    )
  }

  return <CueCards state={state} send={send} connected={connected} />
}

function CueCards({ state, send, connected }) {
  const { phase, clue, board, buzzer } = state
  const now = useCallback(() => Date.now(), [])
  /** The grid, pulled up over a clue when the host wants to see what's left. */
  const [browsing, setBrowsing] = useState(false)

  const onTheHook = buzzer.winner ?? (state.wager ? (state.wager.teamId ?? state.wager.playerId) : null)
  const holderName = nameOf(state, onTheHook)
  const picking = phase === "board" || browsing

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <Backdrop veins={4} glow={2} />

      <header className="relative z-10 flex shrink-0 items-center gap-3 px-4 pt-3">
        <BrandMark className="text-base" />
        <span className="label">cue cards</span>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} />
        {state.paused && <span className="label text-gold">paused</span>}
        <Operators state={state} className="hidden sm:flex" />
        <div className="ml-auto flex items-center gap-3">
          {clue && (
            <button
              className={`btn px-3 py-1 text-[11px] ${browsing ? "btn-gold" : ""}`}
              onClick={() => setBrowsing((v) => !v)}
              title="See what is left on the board"
            >
              Board
            </button>
          )}
          <span className="font-display brass-sm text-lg tracking-[0.2em]">{state.code}</span>
        </div>
      </header>
      <div className="bulbs relative z-10 mx-4 shrink-0" />

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto p-4">
        {picking ? (
          <Grid state={state} send={send} onPick={() => setBrowsing(false)} />
        ) : clue ? (
          <Clue clue={clue} stake={state.stake} revealed={state.revealed} />
        ) : (
          <Resting state={state} send={send} />
        )}
      </main>

      {/* The verdict, always under a thumb. */}
      <footer className="relative z-10 shrink-0 border-t border-edge bg-void/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-3xl space-y-2">
          {holderName ? (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-good py-4 text-base" onClick={() => send("judge", { correct: true })}>
                ✓ {holderName}
              </button>
              <button className="btn btn-bad py-4 text-base" onClick={() => send("judge", { correct: false })}>
                ✕ Wrong
              </button>
            </div>
          ) : (
            <button
              className={`w-full py-4 text-base ${buzzer.armed ? "btn" : "btn btn-gold"}`}
              disabled={phase !== "clue" || state.paused}
              onClick={() => send(buzzer.armed ? "buzzer:lock" : "buzzer:arm")}
            >
              {buzzer.armed ? "Lock the buzzer" : "Open the buzzer"}
              <AnswerClock timer={state.timer} now={now} />
            </button>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button className="btn py-2.5 text-xs" disabled={!state.canUndo} onClick={() => send("judge:undo")}>
              ↩ Undo
            </button>
            <button className="btn py-2.5 text-xs" disabled={!clue || state.revealed} onClick={() => send("clue:reveal")}>
              Reveal
            </button>
            <button className="btn py-2.5 text-xs" disabled={!clue} onClick={() => send("clue:close")}>
              Next clue
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** The clue, at the size someone reads aloud from at arm's length. */
function Clue({ clue, stake, revealed }) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex shrink-0 items-baseline gap-3">
        <span className="label">{clue.category}</span>
        <span className="font-value text-2xl text-gold">{stake}</span>
        {clue.nitro && <span className="text-[11px] text-live">✦ Noggin&rsquo; Nitro</span>}
      </div>

      <p className="mt-4 font-display text-[clamp(20px,3.4vw,34px)] leading-snug text-ink">
        {clue.prompt || <span className="text-faint">(no clue text)</span>}
      </p>

      {clue.media && <MediaHint media={clue.media} />}

      {/* The one thing nobody else in the building can see. */}
      <div className="mt-5 rounded-xl border border-good/50 bg-good/10 px-4 py-3">
        <div className="label mb-1" style={{ color: "var(--color-good)" }}>
          Answer {revealed && "· on screen"}
        </div>
        <div className="font-display text-[clamp(18px,2.8vw,28px)] leading-snug text-ink">
          {clue.answer || <span className="text-faint">(none recorded)</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * Media is *noted*, not played. The big screen is playing it already, and a
 * second copy a second out of step coming from the host's tablet is the last
 * thing the room needs.
 */
function MediaHint({ media }) {
  const label = { image: "▣ picture", audio: "♪ audio", video: "▶ video" }[media.kind] ?? "media"
  return (
    <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
      <span className="rounded-md border border-edge px-2 py-0.5">{label}</span>
      {media.kind === "image" && (
        <img src={resolveMediaUrl(media.url)} alt="" className="max-h-20 rounded-lg border border-edge object-contain" />
      )}
      <span className="text-faint">on the big screen</span>
    </div>
  )
}

/** Pick the next one. The whole point of the tablet, between clues. */
function Grid({ state, send, onPick }) {
  const round = state.board.round
  if (!round) return null
  const live = state.phase === "board"

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="label">{round.name}</span>
        <span className="text-[11px] text-faint">
          {round.categories.reduce((n, c) => n + c.clues.filter((cl) => cl.status !== "played").length, 0)} left
        </span>
        {!live && <span className="ml-auto text-[11px] text-faint">a clue is up — close it to pick another</span>}
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${round.categories.length}, minmax(0, 1fr))` }}>
        {round.categories.map((cat) => (
          <div key={cat.id} className="pb-1 text-center text-[11px] uppercase leading-tight text-muted" title={cat.title}>
            <span className="line-clamp-2">{cat.title || "—"}</span>
          </div>
        ))}
        {round.values.map((_, qi) =>
          round.categories.map((cat, ci) => {
            const clue = cat.clues[qi]
            if (!clue) return <div key={`${ci}-${qi}`} />
            const played = clue.status === "played"
            return (
              <button
                key={clue.id}
                disabled={played || !live}
                onClick={() => {
                  send("clue:select", { catIndex: ci, clueIndex: qi })
                  onPick()
                }}
                className={`relative h-16 rounded-lg font-value text-xl transition-colors ${
                  played
                    ? "bg-black/30 text-gold-dim/40 line-through decoration-gold-dim/30"
                    : live
                      ? "bg-panel-2 text-gold/85 active:bg-royal"
                      : "bg-panel-2 text-gold/40"
                }`}
              >
                {clue.value}
                {clue.nitro && !played && <span className="absolute right-1.5 top-1 text-[0.6rem] text-live">✦</span>}
              </button>
            )
          }),
        )}
      </div>
    </div>
  )
}

/** Lobby, between rounds, and the end. One button each. */
function Resting({ state, send }) {
  const { phase, players } = state
  const leader = players[0]

  return (
    <div className="flex h-full items-center justify-center text-center">
      <div>
        {phase === "lobby" && (
          <>
            <div className="font-display text-2xl text-gold">Ready when you are.</div>
            <p className="mt-2 text-[13px] text-muted">{players.length} joined</p>
            <button className="btn btn-gold mt-5 px-8 py-3 text-base" onClick={() => send("game:start")}>
              Open the board
            </button>
          </>
        )}

        {(phase === "intermission" || phase === "ended") && (
          <>
            <div className="font-display text-2xl text-gold">{phase === "ended" ? "That's the game." : "Round cleared."}</div>
            {leader && (
              <div className="mt-2 text-[13px] text-muted">
                {phase === "ended" ? "Winner: " : "Leading: "}
                <span className="text-ink">{leader.name}</span> on <span className="font-value text-gold">{leader.score}</span>
              </div>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {phase === "intermission" && (
                <button className="btn btn-gold px-6 py-3" onClick={() => send("round:next")}>
                  Start next round
                </button>
              )}
              {state.final?.enabled && (
                <button className="btn btn-gold px-6 py-3" onClick={() => send("final:open")}>
                  ✦ Play the final
                </button>
              )}
            </div>
          </>
        )}

        {phase === "final" && <FinalNotes state={state} send={send} />}
      </div>
    </div>
  )
}

/**
 * The final, from the cue cards: the clue to read, the answer, and whoever is
 * being turned over. The wagers and the running of it stay on the desk.
 */
function FinalNotes({ state, send }) {
  const f = state.final
  if (!f) return null
  const current = (f.players ?? []).find((p) => p.id === f.current)

  return (
    <div className="mx-auto max-w-2xl text-left">
      <div className="label">Final · {f.category || "no category"}</div>

      {f.stage === "wager" ? (
        <>
          <p className="mt-2 text-[13px] text-muted">
            {(f.players ?? []).filter((p) => !p.wagered).length || "no"} still to bet.
          </p>
          <button className="btn btn-gold mt-4 px-6 py-3" onClick={() => send("final:start")}>
            Show the clue
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 font-display text-[clamp(18px,3vw,30px)] leading-snug text-ink">{f.prompt}</p>
          <div className="mt-4 rounded-xl border border-good/50 bg-good/10 px-4 py-3">
            <div className="label mb-1" style={{ color: "var(--color-good)" }}>
              Answer
            </div>
            <div className="font-display text-xl text-ink">{f.answer}</div>
          </div>

          {f.stage === "clue" && (
            <button className="btn btn-gold mt-4 px-6 py-3" onClick={() => send("final:reveal")}>
              Start revealing
            </button>
          )}

          {f.stage === "reveal" && current && (
            <div className="mt-4">
              <div className="font-display text-xl text-gold">{current.name}</div>
              <div className="mt-1 rounded-xl border border-edge bg-black/25 px-3 py-2">
                <div className="font-display text-lg text-ink">{current.answer || <span className="text-faint">nothing written</span>}</div>
                <div className="mt-1 text-[12px] text-muted">
                  staked <span className="font-value text-gold">{current.wager ?? 0}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn btn-good py-3" onClick={() => send("final:judge", { correct: true })}>
                  ✓ Correct
                </button>
                <button className="btn btn-bad py-3" onClick={() => send("final:judge", { correct: false })}>
                  ✕ Wrong
                </button>
              </div>
              <div className="mt-2 text-[11px] text-faint">
                {f.revealIndex + 1} of {f.order.length}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AnswerClock({ timer, now }) {
  const left = useCountdown(timer?.kind === "answer" ? timer.endsAt : null, now)
  if (left == null) return null
  return <span className={`ml-2 font-value tabular-nums ${left < 3000 ? "text-bad" : "text-gold"}`}>{(left / 1000).toFixed(1)}s</span>
}

function CodePrompt({ code, setCode, onGo, error, connecting }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5">
      <Backdrop veins={5} glow={3} />
      <form
        className="relative z-10 w-full max-w-xs space-y-3 text-center"
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim().length >= 3) onGo()
        }}
      >
        <BrandMark className="text-xl" />
        <div className="label pt-2">cue cards</div>
        <input
          className="field text-center font-display text-3xl uppercase tracking-[0.3em]"
          maxLength={4}
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="CODE"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
        <button className="btn btn-gold w-full py-2.5" disabled={code.trim().length < 3 || connecting}>
          {connecting ? "Connecting…" : "Take the cue cards"}
        </button>
        {error && <div className="text-xs text-bad">{error.message}</div>}
      </form>
    </div>
  )
}
