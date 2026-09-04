import { useEffect, useMemo, useRef, useState } from "react"
import { useRoom } from "../../lib/useRoom"
import { useAuth } from "../../lib/useAuth"
import { resolveMediaUrl, stripToRelayPath, uploadMedia } from "../../lib/mediaUrl"
import { BOARD_CUES, playCue, unlock } from "../../lib/sfx"
import {
  COLOR_GROUPS,
  COLOR_LABELS,
  DEFAULT_COLORS,
  DEFAULT_FONTS,
  FONT_CHOICES,
  FONT_SLOTS,
  tidyTheme,
  themeIsSet,
} from "../../lib/theme"
import { AuthLoading, SignIn } from "../auth/SignIn"
import { Backdrop } from "../ui/Backdrop"
import { Brand, BrandMark } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

/**
 * Make the room your own.
 *
 * Everything here is a *diff against the house look*: a field left alone is not
 * "black" or "Righteous", it is absent, and the default flows through. That is
 * what makes this safe to ship — a room that changed one colour keeps every
 * other decision the design makes, including ones made after tonight.
 *
 * It edits live. There is no save button because there is nothing to lose: each
 * change goes to the relay and out to every screen in the room at once, which
 * is also the only honest preview — the big screen is thirty feet away and a
 * swatch on a laptop has never once predicted what gold looks like on a
 * projector.
 */
export function ThemeApp() {
  const auth = useAuth()
  const [code] = useState(() => (new URLSearchParams(location.search).get("code") ?? "").toUpperCase())
  const [banner, setBanner] = useState(null)

  const { state, connected, send } = useRoom({
    role: "host",
    code,
    enabled: !!code && auth.ready && !!auth.user,
    onError: (e) => setBanner(e.message),
  })

  if (!auth.ready) return <AuthLoading />
  if (!auth.user) return <SignIn auth={auth} what="customise a room" />
  if (!code) return <Missing />
  if (!state) return <Waiting connected={connected} banner={banner} />

  return <Editor state={state} send={send} code={code} banner={banner} connected={connected} />
}

function Editor({ state, send, code, banner, connected }) {
  /*
    The editor holds the theme it is editing and sends the whole thing.

    A patch protocol would need both ends to agree on what "unset" means, and
    they would eventually disagree — this way `null` is a reset and there is
    nothing to get out of step.
  */
  const theme = state.theme ?? {}
  const push = (next) => send("theme:set", { theme: tidyTheme(next) })

  const setColor = (key, value) => {
    const colors = { ...(theme.colors ?? {}) }
    if (value) colors[key] = value
    else delete colors[key]
    push({ ...theme, colors })
  }

  const setFont = (slot, font) => {
    const fonts = { ...(theme.fonts ?? {}) }
    if (font) fonts[slot] = font
    else delete fonts[slot]
    push({ ...theme, fonts })
  }

  const setSound = (id, url) => {
    const sounds = { ...(theme.sounds ?? {}) }
    if (url) sounds[id] = url
    else delete sounds[id]
    push({ ...theme, sounds })
  }

  const changed = themeIsSet(theme)

  return (
    <div className="relative min-h-dvh">
      <Backdrop veins={5} glow={3} />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <BrandMark className="text-lg" />
        <span className="label">customise</span>
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-bad animate-glow"}`} />
        <div className="ml-auto flex items-center gap-3">
          <span className="font-display brass-sm text-lg tracking-[0.2em]">{code}</span>
          <a className="btn text-[11px]" href={`/host?code=${code}`}>
            ← Back to the desk
          </a>
          <button
            className="btn text-[11px] hover:border-bad hover:text-bad"
            disabled={!changed}
            onClick={() => confirm("Put this room back to the house look?") && push(null)}
          >
            Reset all
          </button>
        </div>
      </header>
      <div className="bulbs relative z-10 mx-4" />

      {banner && (
        <div className="relative z-10 mx-auto mt-2 max-w-6xl rounded-lg border border-bad/50 bg-bad/10 px-3 py-1.5 text-[12px] text-bad">{banner}</div>
      )}

      <main className="relative z-10 mx-auto grid w-full max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,26rem)]">
        <div className="min-w-0 space-y-4">
          <Colours theme={theme} setColor={setColor} />
          <Fonts theme={theme} setFont={setFont} />
          <Sounds theme={theme} setSound={setSound} />
        </div>

        <div className="min-w-0">
          <div className="lg:sticky lg:top-4">
            <Preview />
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Changes are live on every screen in the room the moment you make them — this page has no save button because there is
              nothing waiting to be saved. Anything you don't touch keeps the house look.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Colours ──────────────────────────────────────────────────────────────────

function Colours({ theme, setColor }) {
  return (
    <section className="panel p-4">
      <div className="label mb-1">Colours</div>
      <p className="mb-3 text-[11px] text-faint">Click a swatch to change it. The dot marks one you've changed.</p>

      <div className="space-y-4">
        {COLOR_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-ink">{group.title}</span>
              <span className="text-[10px] text-faint">{group.hint}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {group.keys.map((key) => (
                <Swatch key={key} name={key} value={theme.colors?.[key]} onChange={(v) => setColor(key, v)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Swatch({ name, value, onChange }) {
  const current = value ?? DEFAULT_COLORS[name]
  const custom = !!value
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-edge px-2 py-1.5 transition-colors hover:border-gold-dim">
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-edge" style={{ background: current }}>
        <input
          type="color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={current.slice(0, 7)}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-ink">{COLOR_LABELS[name] ?? name}</span>
        <span className="block font-body text-[9px] uppercase text-faint">{current}</span>
      </span>
      {custom && (
        <button
          className="shrink-0 text-[10px] text-faint transition-colors hover:text-bad"
          title="Back to the default"
          onClick={(e) => {
            e.preventDefault()
            onChange(null)
          }}
        >
          ↺
        </button>
      )}
    </label>
  )
}

// ── Fonts ────────────────────────────────────────────────────────────────────

function Fonts({ theme, setFont }) {
  return (
    <section className="panel p-4">
      <div className="label mb-1">Fonts</div>
      <p className="mb-3 text-[11px] text-faint">
        Pick a hosted family, or upload a file — <span className="text-muted">.woff2</span>, <span className="text-muted">.woff</span>,{" "}
        <span className="text-muted">.ttf</span> or <span className="text-muted">.otf</span>.
      </p>

      <div className="space-y-3">
        {FONT_SLOTS.map((slot) => (
          <FontRow key={slot.id} slot={slot} font={theme.fonts?.[slot.id]} onChange={(f) => setFont(slot.id, f)} />
        ))}
      </div>
    </section>
  )
}

function FontRow({ slot, font, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  const current = font?.name ?? DEFAULT_FONTS[slot.id]

  async function upload(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const url = stripToRelayPath(await uploadMedia(file))
      // The family name is the filename, which is a guess — but it is a name
      // nobody has to type, and it only ever has to be unique to this room.
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[^\w \-]/g, "") || "Custom"
      onChange({ name, url, google: false })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-edge p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-ink">{slot.label}</span>
        <span className="text-[10px] text-faint">{slot.hint}</span>
        {font && (
          <button className="ml-auto text-[10px] text-faint transition-colors hover:text-bad" onClick={() => onChange(null)}>
            ↺ default
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          className="field min-w-0 flex-1 py-1 text-[12px]"
          value={font?.google ? font.name : font ? "__file" : ""}
          onChange={(e) => {
            const v = e.target.value
            if (v === "") onChange(null)
            else if (v !== "__file") onChange({ name: v, url: null, google: true })
          }}
        >
          <option value="">{DEFAULT_FONTS[slot.id]} (default)</option>
          {FONT_CHOICES[slot.id]
            .filter((f) => f !== DEFAULT_FONTS[slot.id])
            .map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          {font && !font.google && <option value="__file">{font.name} (uploaded)</option>}
        </select>

        <button className="btn px-2.5 py-1 text-[11px]" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          hidden
          onChange={(e) => {
            upload(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </div>

      {/* Set in the slot's own family, so the choice shows itself. */}
      <div className="mt-2 truncate text-[20px] text-ink" style={{ fontFamily: `var(--font-${slot.id})` }}>
        {slot.id === "value" ? "1200 · 4000 · −800" : "Noggin’ Quiz Night"}
      </div>
      <div className="text-[10px] text-faint">{current}</div>
      {error && <div className="mt-1 text-[10px] text-bad">{error}</div>}
    </div>
  )
}

// ── Sounds ───────────────────────────────────────────────────────────────────

/** The bed is a cue like any other as far as storage goes, but it loops. */
const SOUND_ROWS = [...BOARD_CUES, { id: "music", label: "Music bed", icon: "♪" }]

function Sounds({ theme, setSound }) {
  const chosen = Object.keys(theme.sounds ?? {}).length

  return (
    <section className="panel p-4">
      <div className="label mb-1">Sounds</div>
      <p className="mb-3 text-[11px] leading-relaxed text-faint">
        Upload an MP3 for any of these and it becomes this room's. Anything left empty falls back to the built-in sound, and failing
        that to a synthesised stand-in — so a partial set is perfectly fine.
        {chosen > 0 && <span className="text-muted"> {chosen} chosen.</span>}
      </p>

      <div className="space-y-1.5">
        {SOUND_ROWS.map((cue) => (
          <SoundRow key={cue.id} cue={cue} url={theme.sounds?.[cue.id]} onChange={(u) => setSound(cue.id, u)} />
        ))}
      </div>
    </section>
  )
}

function SoundRow({ cue, url, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  const audio = useRef(null)

  async function upload(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onChange(stripToRelayPath(await uploadMedia(file)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${url ? "border-gold-deep/50 bg-royal/25" : "border-edge"}`}>
      <span className="w-5 shrink-0 text-center text-[14px] leading-none">{cue.icon}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{cue.label}</span>

      {url ? (
        <>
          <audio ref={audio} src={resolveMediaUrl(url)} preload="none" className="hidden" />
          <button
            className="btn px-2 py-0.5 text-[10px]"
            title="Hear it"
            onClick={() => {
              audio.current.currentTime = 0
              audio.current.play().catch(() => {})
            }}
          >
            ▶
          </button>
          <button className="btn px-2 py-0.5 text-[10px] hover:border-bad hover:text-bad" title="Back to the default" onClick={() => onChange(null)}>
            ✕
          </button>
        </>
      ) : (
        <>
          {/* The stand-in, so you can hear what you'd be replacing. */}
          <button
            className="btn px-2 py-0.5 text-[10px]"
            title="Hear the current sound"
            onClick={() => {
              unlock()
              if (cue.id !== "music") playCue(cue.id)
            }}
            disabled={cue.id === "music"}
          >
            ▶
          </button>
          <button className="btn px-2 py-0.5 text-[10px]" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "…" : "Upload"}
          </button>
        </>
      )}

      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.m4a,.ogg,.wav"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      {error && <span className="shrink-0 text-[10px] text-bad">{error}</span>}
    </div>
  )
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * A miniature of the things the colours actually have to work on.
 *
 * Built from the same utilities as the real screens, so it is not a mock — it
 * is the design, small. Whatever it does here is what the big screen will do.
 */
function Preview() {
  const values = useMemo(() => [200, 400, 600], [])
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-edge px-4 py-2">
        <span className="label">Preview</span>
      </div>

      <div className="space-y-3 bg-void/60 p-4">
        <div className="flex items-center justify-center">
          <Brand size={44} />
        </div>
        <VeinLine className="mx-auto w-2/3" height={14} />

        <div className="grid grid-cols-3 gap-1.5">
          {["STONE", "GOLD", "MOBIZ"].map((c) => (
            <div key={c} className="truncate text-center text-[9px] uppercase text-muted">
              {c}
            </div>
          ))}
          {values.map((v) =>
            [0, 1, 2].map((i) => (
              <div
                key={`${v}-${i}`}
                className={`rounded py-2 text-center font-value text-lg ${i === 1 && v === 400 ? "bg-gold text-onyx" : "bg-panel-2 text-gold/85"}`}
              >
                {v}
              </div>
            )),
          )}
        </div>

        <div className="rounded-lg border border-gold-deep/45 bg-gradient-to-b from-onyx/95 to-void/95 p-3">
          <div className="font-display text-[13px] leading-snug text-ink">Black, veined with gold</div>
          <div className="mt-2 font-display text-base text-gold brass">marble</div>
        </div>

        <div className="flex gap-1.5">
          <div className="flex-1 rounded-lg border border-live bg-live/15 px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase text-ink/90">Buzzed</div>
            <div className="font-value text-lg text-gold">1200</div>
          </div>
          <div className="flex-1 rounded-lg border border-good/50 bg-good/10 px-2 py-1.5 text-center text-[10px] text-good">Correct</div>
          <div className="flex-1 rounded-lg border border-bad/50 bg-bad/10 px-2 py-1.5 text-center text-[10px] text-bad">Wrong</div>
        </div>
      </div>
    </section>
  )
}

// ── Shells ───────────────────────────────────────────────────────────────────

function Missing() {
  return (
    <Shell>
      <div className="space-y-3">
        <div className="text-muted">A theme belongs to a room, so this page needs one.</div>
        <a className="btn btn-gold" href="/host">
          Open the host desk
        </a>
      </div>
    </Shell>
  )
}

function Waiting({ connected, banner }) {
  return <Shell>{banner ?? (connected ? "Opening the room…" : "Looking for the room…")}</Shell>
}

function Shell({ children }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-6 text-center">
      <Backdrop veins={5} glow={2} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
