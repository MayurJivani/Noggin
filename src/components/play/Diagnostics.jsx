/**
 * What this phone is actually doing, on this phone.
 *
 * "The buzzer doesn't work in Safari" has now been reported three times and
 * fixed twice, which means the guessing has to stop. The problem is that the
 * failure only exists on a device nobody debugging it is holding: there is no
 * console, no devtools, and the person reporting it is at a party.
 *
 * So the page can explain itself. `?debug=1` on the join link turns this on: it
 * shows which events the button is receiving, whether the press reached the
 * socket, whether the relay agreed, and which features the browser admits to.
 * A screenshot of it settles the question in one round trip instead of five.
 *
 * It is deliberately not behind a gesture or a menu — an option you have to
 * discover is no use to someone who is already frustrated.
 */
export function Diagnostics({ log, state, me, connected, rtt, wake }) {
  const rows = [
    ["browser", ua()],
    ["pointer events", has("PointerEvent")],
    ["touch events", "ontouchstart" in window ? "yes" : "no"],
    ["wake lock", "wakeLock" in navigator ? (wake.held ? "held" : "supported, not held") : "not supported"],
    ["vibrate", has("navigator.vibrate")],
    ["audio", has("AudioContext")],
    ["socket", connected ? `open · ${rtt ?? "?"}ms` : "DOWN"],
    ["seat", me ? `${me.name} · ${me.score}` : "none"],
    ["phase", state.phase + (state.paused ? " (paused)" : "")],
    ["buzzer", state.buzzer.armed ? "open" : "locked"],
    ["in the race", state.buzzer.order?.some((e) => e.playerId === me?.id) ? "YES" : "no"],
  ]

  return (
    <div className="relative z-10 mx-4 mb-2 rounded-xl border border-live/50 bg-black/60 px-3 py-2">
      <div className="label mb-1 text-live">Diagnostics</div>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-faint">{k}</dt>
            <dd className="truncate text-muted">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-1.5 border-t border-edge pt-1.5">
        <div className="text-[10px] text-faint">
          button events — an arrow is a press that counted. Nothing here at all means the button is not being reached.
        </div>
        <div className="mt-0.5 break-all font-body text-[10px] text-ink">{log.length ? log.join("  ") : "— press it —"}</div>
      </div>
    </div>
  )
}

const has = (path) => {
  try {
    const value = path.split(".").reduce((o, k) => o?.[k], window)
    return value ? "yes" : "no"
  } catch {
    return "no"
  }
}

/** Enough to tell a Safari from a Chrome and a version from a version. */
function ua() {
  const s = navigator.userAgent
  const m =
    /Version\/([\d.]+).*Safari/.exec(s)?.slice(0, 2).join(" ").replace("Version/", "Safari ") ??
    /(CriOS|Chrome)\/([\d.]+)/.exec(s)?.slice(1).join(" ") ??
    /(Firefox)\/([\d.]+)/.exec(s)?.slice(1).join(" ")
  const os = /(iPhone OS|CPU OS) ([\d_]+)/.exec(s)?.[2]?.replace(/_/g, ".") ?? /Android ([\d.]+)/.exec(s)?.[1]
  return [m, os && `on ${os}`].filter(Boolean).join(" ") || s.slice(0, 40)
}
