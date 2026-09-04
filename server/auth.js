/**
 * Host accounts.
 *
 * Only the person running a game needs one. Players stay anonymous — asking a
 * room full of people to sign up before they can press a buzzer would ruin the
 * thing this is for. What accounts buy is ownership: your saved games are
 * yours, and nobody who wanders onto the URL can resume them, read your clues,
 * or pick up a controller mid-round.
 *
 * Passwords go through scrypt from node's own crypto — no native dependency to
 * build in an alpine image, and a memory-hard KDF is the right shape for this.
 * Session tokens are random and stored only as a SHA-256 digest, so a leaked
 * database does not hand over live sessions.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(scryptCb)

/** Deliberately slow. Tuned so a single hash costs ~100ms on a small VPS. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export const SESSION_COOKIE = "noggin_session"
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false
  const [scheme, N, r, p, salt, key] = stored.split("$")
  if (scheme !== "scrypt") return false
  try {
    const expected = Buffer.from(key, "base64")
    const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    })
    // Length check first: timingSafeEqual throws rather than returning false
    // when the buffers differ in size.
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** What goes in the cookie. Never stored as-is. */
export const newSessionToken = () => randomBytes(32).toString("base64url")

/** What goes in the database. */
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex")

/** Short, shareable, and scoped to one room for one night. */
export const newControllerKey = () => randomBytes(9).toString("base64url")

// ── Recovery ─────────────────────────────────────────────────────────────────

/**
 * The way back into an account.
 *
 * There is no email here and there should not be: this thing runs on a box in
 * somebody's house, and making a password reset depend on an SMTP account is
 * a whole subsystem to maintain for something used once a year. So the account
 * carries its own way back in — a code handed over once, at signup, and stored
 * only as a hash. It is worth exactly as much as the password, so it is treated
 * exactly like one.
 *
 * Twenty characters, grouped, from an alphabet with no I, O, 0 or 1 — it gets
 * written on paper and read back, and those four are where that goes wrong.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function newRecoveryCode() {
  const bytes = randomBytes(20)
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return chars.join("").replace(/(.{4})(?=.)/g, "$1-")
}

/** Accept it however it comes back — spaced, lowercase, dashes wherever. */
export const tidyRecoveryCode = (code) =>
  String(code ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")

export const hashRecoveryCode = (code) => hashPassword(tidyRecoveryCode(code))
export const verifyRecoveryCode = (code, stored) => verifyPassword(tidyRecoveryCode(code), stored)

// ── Validation ───────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials({ email, password, name }) {
  const e = String(email ?? "").trim().toLowerCase()
  if (!EMAIL.test(e) || e.length > 200) return { error: "That doesn't look like an email address." }
  const pw = String(password ?? "")
  if (pw.length < 8) return { error: "Use at least 8 characters." }
  if (pw.length > 200) return { error: "That password is too long." }
  return { email: e, password: pw, name: String(name ?? "").trim().slice(0, 40) || e.split("@")[0] }
}

// ── Cookies ──────────────────────────────────────────────────────────────────

/** Parse a Cookie header into a plain object. Never throws on junk. */
export function parseCookies(header) {
  const out = {}
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    if (!k) continue
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      out[k] = part.slice(i + 1).trim()
    }
  }
  return out
}

/**
 * `Secure` has to track how the request actually arrived. Behind Caddy and a
 * Cloudflare tunnel the relay itself speaks plain http, so the only honest
 * signal is the forwarded header — and setting `Secure` unconditionally would
 * make the cookie vanish on a LAN deployment served over http.
 */
export function sessionCookie(token, req, { clear = false } = {}) {
  const https = (req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https"
  const bits = [
    `${SESSION_COOKIE}=${clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  if (https) bits.push("Secure")
  return bits.join("; ")
}

export const publicUser = (user) => (user ? { id: user.id, email: user.email, name: user.name } : null)
