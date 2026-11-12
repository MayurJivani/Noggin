import test from "node:test"
import assert from "node:assert/strict"
import { mediaFromLink, youtubeEmbed } from "../src/lib/mediaUrl.js"

test("a Deezer track link keeps the id, not the expiring preview URL", () => {
  for (const link of ["https://www.deezer.com/track/3135556", "https://www.deezer.com/en/track/3135556?utm_source=deezer"]) {
    assert.deepEqual(mediaFromLink(link), { kind: "audio", url: "/deezer/3135556", alt: "Deezer track 3135556" })
  }
  assert.equal(mediaFromLink("https://notdeezer.com/track/1").url, "https://notdeezer.com/track/1")
})

test("YouTube links become a nocookie embed, with the start time", () => {
  const embed = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1"
  assert.equal(youtubeEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), embed)
  assert.equal(youtubeEmbed("https://youtu.be/dQw4w9WgXcQ?t=42"), embed + "&start=42")
  assert.equal(youtubeEmbed("https://youtube.com/shorts/dQw4w9WgXcQ", "&mute=1"), embed + "&mute=1")
  assert.equal(youtubeEmbed("https://evil.com/watch?v=dQw4w9WgXcQ"), null)
  assert.equal(youtubeEmbed("https://www.youtube.com/watch?v=\"><script>"), null)
  assert.equal(youtubeEmbed("/files/clip.mp4"), null)
  assert.equal(mediaFromLink("https://youtu.be/dQw4w9WgXcQ").kind, "video")
})

test("other links are typed by extension, and only http(s) is taken", () => {
  assert.equal(mediaFromLink("https://example.com/a/clip.mp4").kind, "video")
  assert.equal(mediaFromLink("https://example.com/song.mp3").kind, "audio")
  assert.equal(mediaFromLink("https://example.com/cover.jpg").kind, "image")
  assert.equal(mediaFromLink("javascript:alert(1)"), null)
  assert.equal(mediaFromLink("not a link"), null)
})
