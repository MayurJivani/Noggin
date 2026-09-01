import { useCallback, useEffect, useRef, useState } from "react"
import { getWsUrl } from "./mediaUrl"

/**
 * One WebSocket per page, whatever role the page is playing.
 *
 * Reconnects on its own — a phone that sleeps mid-round has to come back
 * without anyone walking over to tap it, and the projector machine must survive
 * the relay being restarted between rounds.
 *
 * `effects` are transient: a buzz, a correct ruling, a daily double splash.
 * They arrive alongside the snapshot and are handed to `onEffects` rather than
 * stored, because animating "someone just buzzed" twice on a reconnect would be
 * worse than missing it.
 *
 * @param {object} opts
 * @param {'host'|'display'|'player'|'controller'} opts.role
 * @param {string} [opts.code]      – room code; host may omit to open a new room
 * @param {string} [opts.name]      – player display name
 * @param {string} [opts.playerId]  – stable id so a reload keeps its score
 * @param {(effects: any[], state: any) => void} [opts.onEffects]
 * @param {(err: {code:string,message:string}) => void} [opts.onError]
 * @param {(msg: any) => void} [opts.onMessage] – anything this hook doesn't model
 * @param {boolean} [opts.enabled]  – hold off connecting until the user is ready
 */
export function useRoom({ role, code, name, playerId, onEffects, onError, onMessage, enabled = true }) {
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const [identity, setIdentity] = useState(null)

  const wsRef = useRef(null)
  /** Relay clock minus ours. Timers are absolute epochs, so a laptop with a
   *  drifting clock would otherwise count down to the wrong moment. */
  const offsetRef = useRef(0)

  const handlers = useRef({})
  handlers.current = { onEffects, onError, onMessage }
  const joinRef = useRef({ role, code, name, playerId })
  joinRef.current = { role, code, name, playerId }

  useEffect(() => {
    if (!enabled) return
    if (role !== "host" && !code) return

    let closed = false
    let retry = null
    let attempt = 0
    let ping = null

    const connect = () => {
      if (closed) return
      const ws = new WebSocket(getWsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        attempt = 0
        setConnected(true)
        const j = joinRef.current
        ws.send(JSON.stringify({ type: "join", role: j.role, code: j.code, name: j.name, playerId: j.playerId }))
        ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }))
        }, 25_000)
      }

      ws.onmessage = (e) => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }
        if (!msg || typeof msg !== "object") return

        if (msg.type === "state") {
          offsetRef.current = msg.state.serverNow - Date.now()
          setState(msg.state)
          if (msg.effects?.length) handlers.current.onEffects?.(msg.effects, msg.state)
          return
        }
        if (msg.type === "joined") {
          setIdentity({ playerId: msg.playerId ?? null, code: msg.code, role: msg.role })
          return
        }
        if (msg.type === "error") {
          handlers.current.onError?.(msg)
          return
        }
        if (msg.type === "pong") {
          offsetRef.current = msg.serverNow - Date.now()
          return
        }
        // Everything else (save acknowledgements, and whatever the protocol
        // grows next) goes to the page rather than being silently dropped.
        handlers.current.onMessage?.(msg)
      }

      const reconnect = () => {
        clearInterval(ping)
        setConnected(false)
        if (closed) return
        // Back off, but stay responsive: a phone should rejoin within a second
        // or two of wifi returning, not after a 30s penalty.
        retry = setTimeout(connect, Math.min(400 * 2 ** attempt++, 5000))
      }

      ws.onclose = reconnect
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closed = true
      clearInterval(ping)
      clearTimeout(retry)
      const w = wsRef.current
      if (w) {
        w.onclose = null
        w.close()
      }
      setConnected(false)
    }
  }, [role, code, enabled])

  const send = useCallback((type, payload = {}) => {
    const w = wsRef.current
    if (w?.readyState === WebSocket.OPEN) w.send(JSON.stringify({ type, ...payload }))
  }, [])

  /** Relay time, for turning an absolute `endsAt` into a countdown. */
  const now = useCallback(() => Date.now() + offsetRef.current, [])

  return { state, connected, identity, send, now }
}

/**
 * Re-renders ~10x a second while a deadline is pending, and not at all when it
 * isn't. Countdown rings are the only thing in Noggin that needs a tick, and a
 * permanent interval on the display page would keep a projector's fan running.
 */
export function useCountdown(endsAt, now) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => force((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [endsAt])
  if (!endsAt) return null
  return Math.max(0, endsAt - now())
}
