import { useRef, useState } from "react"
import { kindOf, resolveMediaUrl, stripToRelayPath, uploadMedia } from "../../lib/mediaUrl"

/**
 * Attach a picture, a sound or a clip to a clue.
 *
 * Files upload to the relay rather than being embedded, because the display and
 * every phone need to fetch the same asset from somewhere all of them can
 * reach — and a base64 image inside the board JSON would be re-broadcast on
 * every state change.
 */
export function MediaField({ value, onChange, label = "Media" }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [drag, setDrag] = useState(false)
  const input = useRef(null)

  async function take(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const url = await uploadMedia(file)
      onChange({ kind: kindOf(file), url: stripToRelayPath(url), alt: file.name })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (value) {
    return (
      <div className="space-y-1.5">
        <div className="label">{label}</div>
        <div className="flex items-center gap-2 rounded-lg border border-edge bg-black/25 p-2">
          {value.kind === "image" && <img src={resolveMediaUrl(value.url)} alt={value.alt ?? ""} className="h-14 w-14 rounded object-cover" />}
          {value.kind === "video" && (
            // Muted and unplayed by default: the builder is often open with the
            // big screen already live in the next room.
            <video src={resolveMediaUrl(value.url)} className="h-14 w-24 rounded bg-black object-contain" controls muted preload="metadata" />
          )}
          {value.kind === "audio" && <audio src={resolveMediaUrl(value.url)} controls className="h-8 min-w-0 flex-1" preload="none" />}
          {value.kind !== "audio" && <div className="min-w-0 flex-1 truncate text-[11px] text-muted">{value.alt || value.url}</div>}
          <button className="btn px-2 py-1 text-[11px]" onClick={() => onChange(null)} title="Remove">
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="label">{label}</div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          take(e.dataTransfer.files?.[0])
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-lg border border-dashed px-3 py-3 text-center text-[11px] transition-colors ${
          drag ? "border-amethyst bg-royal/25 text-ink" : "border-edge text-faint hover:border-violet hover:text-muted"
        }`}
      >
        {busy ? "Uploading…" : drag ? "Drop it" : "Drop or click — image, audio or video"}
        <input
          ref={input}
          type="file"
          accept="image/*,audio/*,video/*"
          hidden
          onChange={(e) => {
            take(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </div>
      {error && <div className="text-[11px] text-bad">{error}</div>}
    </div>
  )
}
