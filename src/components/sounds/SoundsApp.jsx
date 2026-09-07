import { useEffect, useState } from "react"
import { ALT, CUE_TAKE, PLAIN, UI_SFX_ENABLED, ui, unlock, setVolume } from "../../lib/sfx"
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

export function SoundsApp() {
  const [ready, setReady] = useState(false)
  const [vol, setVol] = useState(0.5)
  const [last, setLast] = useState(null)

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
              Two takes of each. <b className="text-ink">Current</b> is what ships today — square waves and filtered noise,
              plain and legible. <b className="text-gold">Gold</b> is the same cue built from struck bells and brass, to match
              what the app looks like. Both are synthesised, so both land the instant they fire.
              {" "}Live now: <b className="text-ink">{CUE_TAKE === "gold" ? "Gold" : "Current"}</b>.
            </>
          }
        >
          {GAME.map(([id, label, when]) => (
            <li key={id} className="flex items-center gap-3 border-b border-edge/60 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[14px] text-ink">{label}</div>
                {when && <div className="truncate text-[11px] text-faint">{when}</div>}
              </div>
              <button className="btn shrink-0 px-3 py-1.5 text-[12px]" onClick={() => play(`${label} · current`, PLAIN[id])}>
                Current
              </button>
              <button
                className="btn btn-gold shrink-0 px-3 py-1.5 text-[12px] disabled:opacity-30"
                disabled={!ALT[id]}
                onClick={() => play(`${label} · gold`, ALT[id])}
              >
                Gold
              </button>
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
            </li>
          ))}
        </Section>

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

function Section({ title, note, children }) {
  return (
    <section className="panel mt-6 p-5">
      <h2 className="font-display text-lg text-gold brass-sm">{title}</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{note}</p>
      <ul className="mt-3">{children}</ul>
    </section>
  )
}
