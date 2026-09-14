/**
 * Keeping the room code out of the address bar, on the screens a camera sees.
 *
 * Streamer mode withholds the code from the big screen, the scoreboard and the
 * podiums — but every one of those pages was opened with `?code=XXXX` and the
 * code sat in the URL afterwards. On a fullscreen projector or an OBS window
 * capture that is invisible, which is the usual setup and why this was worth
 * shipping without it. It is *not* invisible if somebody captures a whole
 * desktop, or runs the browser windowed with its chrome showing, and a feature
 * whose whole job is "do not put the code on camera" should not leave it
 * somewhere on camera.
 *
 * So once the relay says the code is hidden, the page scrubs its own URL. The
 * code is remembered per page first, because a projector that reloads must come
 * back to the same room rather than to the code prompt.
 *
 * What this cannot do, and is not sold as doing: the host's own desk still
 * shows the code, because the people running the room need it; browser history
 * keeps the original address; and anyone in the room can read it over a
 * shoulder. It closes one specific leak, which is the honest claim.
 */
import { readStore, writeStore } from "./storage"

/** Per page, so the big screen and a spectator tab do not overwrite each other. */
const keyFor = () => `noggin.room${typeof location === "undefined" ? "" : location.pathname}`

/** The code in the URL, if there is one. */
export function codeFromUrl() {
  if (typeof location === "undefined") return ""
  return new URLSearchParams(location.search).get("code")?.toUpperCase() ?? ""
}

/** The code this page was last opened with, for a reload after scrubbing. */
export function rememberedCode() {
  return (readStore(keyFor(), "") ?? "").toUpperCase()
}

/** Where a screen gets its code: the URL first, then what it remembers. */
export const openedWith = () => codeFromUrl() || rememberedCode()

/**
 * Take the code out of the address bar, remembering it first.
 *
 * `replaceState` rather than a navigation: this must not add a history entry
 * or reload the page mid-game. Idempotent, so it can be called from an effect
 * that runs on every projection.
 */
export function scrubCodeFromUrl(code) {
  if (typeof window === "undefined" || !code) return false
  writeStore(keyFor(), code)

  const url = new URL(location.href)
  if (!url.searchParams.has("code")) return false
  url.searchParams.delete("code")
  // `?` left on its own is untidy and, on a screen somebody is looking at, the
  // kind of thing that reads as a bug.
  const search = url.searchParams.toString()
  history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`)
  return true
}
