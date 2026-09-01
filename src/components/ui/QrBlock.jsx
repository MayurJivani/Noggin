import { useEffect, useRef } from "react"
import QRCode from "qrcode"

/**
 * A QR for any URL, in the house colours.
 *
 * Split out of JoinCard once the controller invite needed one too — reading a
 * random key aloud across a room is exactly the sort of thing that goes wrong
 * twice before it goes right.
 */
export function QrBlock({ url, size = 120, className = "" }) {
  const canvas = useRef(null)

  useEffect(() => {
    if (!url || !canvas.current) return
    QRCode.toCanvas(canvas.current, url, {
      width: size,
      margin: 1,
      color: { dark: "#0a0910", light: "#f2c96b" },
    }).catch(() => {})
  }, [url, size])

  if (!url) return null
  return <canvas ref={canvas} className={`rounded border border-gold-deep/40 ${className}`} />
}
