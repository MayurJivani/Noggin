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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const signup = mode === "signup" && auth.signupOpen

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (signup) await auth.signup(email, password, name)
      else await auth.login(email, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

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

          <label className="block">
            <div className="label mb-1">Password</div>
            <input
              className="field"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
              placeholder={signup ? "At least 8 characters" : "••••••••"}
            />
          </label>

          {error && <div className="text-xs text-bad">{error}</div>}

          <button className="btn btn-gold w-full py-2.5" disabled={busy}>
            {busy ? "…" : signup ? "Create account" : "Sign in"}
          </button>

          {!auth.signupOpen && (
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
