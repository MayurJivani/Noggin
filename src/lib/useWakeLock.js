import { useEffect, useRef, useState } from "react"

/**
 * Keep the screen awake.
 *
 * A phone locks itself after thirty seconds, and a locked phone is a player who
 * cannot buzz — they have to wake it, unlock it, and find the tab, by which
 * point the clue is over. This is the single most avoidable way to lose a race,
 * and it happens to somebody every single game.
 *
 * Two mechanisms, in order of preference:
 *
 * 1. **The Wake Lock API** — Chrome/Android since 84, Safari since 16.4. The
 *    right answer, and the only one that costs nothing.
 * 2. **A muted looping video** — the old trick, for iOS 16.3 and earlier. A
 *    phone will not sleep while it believes it is playing something. It is a
 *    64x64 black frame on a loop, inlined below, and it only runs when the API
 *    is genuinely absent.
 *
 * The subtlety that makes or breaks this: **a wake lock is released for you the
 * moment the page is hidden**, and it does not come back on its own. Every
 * implementation that forgets to re-request on `visibilitychange` works
 * perfectly until the first time someone glances at a notification, and then
 * quietly stops. So the sentinel is re-acquired on every return to visibility,
 * and `held` reflects what is actually true rather than what was asked for.
 */

/** One black frame, looped. Generated with ffmpeg; ~1.5KB. */
const KEEP_AWAKE_CLIP =
  "data:video/mp4;base64," +
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMVbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAA" +
  "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA" +
  "AkB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA" +
  "AAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG4bWRpYQAAACBtZGhk" +
  "AAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABY21p" +
  "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASNzdGJsAAAAv3N0c2QA" +
  "AAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4" +
  "MjY0AAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwAIPEiWWAEABmjr48siwP34+AAAAAAQ" +
  "cGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAWuAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAQAAQAAAAAAcc3RzYwAAAAAAAAABAAAA" +
  "AQAAAAEAAAABAAAAFHN0c3oAAAAAAAAC1wAAAAEAAAAUc3RjbwAAAAAAAAABAAADRQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhk" +
  "bHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAAAI" +
  "ZnJlZQAAAt9tZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQv" +
  "TVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAt" +
  "IG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9" +
  "MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBj" +
  "cW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTIgbG9va2FoZWFkX3Ro" +
  "cmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0" +
  "cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEg" +
  "b3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJj" +
  "X2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00" +
  "IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAiZYiEABX//vfJ78Cm69vetb+Tz0j4e8ZQD6wZq+vbSH/7MQ=="

/**
 * The mechanism, with no React in it.
 *
 * Pulled out deliberately: the part that goes wrong is "re-acquire when the
 * page comes back", and that is a state machine, not a rendering concern. As a
 * plain function it can be driven by a test with a stub document — which is the
 * only way to be sure the re-acquisition actually happens, since the failure is
 * invisible until someone glances at a notification mid-game.
 */
export function createWakeLock({ onChange = () => {}, doc = globalThis.document, nav = globalThis.navigator } = {}) {
  let stopped = false
  let sentinel = null
  let video = null

  const supported = !!nav && "wakeLock" in nav

  /** The old trick: a phone will not sleep while it thinks it is playing. */
  const startVideo = () => {
    if (video || !doc) return
    const v = doc.createElement("video")
    v.src = KEEP_AWAKE_CLIP
    v.loop = true
    v.muted = true
    v.playsInline = true
    v.setAttribute("playsinline", "")
    v.setAttribute("aria-hidden", "true")
    // Not `display: none` — a hidden video is allowed to be dropped, which is
    // exactly the thing being prevented. One transparent pixel, out of the way.
    v.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0"
    doc.body.appendChild(v)
    video = v
    Promise.resolve(v.play()).then(
      () => onChange(true),
      () => onChange(false),
    )
  }

  const acquire = async () => {
    if (stopped || !doc || doc.visibilityState !== "visible") return
    if (!supported) return startVideo()
    /*
      Ask the sentinel whether it is still a sentinel.

      Relying on the `release` event to clear this is the fragile version: if
      the browser fires it late, or not at all, we would sit on a dead handle
      believing we still held the screen and never ask again. `released` is a
      plain boolean on the object, so it can simply be checked at the one moment
      that matters.
    */
    if (sentinel && !sentinel.released) return
    sentinel = null
    try {
      const s = await nav.wakeLock.request("screen")
      if (stopped) return void s.release?.()
      sentinel = s
      onChange(true)
      // The browser drops it when the page hides and says so here. Without
      // this we would keep claiming a lock that no longer exists.
      s.addEventListener?.("release", () => {
        if (sentinel === s) sentinel = null
        onChange(false)
      })
    } catch {
      // Refused — no gesture yet, low battery, or a policy. Not worth shouting
      // about; the caller shows a hint from the reported state.
      onChange(false)
    }
  }

  const onVisible = () => {
    if (doc.visibilityState === "visible") acquire()
  }

  doc?.addEventListener("visibilitychange", onVisible)
  globalThis.window?.addEventListener?.("focus", onVisible)
  acquire()

  return {
    /** For tests and for anything that wants to know without rendering. */
    get held() {
      return !!sentinel || !!video
    },
    supported,
    stop() {
      stopped = true
      doc?.removeEventListener("visibilitychange", onVisible)
      globalThis.window?.removeEventListener?.("focus", onVisible)
      const s = sentinel
      sentinel = null
      Promise.resolve(s?.release?.()).catch(() => {})
      if (video) {
        video.pause?.()
        video.remove?.()
        video = null
      }
      onChange(false)
    },
  }
}

export function useWakeLock(active = true) {
  const [held, setHeld] = useState(false)
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator

  useEffect(() => {
    if (!active || typeof document === "undefined") {
      setHeld(false)
      return
    }
    const lock = createWakeLock({ onChange: setHeld })
    return () => lock.stop()
  }, [active])

  return { held, supported }
}
