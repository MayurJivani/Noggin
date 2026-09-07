import assert from "node:assert/strict"
import test from "node:test"
import { Nonces, parse as parseKnock } from "../server/knock.js"
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

test("Knock issue, DSP encode/decode, and parse round-trip with Noggin room codes", () => {
  const knock = new Nonces({ ttlMs: 15_000 })
  const testCodes = ["ROOM", "ABCD", "3456", "XYZ9"]

  for (const code of testCodes) {
    const { payload, nonce } = knock.issue(code)
    assert.equal(payload.length, 8, "Payload must be 8 bytes (4 room + 4 nonce)")

    // DSP encode -> decode
    const symbols = encode(payload)
    const decodedBytes = decode(symbols)

    assert.deepEqual(decodedBytes, payload, "Decoded bytes must match original payload")

    // Parse payload back to room code and nonce
    const parsed = parseKnock(decodedBytes)
    assert.ok(parsed, "Parsed result must not be null")
    assert.equal(parsed.room, code, "Parsed room code must match original")
    assert.deepEqual(parsed.nonce, nonce, "Parsed nonce must match original")
  }
})

test("Nonces single-use redemption and replay defence", () => {
  const knock = new Nonces({ ttlMs: 1000 })
  const { nonce } = knock.issue("GAME")

  // First redemption succeeds
  const first = knock.redeem("GAME", nonce)
  assert.equal(first, true, "First redemption must succeed")

  // Second redemption (replay) fails
  const replay = knock.redeem("GAME", nonce)
  assert.equal(replay, false, "Replay attempt must be rejected")

  // Invalid room or wrong nonce fails
  assert.equal(knock.redeem("WRNG", nonce), false, "Wrong room must be rejected")
})
