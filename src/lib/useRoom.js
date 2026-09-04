import { useCallback, useEffect, useRef, useState } from "react"
import { getWsUrl } from "./mediaUrl"

/** How often to ping. Frequent enough to notice a dead socket within seconds. */
const PING_EVERY_MS = 5_000
/** Silence for longer than this means the socket is gone, whatever it claims. */
const SILENCE_LIMIT_MS = 12_000

/**
 * One WebSocket per page, whatever role the page is playing.
 *
 * Reconnects on its own — a phone that sleeps mid-round has to come back
 * without anyone walking over to tap it, and the projector machine must survive
 * the relay being restarted between rounds.
 *
 * `effects` are transient: a buzz, a correct ruling, a Nitro splash.
 * They arrive alongside the snapshot and are handed to `onEffects` rather than
 * stored, because animating "someone just buzzed" twice on a reconnect would be
 * worse than missing it.
 *
 * @param {object} opts
 * @param {'host'|'display'|'player'|'controller'} opts.role
 * @param {string} [opts.code]      – room code; host may omit to open a new room
 * @param {string} [opts.name]      – player display name
 * @param {string} [opts.playerId]  – stable id so a reload keeps its score
 * @param {string} [opts.key]       – controller key, for driving without an account
 * @param {'desk'|'cards'|'control'} [opts.surface] – which privileged screen this is
 * @param {(effects: any[], state: any) => void} [opts.onEffects]
 * @param {(err: {code:string,message:string}) => void} [opts.onError]
 * @param {(msg: any) => void} [opts.onMessage] – anything this hook doesn't model
 * @param {boolean} [opts.enabled]  – hold off connecting until the user is ready
 */
export function useRoom({ role, code, name, playerId, key, surface, onEffects, onError, onMessage, enabled = true }) {
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const [identity, setIdentity] = useState(null)

  const wsRef = useRef(null)
  /** Relay clock minus ours. Timers are absolute epochs, so a laptop with a
   *  drifting clock would otherwise count down to the wrong moment. */
  const offsetRef = useRef(0)
  /** Round-trip time, so a player can see their connection is healthy. */
  const [rtt, setRtt] = useState(null)
  /**
   * Messages written while the socket was down.
   *
   * A press that arrives during a reconnect used to be dropped on the floor —
   * the player felt the button, saw nothing happen, and concluded the buzzer
   * was broken. Each entry carries a deadline: replaying a buzz four seconds
   * late would be worse than losing it, because it would enter a race that is
   * already over.
   */
  const outbox = useRef([])
  const reconnectNow = useRef(() => {})

  const handlers = useRef({})
  handlers.current = { onEffects, onError, onMessage }
  const joinRef = useRef({ role, code, name, playerId, key, surface })
  joinRef.current = { role, code, name, playerId, key, surface }

  useEffect(() => {
    if (!enabled) return
    if (role !== "host" && !code) return

    let closed = false
    let retry = null
    let attempt = 0
    let ping = null
    let watchdog = null
    /** When we last heard anything at all from the relay. */
    let lastSeen = Date.now()
    let pingSentAt = 0

    const connect = () => {
      if (closed) return
      clearTimeout(retry)
      const ws = new WebSocket(getWsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        attempt = 0
        lastSeen = Date.now()
        setConnected(true)
        const j = joinRef.current
        ws.send(JSON.stringify({ type: "join", role: j.role, code: j.code, name: j.name, playerId: j.playerId, key: j.key, surface: j.surface }))

        // Anything the player did while we were away, if it is still worth
        // saying. Sent after the join so the relay knows who is speaking.
        const now = Date.now()
        const queued = outbox.current
        outbox.current = []
        for (const item of queued) {
          if (item.deadline && now > item.deadline) continue
          ws.send(item.body)
        }

        /*
          A phone that walks out of range does not get a close event: the socket
          just stops carrying anything, and the browser can sit on that for
          minutes. Pinging often and treating silence as death is the only way
          to notice — and on a buzzer, "connected" being a lie is the worst
          possible failure, because the player has no reason to doubt it.
        */
        clearInterval(ping)
        ping = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return
          if (Date.now() - lastSeen > SILENCE_LIMIT_MS) {
            ws.close()
            return
          }
          pingSentAt = Date.now()
          ws.send(JSON.stringify({ type: "ping" }))
        }, PING_EVERY_MS)
      }

      ws.onmessage = (e) => {
        lastSeen = Date.now()
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
          const now = Date.now()
          if (pingSentAt) {
            const round = now - pingSentAt
            setRtt(round)
            // Tell the room, so the host can see which phone is on bad wifi
            // before the game rather than after someone loses every buzz.
            if (role === "player") ws.send(JSON.stringify({ type: "rtt", ms: round }))
            // Halve the round trip to estimate one-way, so a countdown is not
            // skewed by the time the reply spent coming back.
            offsetRef.current = msg.serverNow - (now - round / 2)
            pingSentAt = 0
          } else {
            offsetRef.current = msg.serverNow - now
          }
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
        // The first retry is immediate: a dropped socket is usually a blip, and
        // making the room wait 400ms to find that out helps nobody. Only a
        // genuinely absent network gets backed off.
        const delay = attempt === 0 ? 0 : Math.min(300 * 2 ** attempt, 4000)
        attempt++
        clearTimeout(retry)
        retry = setTimeout(connect, delay)
      }

      ws.onclose = reconnect
      ws.onerror = () => ws.close()
    }

    /**
     * Come back the instant the device says it can, rather than waiting out a
     * backoff. Wifi returning, a phone waking, a tab being swiped back to — all
     * are far better signals than a timer, and all are the moment a player is
     * about to look at the buzzer again.
     */
    reconnectNow.current = () => {
      const w = wsRef.current
      if (closed) return
      if (w && w.readyState === WebSocket.OPEN) return
      if (w && w.readyState === WebSocket.CONNECTING) return
      attempt = 0
      clearTimeout(retry)
      connect()
    }

    const wake = () => {
      if (document.visibilityState === "visible") reconnectNow.current()
    }
    window.addEventListener("online", reconnectNow.current)
    window.addEventListener("pageshow", reconnectNow.current)
    document.addEventListener("visibilitychange", wake)

    // A last line of defence for the case where nothing fires an event at all:
    // some mobile browsers restore a tab without `pageshow` or `online`.
    watchdog = setInterval(() => {
      const w = wsRef.current
      if (!w || w.readyState === WebSocket.CLOSED) reconnectNow.current()
    }, 2000)

    connect()
    return () => {
      closed = true
      clearInterval(ping)
      clearInterval(watchdog)
      clearTimeout(retry)
      window.removeEventListener("online", reconnectNow.current)
      window.removeEventListener("pageshow", reconnectNow.current)
      document.removeEventListener("visibilitychange", wake)
      const w = wsRef.current
      if (w) {
        w.onclose = null
        w.close()
      }
      setConnected(false)
    }
  }, [role, code, enabled])

  /**
   * @param {string} type
   * @param {object} [payload]
   * @param {number} [ttl] – how long this is still worth sending if the socket
   *   is down, in ms. Omit for things that should simply be dropped.
   */
  const send = useCallback((type, payload = {}, ttl = 0) => {
    const body = JSON.stringify({ type, ...payload })
    const w = wsRef.current
    if (w?.readyState === WebSocket.OPEN) {
      w.send(body)
      return true
    }
    if (ttl > 0) {
      outbox.current.push({ body, deadline: Date.now() + ttl })
      // Do not sit waiting for a backoff when something is actually pending.
      reconnectNow.current()
    }
    return false
  }, [])

  /** Relay time, for turning an absolute `endsAt` into a countdown. */
  const now = useCallback(() => Date.now() + offsetRef.current, [])

  return { state, connected, identity, send, now, rtt }
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
