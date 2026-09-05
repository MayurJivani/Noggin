import { useCountdown } from "../../lib/useRoom"
import { resolveMediaUrl } from "../../lib/mediaUrl"
import { VeinLine } from "../ui/Vein"

/**
 * The last clue, on the big screen.
 *
 * Three faces, one per stage. The room is looking straight at this, so it shows
 * exactly as much as the room is allowed to know: a category while the bets go
 * in, the clue while the clock runs, and one player's answer at a time once the
 * host starts turning them over.
 */
export function FinalStage({ state, now }) {
  if (state.final?.kind === "survey") return <SurveyBoard state={state} />
  const f = state.final
  if (!f) return null

  if (f.stage === "wager") return <Wagering final={f} />
  if (f.stage === "clue") return <Writing final={f} timer={state.timer} now={now} />
  return <Revealing final={f} />
}

function Wagering({ final }) {
  const inCents = final.players ?? []
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin] px-[5vmin] text-center">
      <div className="label" style={{ letterSpacing: "0.45em" }}>
        The final clue
      </div>
      <div className="font-display uppercase leading-tight text-gold brass" style={{ fontSize: "max(28px, calc(var(--stage) * 6))" }}>
        {final.category || "Final"}
      </div>
      <VeinLine className="w-[46vmin]" height={20} />
      <div className="text-muted" style={{ fontSize: "max(13px, calc(var(--stage) * 1.6))" }}>
        Place your bets.
      </div>

      <div className="flex max-w-[80vw] flex-wrap justify-center gap-[1.2vmin]">
        {inCents.map((p) => (
          <div
            key={p.id}
            className={`rounded-full border px-[2.4vmin] py-[0.9vmin] font-display transition-colors ${
              p.wagered ? "border-good bg-good/15 text-good" : "border-edge text-faint"
            }`}
            style={{ fontSize: "max(12px, calc(var(--stage) * 1.7))" }}
          >
            {p.name}
            {p.wagered ? " ✓" : " …"}
          </div>
        ))}
        {inCents.length === 0 && <div className="text-sm text-faint">Nobody is in the black — there is nothing to bet.</div>}
      </div>
    </div>
  )
}

function Writing({ final, timer, now }) {
  const left = useCountdown(timer?.kind === "final" ? timer.endsAt : null, now)
  const seconds = left == null ? null : Math.ceil(left / 1000)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2.5vmin] px-[6vmin] text-center">
      <div className="label" style={{ letterSpacing: "0.45em" }}>
        {final.category}
      </div>
      <p
        className="max-w-[42ch] font-display leading-[1.16] text-ink animate-rise"
        style={{ fontSize: `max(22px, calc(var(--stage) * ${Math.max(2.4, 5.2 - (final.prompt?.length ?? 0) / 90)}))` }}
      >
        {final.prompt}
      </p>
      {/* Audio and video were silently dropped here — the builder happily
          accepts either on a final clue, and the big screen showed nothing. */}
      {final.media?.kind === "image" && (
        <img src={resolveMediaUrl(final.media.url)} alt="" className="max-h-[38vh] rounded-[1vmin] border border-gold-deep/30 object-contain" />
      )}
      {final.media?.kind === "video" && (
        <video
          src={resolveMediaUrl(final.media.url)}
          autoPlay
          controls
          playsInline
          className="max-h-[38vh] rounded-[1vmin] border border-gold-deep/30 bg-black object-contain"
        />
      )}
      {final.media?.kind === "audio" && <audio src={resolveMediaUrl(final.media.url)} autoPlay controls className="w-[50vmin]" />}

      {seconds != null && (
        <div
          className={`font-value tabular-nums ${seconds <= 5 ? "text-bad animate-glow" : "text-gold"}`}
          style={{ fontSize: "max(32px, calc(var(--stage) * 7))" }}
        >
          {seconds}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-[1.2vmin]">
        {(final.players ?? []).map((p) => (
          <span
            key={p.id}
            className={`rounded-full border px-[2vmin] py-[0.7vmin] font-display ${
              p.answered ? "border-good/60 text-good" : "border-edge text-faint"
            }`}
            style={{ fontSize: "max(11px, calc(var(--stage) * 1.4))" }}
          >
            {p.name}
            {p.answered ? " ✓" : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

function Revealing({ final }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2vmin] px-[5vmin]">
      <div className="text-center">
        <div className="label" style={{ letterSpacing: "0.4em" }}>
          {final.category}
        </div>
        <p className="mt-[1vmin] max-w-[40ch] font-display leading-tight text-ink" style={{ fontSize: "max(16px, calc(var(--stage) * 2.4))" }}>
          {final.prompt}
        </p>
        {final.answer && (
          <p className="mt-[1.5vmin] font-display text-gold brass" style={{ fontSize: "max(20px, calc(var(--stage) * 4))" }}>
            {final.answer}
          </p>
        )}
      </div>

      <VeinLine className="w-[50vmin]" height={18} />

      <div className="flex w-full max-w-[86vw] flex-col gap-[1vmin]">
        {(final.players ?? []).map((p) => {
          // A player still face-down shows nothing but their name — the whole
          // point of going one at a time.
          const open = p.answer != null
          const verdict = p.judged
          return (
            <div
              key={p.id}
              className={`flex items-center gap-[2vmin] rounded-[1vmin] border px-[2.5vmin] py-[1.2vmin] transition-all duration-500 ${
                verdict === true
                  ? "border-good bg-good/10"
                  : verdict === false
                    ? "border-bad bg-bad/10"
                    : open
                      ? "border-live bg-live/10 animate-slam"
                      : "border-edge/60 opacity-50"
              }`}
            >
              <span className="min-w-[8ch] font-display text-ink" style={{ fontSize: "max(13px, calc(var(--stage) * 2))" }}>
                {p.name}
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-gold" style={{ fontSize: "max(13px, calc(var(--stage) * 2.2))" }}>
                {open ? p.answer || <span className="text-faint">— nothing written —</span> : "…"}
              </span>
              {open && p.wager != null && (
                <span className="font-value tabular-nums text-muted" style={{ fontSize: "max(12px, calc(var(--stage) * 1.8))" }}>
                  {verdict === false ? "−" : verdict === true ? "+" : "±"}
                  {p.wager}
                </span>
              )}
              <span className="font-value tabular-nums text-gold" style={{ fontSize: "max(14px, calc(var(--stage) * 2.4))" }}>
                {p.score}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}


/**
 * The survey board, on the big screen.
 *
 * Numbered slots, blank until they open — the room is guessing at them and the
 * whole tension is not knowing how many are left worth having. A slot flips to
 * its answer and its points, with whoever found it underneath.
 *
 * The strikes are deliberately enormous. They are the only thing on this board
 * that says "that was wrong", they happen fast, and they have to read from the
 * back of a room over the noise of everyone shouting the answer.
 */
function SurveyBoard({ state }) {
  const f = state.final
  const rows = state.teams ?? state.players
  const name = (id) => rows.find((r) => r.id === id)?.name ?? ""
  const slots = f.answers ?? []

  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2vmin] px-[4vmin]">
      <div className="label" style={{ letterSpacing: "0.4em" }}>
        {f.category || "Survey"}
      </div>
      <p className="max-w-[40ch] text-center font-display leading-[1.15] text-ink" style={{ fontSize: "max(18px, calc(var(--stage) * 3.4))" }}>
        {f.prompt}
      </p>

      <div className="grid w-full max-w-[80vmin] gap-[1.2vmin]" style={{ gridTemplateColumns: slots.length > 5 ? "1fr 1fr" : "1fr" }}>
        {slots.map((a) => (
          <div
            key={a.index}
            className={`flex items-center gap-[1.5vmin] rounded-[1vmin] border-[0.3vmin] px-[2vmin] py-[1.2vmin] transition-all duration-500 ${
              a.open ? "border-gold bg-royal/50" : "border-edge bg-black/40"
            }`}
          >
            <span className="font-value tabular-nums text-gold-dim" style={{ fontSize: "max(12px, calc(var(--stage) * 2))" }}>
              {a.index + 1}
            </span>
            {a.open ? (
              <>
                <span className="min-w-0 flex-1 truncate font-display uppercase text-ink animate-slam" style={{ fontSize: "max(13px, calc(var(--stage) * 2.2))" }}>
                  {a.text}
                </span>
                {a.by && (
                  <span className="shrink-0 truncate text-muted" style={{ fontSize: "max(9px, calc(var(--stage) * 1.2))" }}>
                    {name(a.by)}
                  </span>
                )}
                <span className="shrink-0 font-value tabular-nums text-gold brass-sm" style={{ fontSize: "max(15px, calc(var(--stage) * 2.6))" }}>
                  {a.points}
                </span>
              </>
            ) : (
              // A dotted rule rather than an empty box: it reads as "something
              // goes here", which is exactly what the room is working on.
              <span className="min-w-0 flex-1 border-b-[0.25vmin] border-dashed border-edge" style={{ height: "max(14px, calc(var(--stage) * 2.2))" }} />
            )}
          </div>
        ))}
      </div>

      {f.strikes?.length > 0 && (
        <div className="flex gap-[1.5vmin]">
          {f.strikes.map((_, i) => (
            <span key={i} className="font-display text-bad animate-pop" style={{ fontSize: "max(28px, calc(var(--stage) * 5))" }}>
              ✕
            </span>
          ))}
        </div>
      )}

      {f.cleared && (
        <div className="font-display uppercase tracking-[0.3em] text-good animate-glow" style={{ fontSize: "max(14px, calc(var(--stage) * 2.4))" }}>
          Board cleared
        </div>
      )}
    </div>
  )
}
