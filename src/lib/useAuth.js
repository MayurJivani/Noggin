import { useCallback, useEffect, useState } from "react"
import { getRelayOrigin } from "./mediaUrl"

/**
 * Who is signed in, if anyone.
 *
 * The session lives in an HttpOnly cookie, so there is nothing here to read out
 * of localStorage and nothing for a script on the page to steal. Every request
 * carries `credentials: "include"` because in dev the page is on 4331 and the
 * relay on 4332 — a cross-origin pair, where cookies are not sent by default.
 */
export function useAuth() {
  const [user, setUser] = useState(null)
  const [signupOpen, setSignupOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [offline, setOffline] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${getRelayOrigin()}/auth/me`, { credentials: "include" })
      const j = await res.json()
      setUser(j.user ?? null)
      setSignupOpen(!!j.signupOpen)
      setOffline(false)
    } catch {
      setOffline(true)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const post = useCallback(async (route, body) => {
    const res = await fetch(`${getRelayOrigin()}/auth/${route}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? "Something went wrong.")
    return j
  }, [])

  const login = useCallback(
    async (email, password) => {
      const j = await post("login", { email, password })
      setUser(j.user)
      return j.user
    },
    [post],
  )

  const signup = useCallback(
    async (email, password, name) => {
      const j = await post("signup", { email, password, name })
      setUser(j.user)
      setSignupOpen(false)
      return j.user
    },
    [post],
  )

  const logout = useCallback(async () => {
    await post("logout").catch(() => {})
    setUser(null)
    await refresh()
  }, [post, refresh])

  return { user, ready, signupOpen, offline, login, signup, logout, refresh }
}
