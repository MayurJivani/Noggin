import assert from "node:assert/strict"
import test from "node:test"
import { encode, decode } from "../src/lib/knock/dsp.js"

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

test("Noggin room code alphabet is 100% compatible with Knock payloads", () => {
  for (const char of CODE_ALPHABET) {
    const code = `${char}${char}${char}${char}`
    assert.equal(code.length, 4, "Room code must be 4 characters")
    for (let i = 0; i < code.length; i++) {
      const byte = code.charCodeAt(i)
      assert.ok(byte >= 32 && byte <= 126, `Character '${char}' must be printable ASCII`)
    }
  }
})


test("the tone carries a room code, and it survives the modem", () => {
  // What joining by sound now is, end to end: the code in, the code out. No
  // nonce and no round trip — see src/lib/knockJoin.js for why that changed.
  for (const code of ["ROOM", "ABCD", "3456", "XYZ9"]) {
    const payload = new TextEncoder().encode(code)
    assert.equal(payload.length, 4, "four bytes, which is a 660ms frame")
    const back = new TextDecoder().decode(decode(encode(payload)))
    assert.equal(back, code)
  }
})

test("every code the relay can mint survives it", () => {
  // The alphabet is the seam between the two projects: `newCode` builds from
  // this set, and a character the modem cannot carry would be a room nobody
  // could join by sound.
  for (const ch of CODE_ALPHABET) {
    const code = `${ch}${ch}${ch}${ch}`
    const back = new TextDecoder().decode(decode(encode(new TextEncoder().encode(code))))
    assert.equal(back, code, `"${code}" did not survive`)
  }
})
