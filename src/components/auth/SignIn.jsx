import { useState } from "react"
import { Backdrop } from "../ui/Backdrop"
import { Brand } from "../ui/Brand"
import { VeinLine } from "../ui/Vein"

/**
 * The door for hosts.
 *
 * Only the person running a game ever sees this — players join with a four
 * letter code and no account at all. Signups close once the first account
 * exists, so a deployment reachable from the internet does not quietly become
 * an open service; the copy says so rather than leaving a dead tab.
 */
export function SignIn({ auth, what = "host a game" }) {
  const [mode, setMode] = useState(auth.signupOpen ? "signup" : "login")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  /**
   * The one moment a recovery code is readable. It is stored only as a hash, so
   * if this is dismissed without being written down it is gone — which is why
   * it takes over the screen rather than sitting in a corner.
   */
  const [recovery, setRecovery] = useState(null)

  const signup = mode === "signup" && auth.signupOpen
  const forgot = mode === "forgot"

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (forgot) setRecovery((await auth.forgot(email, code, password)).recoveryCode)
      else if (signup) setRecovery((await auth.signup(email, password, name)).recoveryCode)
      else await auth.login(email, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (recovery) return <RecoveryCode code={recovery} />

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Backdrop veins={6} glow={3} />

      <div className="relative z-10 w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <Brand size="clamp(2.75rem, 9vw, 4.5rem)" />
          <VeinLine className="mt-2 w-48" height={16} />
          <p className="mt-3 text-sm text-muted">Sign in to {what}.</p>
        </div>

        {auth.offline && (
          <div className="mt-5 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-xs text-bad">
            Can't reach the relay. Is the server running?
          </div>
        )}

        <form onSubmit={submit} className="panel mt-6 space-y-3 p-5">
          {auth.signupOpen && (
            <div className="flex rounded-lg border border-edge p-0.5">
              <Tab on={mode === "login"} onClick={() => setMode("login")}>
                Sign in
              </Tab>
              <Tab on={mode === "signup"} onClick={() => setMode("signup")}>
                Create account
              </Tab>
            </div>
          )}

          {forgot && (
            <p className="rounded-lg border border-edge bg-black/25 px-3 py-2 text-[11px] leading-relaxed text-muted">
              Enter the recovery code you were given when the account was made, and the password you'd like instead. Lost it? Run{" "}
              <code className="text-ink">node scripts/recovery-code.js {email || "you@example.com"}</code> on the server for a new one.
            </p>
          )}

          {signup && (
            <label className="block">
              <div className="label mb-1">Your name</div>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quizmaster" autoComplete="name" />
            </label>
          )}

          <label className="block">
            <div className="label mb-1">Email</div>
            <input
              className="field"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="you@example.com"
            />
          </label>

          {forgot && (
            <label className="block">
              <div className="label mb-1">Recovery code</div>
              <input
                className="field text-center font-body uppercase tracking-[0.15em]"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              />
            </label>
          )}

          <label className="block">
            <div className="label mb-1">{forgot ? "New password" : "Password"}</div>
            <input
              className="field"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup || forgot ? "new-password" : "current-password"}
              placeholder={signup || forgot ? "At least 8 characters" : "••••••••"}
            />
          </label>

          {error && <div className="text-xs text-bad">{error}</div>}

          <button className="btn btn-gold w-full py-2.5" disabled={busy}>
            {busy ? "…" : forgot ? "Set a new password" : signup ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            className="w-full text-center text-[0.7rem] text-faint transition-colors hover:text-muted"
            onClick={() => {
              setError(null)
              setMode(forgot ? "login" : "forgot")
            }}
          >
            {forgot ? "← Back to signing in" : "Forgotten your password?"}
          </button>

          {!auth.signupOpen && !forgot && (
            <p className="text-center text-[0.7rem] leading-relaxed text-faint">
              Signups are closed on this server. Set <code className="text-muted">NOGGIN_ALLOW_SIGNUP=1</code> to open them.
            </p>
          )}
        </form>

        <div className="mt-4 text-center text-xs text-faint">
          Playing, not hosting?{" "}
          <a className="text-muted transition-colors hover:text-gold" href="/play">
            Join with a room code →
          </a>
        </div>
      </div>
    </div>
  )
}

/**
 * The recovery code, once.
 *
 * Only its hash is stored, so this is genuinely the only time it can be read —
 * which is why it takes the whole screen and why continuing needs a deliberate
 * press rather than a stray click. Everything else on the page is gone: there
 * is nothing here to do except write it down.
 */
function RecoveryCode({ code }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Backdrop veins={6} glow={3} />
      <div className="relative z-10 w-full max-w-md text-center">
        <Brand size="clamp(2.25rem, 7vw, 3.5rem)" />
        <VeinLine className="mx-auto mt-2 w-48" height={16} />

        <div className="panel mt-6 p-6">
          <div className="label" style={{ letterSpacing: "0.35em" }}>
            Recovery code
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            The way back into this account if the password goes. Write it down now — it is stored only as a hash, so this is the one
            time it can be shown.
          </p>

          <div className="mt-4 select-all break-all rounded-xl border border-gold-deep/50 bg-black/40 px-4 py-4 font-body text-[15px] uppercase tracking-[0.18em] text-gold">
            {code}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              className="btn flex-1 py-2 text-[12px]"
              onClick={() => {
                navigator.clipboard?.writeText(code)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <button className="btn btn-gold flex-1 py-2 text-[12px]" onClick={() => location.reload()}>
              I've written it down
            </button>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-faint">
            Lost it later? <code className="text-muted">node scripts/recovery-code.js</code> on the server mints another.
          </p>
        </div>
      </div>
    </div>
  )
}

const Tab = ({ on, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 rounded-md px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
      on ? "bg-gold text-[#17110a]" : "text-muted hover:text-ink"
    }`}
  >
    {children}
  </button>
)

/** Full-page spinner-ish hold while `/auth/me` is in flight. */
export function AuthLoading() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center">
      <Backdrop veins={4} glow={2} />
      <div className="relative z-10 text-sm text-faint">One moment…</div>
    </div>
  )
}
