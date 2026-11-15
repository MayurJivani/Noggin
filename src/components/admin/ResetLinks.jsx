import { useState } from "react"
import { getRelayOrigin } from "../../lib/mediaUrl"
import { useAuth } from "../../lib/useAuth"
import { AuthLoading, SignIn } from "../auth/SignIn"
import { Backdrop } from "../ui/Backdrop"

/** Password reset links, for the one admin. The relay enforces who that is. */
export function ResetLinks() {
  const auth = useAuth()
  const [email, setEmail] = useState("")
  const [link, setLink] = useState(null)
  const [error, setError] = useState(null)

  if (!auth.ready) return <AuthLoading />
  if (!auth.user) return <SignIn auth={auth} what="open the admin desk" />

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setLink(null)
    const res = await fetch(`${getRelayOrigin()}/auth/reset-link`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    const j = (await res?.json().catch(() => null)) ?? {}
    if (!res?.ok) return setError(j.error ?? "Can't reach the relay.")
    setLink(`${location.origin}/host#${new URLSearchParams({ reset: j.code, email: j.email })}`)
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Backdrop veins={4} glow={2} />
      <form onSubmit={submit} className="panel relative z-10 w-full max-w-md space-y-3 p-5">
        <div className="label">Password reset link</div>
        <label className="block">
          <div className="label mb-1">Account email</div>
          <input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="them@example.com" />
        </label>
        {error && <div className="text-xs text-bad">{error}</div>}
        <button className="btn btn-gold w-full py-2.5">Generate link</button>
        {link && (
          <>
            <div className="select-all break-all rounded-xl border border-gold-deep/50 bg-black/40 px-3 py-3 text-xs text-gold">{link}</div>
            <button type="button" className="btn w-full py-2 text-[12px]" onClick={() => navigator.clipboard?.writeText(link)}>
              Copy
            </button>
            <p className="text-[10px] leading-relaxed text-faint">Their old recovery code no longer works. The link works once.</p>
          </>
        )}
      </form>
    </div>
  )
}
