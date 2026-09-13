/**
 * Join-by-sound: the screen says the room code out loud, above hearing.
 *
 * The same mechanic Chorus uses, and deliberately the same shape — one module,
 * one config, a shape check on the way in. See `apps/web/src/features/
 * multiplayer/knockJoin.ts` there; keeping them alike means a fix to the
 * awkward parts of this only has to be worked out once.
 *
 * What changed here to match it: the payload is the room code and nothing else.
 * It used to carry a four-byte nonce as well, which the phone posted back for
 * the relay to check. That bought one thing — a recording of the room could not
 * join, because the nonce had expired — and cost three:
 *
 *   - Twice the payload. 8 bytes is a 990ms frame against 660ms, and a phone
 *     that starts listening mid-frame waits for the next one: 2.4 seconds of
 *     worst case rather than 1.7.
 *   - A round trip. Hearing the tone was not enough; the phone then had to
 *     reach the relay and be told yes.
 *   - A failure mode with no good answer. A frame caught across a rotation
 *     arrived just too late, and the phone was told to try again — another
 *     full cycle, for a room it had already heard perfectly.
 *
 * The replay defence is gone with it, and that is the honest trade. It matters
 * less here than it looks: a Noggin room code has never been a secret, and
 * anyone who can play a recording of the tone could have read the code off the
 * screen in the same footage. What it is not is an excuse to treat joining as
 * authenticated — it never was. See the known limits in PLAN.md.
 */
import { broadcast, listen } from "./knock/knock"

/**
 * Eight tones from 18kHz, above almost everyone's hearing.
 *
 * Spelled out rather than left to the library's defaults because both ends have
 * to agree exactly, and a default that drifts underneath a caller is a modem
 * that stops working for reasons nobody can see.
 *
 * The cost, which the listener reports rather than hides: Firefox resamples
 * microphone input to 32kHz and cannot carry an 18kHz tone at all, so those
 * phones can never receive this and fall back to typing the code.
 */
const CONFIG = { baseHz: 18000, spacingHz: 125, syncHz: 19125, symbolMs: 30, syncSymbols: 3 }
const VOLUME = 0.2

/** Noggin codes are four from an unambiguous alphabet; anything else misdecoded. */
const CODE = /^[A-Z0-9]{4}$/

/**
 * Say a room code until stopped.
 *
 * Must be called from a user gesture — a browser will not start an AudioContext
 * otherwise, and the failure is silent.
 */
export async function announceRoom(code) {
  const tx = await broadcast(String(code).toUpperCase(), { ...CONFIG, volume: VOLUME })
  // `frameMs` is how long one transmission takes; a listener that starts at the
  // wrong moment waits up to that again. Passed through so a caller can say
  // how long this ought to take instead of guessing.
  return { stop: () => tx.stop(), frameMs: tx.frameMs }
}

/**
 * Listen for a nearby room.
 *
 * `onCode` may fire more than once: the transmitter repeats, and the library
 * only suppresses an identical payload for a few seconds. Callers should treat
 * it as "still hearing this room" rather than as a new event.
 *
 * `usable` is false when the microphone cannot carry the band. Nothing will
 * ever arrive on such a device, so the caller has to say so rather than leave
 * a listener running against silence.
 */
export async function listenForRoom(onCode) {
  const rx = await listen((bytes) => {
    const text = new TextDecoder().decode(bytes).trim().toUpperCase()
    // Anyone with a speaker can transmit, and a CRC catches accidents rather
    // than adversaries — so this is untrusted input and gets shape-checked
    // before it reaches anything that joins a room.
    if (CODE.test(text)) onCode(text)
  }, CONFIG)

  return { usable: rx.usable, stop: () => rx.stop() }
}

export const __testing = { CONFIG, CODE }
