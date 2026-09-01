import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { isLoopbackPage, playerUrl } from "../../lib/net"

/**
 * How players get in: a four-letter code big enough to read from the back of
 * the room, and a QR for everyone who would rather not type.
 */
export function JoinCard({ code, size = 168, compact = false }) {
  const [url, setUrl] = useState("")
  const canvas = useRef(null)

  useEffect(() => {
    if (!code) return
    playerUrl(code).then(setUrl)
  }, [code])

  useEffect(() => {
    if (!url || !canvas.current) return
    QRCode.toCanvas(canvas.current, url, {
      width: size,
      margin: 1,
      color: { dark: "#0a0910", light: "#f2c96b" },
    }).catch(() => {})
  }, [url, size])

  if (!code) return null

  return (
    <div className={`flex items-center gap-4 ${compact ? "" : "flex-col text-center"}`}>
      <canvas ref={canvas} className="rounded-lg border border-gold-deep/50 shadow-lg shadow-black/40" />
      <div className={compact ? "" : "flex flex-col items-center"}>
        <div className="label">Join at</div>
        <div className="font-body text-[11px] text-muted break-all max-w-[190px]">{url.replace(/^https?:\/\//, "") || "…"}</div>
        <div className="label mt-2">Room code</div>
        <div className="font-display brass-sm text-3xl tracking-[0.22em]">{code}</div>
        {/* A localhost QR is unscannable by definition — say so before showtime. */}
        {isLoopbackPage() && !url.includes("localhost") ? null : isLoopbackPage() ? (
          <div className="mt-2 text-[10px] text-bad max-w-[190px]">
            Open this page on the machine's LAN address — a phone can't reach localhost.
          </div>
        ) : null}
      </div>
    </div>
  )
}
