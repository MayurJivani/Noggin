import { useEffect, useState } from "react"
import { CUE_TAKE, TAKES, UI_SFX_ENABLED, ui, unlock, setVolume } from "../../lib/sfx"
import { readJson, writeJson } from "../../lib/storage"
import { Backdrop } from "../ui/Backdrop"
import { Brand } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

/**
 * The listening room.
 *
 * Sound is the one part of this app that cannot be reviewed by reading a diff,
 * so it gets a page. Every cue the game can make is here with the moment it
 * fires, and the ones that exist in two takes are side by side — the only
 * honest way to choose between them is to hear them back to back, which is
 * exactly what a row of two buttons is for.
 *
 * Nothing here touches a room. No relay connection, no code, no state: it makes
 * noises and that is all it can do, which is why it is safe to leave public.
 */

/**
 * The takes, in the order the buttons sit.
 *
 * Ordered plainest first, so pressing left to right walks from what the room
 * hears today to the furthest thing from it — which is the comparison anyone
 * choosing between them is actually making.
 */
const TAKES_UI = [
  ["current", "Current", ""],
  ["v2", "V2", ""],
  ["v3", "V3", ""],
  ["v4", "V4", ""],
  ["gold", "Gold", "btn-gold"],
  ["arcade", "Arcade", "border-amethyst/70 text-amethyst"],
]

const TAKE_LABEL = { current: "Current", v2: "V2", v3: "V3", v4: "V4", gold: "Gold", arcade: "Arcade" }

/** The game's own cues, with the moment each one fires. */
const GAME = [
  ["buzz", "Someone got in first", "The one that matters. Fires with the press."],
  ["reject", "Jumped the gun", "Buzzed before the buzzer opened."],
  ["arm", "The buzzer opens", "Heard by everyone, every clue."],
  ["select", "A tile is picked", ""],
  ["tick", "Last five seconds", "Fires five times in a row — hear it repeated."],
  ["correct", "Right answer", ""],
  ["wrong", "Wrong answer", ""],
  ["reveal", "The answer is shown", ""],
  ["timeUp", "The clock runs out", ""],
  ["nitro", "Noggin' Nitro", ""],
  ["lifeline", "A lifeline is used", ""],
  ["wagerLock", "Wagers are locked", ""],
  ["clueClose", "Back to the board", ""],
  ["undo", "A ruling taken back", ""],
  ["join", "A phone takes a seat", ""],
  ["pause", "The room is held", ""],
  ["resume", "…and let go", ""],
  ["boardOpen", "The board goes up", ""],
  ["roundStart", "A new round", ""],
  ["finalOpen", "Into the final", "Low and long — the room going quiet."],
]

/** The interface layer. New, and off until it is approved. */
const UI = [
  ["tap", "Button", "Fires most often of anything here."],
  ["tab", "Tab switch", ""],
  ["toggleOn", "Toggle on", ""],
  ["toggleOff", "Toggle off", ""],
  ["open", "Panel opens", ""],
  ["close", "Panel closes", ""],
  ["save", "Saved", "A board written down, a clue committed."],
  ["error", "Refused", "Must not be mistakable for a wrong answer."],
  ["nav", "Somewhere new", "A room opened, a screen switched."],
]

/** Where the verdicts live between visits. */
const STORE = "noggin.sound-verdicts"

export function SoundsApp() {
  const [ready, setReady] = useState(false)
  const [vol, setVol] = useState(0.5)
  const [last, setLast] = useState(null)
  /** `{ [cueId]: { pick, note } }` — see the summary at the foot of the page. */
  const [verdicts, setVerdicts] = useState(() => readJson(STORE, {}) ?? {})

  // Kept across visits, because nobody decides twenty cues in one sitting and
  // losing the first fifteen to a refresh is how a review gets abandoned.
  useEffect(() => {
    writeJson(STORE, verdicts)
  }, [verdicts])

  // Browsers will not make a sound until the page has been touched, so the
  // whole page is dead until the first click — say so rather than letting
  // someone press eight buttons in silence and conclude it is broken.
  useEffect(() => {
    const go = () => {
      unlock()
      setReady(true)
    }
    window.addEventListener("pointerdown", go, { once: true })
    return () => window.removeEventListener("pointerdown", go)
  }, [])

  useEffect(() => {
    setVolume(vol)
  }, [vol])

  function play(label, fn) {
    unlock()
    setReady(true)
    setLast(label)
    fn?.()
  }

  const set = (id, patch) => setVerdicts((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
  const decided = Object.values(verdicts).filter((v) => v?.pick).length

  return (
    <div className="relative min-h-dvh px-5 py-10">
      <Backdrop veins={7} glow={3} />

      <div className="relative z-10 mx-auto w-full max-w-3xl">
        <header className="text-center">
          <Brand size="clamp(2rem, 6vw, 3rem)" />
          <VeinLine className="mx-auto mt-2 w-56" height={16} />
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Every noise the game can make. Press one to hear it.
          </p>
          {!ready && <p className="mt-1 text-[11px] text-live">Click anywhere first — browsers keep audio shut until you do.</p>}
        </header>

        <div className="panel mt-6 flex items-center gap-4 p-4">
          <span className="label shrink-0">Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={vol}
            onChange={(e) => setVol(Number(e.target.value))}
            className="w-full accent-gold"
            aria-label="Volume"
          />
          <span className="w-10 shrink-0 text-right font-value tabular-nums text-gold">{Math.round(vol * 100)}</span>
        </div>

        <Section
          title="The game"
          note={
            <>
              Six takes of each, all synthesised, so all six land the instant they fire.
              <br />
              <b className="text-ink">Current · V2 · V3 · V4</b> are one family — the same squares, triangles and filtered
              noise, differing in production rather than material. Current is the original. V2 is it made properly: an
              onset, a body of two detuned voices, sub weight where the room reacts. <b className="text-ink">V3</b> is V2
              tightened — shorter and brighter, for a hall where a long tail smears into the next thing.{" "}
              <b className="text-ink">V4</b> is V2 warmed — longer and lower, for a living room.
              <br />
              <b className="text-gold">Gold</b> and <b className="text-amethyst">Arcade</b> change the material instead:
              struck bells and brass, and a chip blip with a gold tail.
              {" "}Live now: <b className="text-ink">{TAKE_LABEL[CUE_TAKE] ?? "Current"}</b>.
            </>
          }
        >
          {GAME.map(([id, label, when]) => (
            <li key={id} className="flex flex-wrap items-center gap-2 border-b border-edge/60 py-2 last:border-0">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <div className="truncate font-display text-[14px] text-ink">{label}</div>
                {when && <div className="truncate text-[11px] text-faint">{when}</div>}
              </div>
              {TAKES_UI.map(([take, name, cls]) => (
                <button
                  key={take}
                  // The family is separated from the other two by a gap rather
                  // than a heading: six buttons in a row is already a lot, and
                  // the eye needs to know which four are variations on one
                  // thing before it starts comparing them.
                  className={`btn shrink-0 px-2.5 py-1.5 text-[12px] disabled:opacity-30 ${cls} ${
                    take === "gold" ? "ml-3" : ""
                  } ${verdicts[id]?.pick === take ? "ring-2 ring-good ring-offset-1 ring-offset-panel" : ""}`}
                  disabled={!TAKES[take]?.[id]}
                  onClick={() => play(`${label} · ${name.toLowerCase()}`, TAKES[take][id])}
                >
                  {name}
                </button>
              ))}
              <Verdict
                id={id}
                value={verdicts[id]}
                onChange={(patch) => set(id, patch)}
                options={TAKES_UI.map(([take, name]) => [take, `✓ ${name}`])}
              />
            </li>
          ))}
        </Section>

        <Section
          title="The interface"
          note={
            <>
              New, and <b className="text-live">switched off</b> until you say otherwise. These fire on the host desk rather
              than in the room, so they are a fifth the volume of a game cue — the test is not whether one sounds good alone
              but whether you could press it two hundred times in an evening.
              {UI_SFX_ENABLED && <b className="text-good"> Currently on.</b>}
            </>
          }
        >
          {UI.map(([id, label, when]) => (
            <li key={id} className="flex items-center gap-3 border-b border-edge/60 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[14px] text-ink">{label}</div>
                {when && <div className="truncate text-[11px] text-faint">{when}</div>}
              </div>
              {/* Straight at `ui`, not through `playUi` — the point of this page
                  is to hear cues that are not switched on yet. */}
              <button className="btn shrink-0 px-3 py-1.5 text-[12px]" onClick={() => play(label, ui[id])}>
                Play
              </button>
              <Verdict
                id={`ui:${id}`}
                value={verdicts[`ui:${id}`]}
                onChange={(patch) => set(`ui:${id}`, patch)}
                options={[["keep", "✓ Keep"]]}
              />
            </li>
          ))}
        </Section>

        <Summary verdicts={verdicts} onClear={() => setVerdicts({})} decided={decided} />

        <div className="panel mt-6 p-5 text-[12px] leading-relaxed text-muted">
          <div className="label mb-2">What is still missing</div>
          <p>
            Everything above is generated on the spot by the browser. The applause, the drumroll, the airhorn and the music
            bed cannot be — an oscillator can imitate a bell, but a synthesised crowd is static with ambitions — so the
            soundboard stays off until real recordings are chosen. That is a licensing decision as much as a taste one:
            whatever goes in ships to every phone in the room.
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-faint">
          {last ? (
            <>
              Last played: <span className="text-muted">{last}</span>
            </>
          ) : (
            "Nothing played yet."
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * One row's verdict: which take, or send it back.
 *
 * A native `<select>` on purpose. It holds five mutually exclusive states in
 * the width of a word, it is reachable by keyboard and screen reader without
 * my writing any of that, and on a phone — which is where a lot of this will
 * be reviewed, because that is where the buzzer lives — it opens the platform's
 * own picker instead of a custom menu I would have had to make work on iOS.
 */
function Verdict({ id, value, onChange, options }) {
  const pick = value?.pick ?? ""
  return (
    <>
      <select
        className="field shrink-0 !w-auto !py-1 text-[12px]"
        value={pick}
        aria-label={`Verdict for ${id}`}
        onChange={(e) => onChange({ pick: e.target.value || undefined })}
      >
        <option value="">— undecided</option>
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        <option value="rework">✎ Rework</option>
      </select>

      {/* Only for a rework, and optional even then. "This one's wrong" is
          already useful; being made to explain why is what stops people
          saying it. */}
      {pick === "rework" && (
        <input
          className="field basis-full text-[12px]"
          placeholder="What's wrong with it? (optional)"
          value={value?.note ?? ""}
          aria-label={`Note for ${id}`}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      )}
    </>
  )
}

/** Every label on the page, by cue id, for the summary to read back. */
const LABELS = {
  ...Object.fromEntries(GAME.map(([id, label]) => [id, label])),
  ...Object.fromEntries(UI.map(([id, label]) => [`ui:${id}`, `${label} (interface)`])),
}

/**
 * The verdicts, as something you can hand back.
 *
 * The page has no relay connection by design, so there is nowhere for it to
 * *send* anything — which leaves copy and paste, and that turns out to be the
 * honest answer anyway: the person deciding this is talking to whoever changes
 * the code, and a block of text is what that conversation takes.
 *
 * The textarea is the primary path rather than a fallback. This page gets
 * opened on a phone at `http://192.168.…`, which is not a secure context, and
 * `navigator.clipboard` simply does not exist there — a Copy button alone would
 * be dead exactly where it is most needed.
 */
function Summary({ verdicts, onClear, decided }) {
  const [copied, setCopied] = useState(false)

  const lines = Object.entries(verdicts)
    .filter(([, v]) => v?.pick)
    .map(([id, v]) => {
      const label = LABELS[id] ?? id
      const note = v.pick === "rework" && v.note?.trim() ? ` — ${v.note.trim()}` : ""
      return `- ${label} [${id}] → ${v.pick}${note}`
    })

  const text = lines.length ? `NOGGIN' sound review\n\n${lines.join("\n")}\n` : ""

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // No clipboard here. The textarea below is already the answer.
      setCopied(false)
    }
  }

  return (
    <section className="panel mt-6 p-5">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-lg text-gold brass-sm">Your verdicts</h2>
        <span className="text-[11px] text-faint">{decided} decided</span>
        {decided > 0 && (
          <button className="ml-auto text-[11px] text-faint transition-colors hover:text-bad" onClick={onClear}>
            clear all
          </button>
        )}
      </div>

      {!decided ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Nothing decided yet. Set a verdict on any row above — pick the take you want kept, or mark it for rework and say
          what's wrong. Choices are remembered on this device, so you can do it in more than one sitting.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Copy this and paste it back. Anything you left undecided is left out rather than guessed at.
          </p>
          <textarea
            className="field mt-3 h-40 w-full resize-y font-mono text-[11px] leading-relaxed"
            readOnly
            value={text}
            aria-label="Your verdicts, as text"
            onFocus={(e) => e.target.select()}
          />
          <button className="btn btn-gold mt-2 px-4 py-1.5 text-[12px]" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      )}
    </section>
  )
}

function Section({ title, note, children }) {
  return (
    <section className="panel mt-6 p-5">
      <h2 className="font-display text-lg text-gold brass-sm">{title}</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{note}</p>
      <ul className="mt-3">{children}</ul>
    </section>
  )
}
