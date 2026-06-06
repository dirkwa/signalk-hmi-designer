import { useEffect, useRef, useState } from 'react'
import { fetchNotifications, type NotificationRow } from './api'

type SkValue = number | string | boolean | null

interface DeltaMessage {
  context?: string
  updates?: Array<{
    values?: Array<{ path: string; value: SkValue }>
  }>
}

/**
 * Minimal SignalK delta-stream client.
 *
 * Opens a WS to /signalk/v1/stream on the same origin, subscribes to
 * `paths`, and exposes a Map<path, value> that updates as deltas
 * arrive. The subscription is re-issued whenever `paths` changes so
 * widgets that get newly-bound paths start receiving data on next
 * delta (without reconnecting).
 *
 * Re-renders are coalesced via setState's microtask batching, which is
 * fine at the typical SK delta rate. If we ever sustain >100 deltas/s
 * we'd need to throttle — but that's not a today problem.
 */
export function useSkValues(paths: string[]): Map<string, SkValue> {
  const [values, setValues] = useState<Map<string, SkValue>>(() => new Map())
  const wsRef = useRef<WebSocket | null>(null)
  // Stable serialization of the path set so the effect doesn't re-run
  // when the array reference changes but the contents are the same.
  const pathsKey = [...paths].sort().join('|')

  useEffect(() => {
    if (!pathsKey) return undefined
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
      location.host
    }/signalk/v1/stream?subscribe=none`
    const ws = new WebSocket(url)
    wsRef.current = ws
    let closed = false

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          context: 'vessels.self',
          subscribe: pathsKey
            .split('|')
            .filter(Boolean)
            .map((p) => ({ path: p, period: 1000 }))
        })
      )
    })

    ws.addEventListener('message', (ev) => {
      let msg: DeltaMessage
      try {
        msg = JSON.parse(ev.data as string) as DeltaMessage
      } catch {
        return
      }
      if (!msg.updates) return
      // Build a single batched update.
      setValues((prev) => {
        let next: Map<string, SkValue> | null = null
        for (const u of msg.updates ?? []) {
          for (const v of u.values ?? []) {
            if (next === null) next = new Map(prev)
            next.set(v.path, v.value)
          }
        }
        return next ?? prev
      })
    })

    ws.addEventListener('close', () => {
      if (closed) return
      // Caller doesn't currently retry — a refresh covers it. Worth
      // adding exponential backoff if reliability becomes an issue.
    })

    return () => {
      closed = true
      ws.close()
    }
  }, [pathsKey])

  return values
}

/** Poll the SK notifications.* tree and expose a flat array of row
 *  objects. The list widget binds to the synthetic `"notifications"`
 *  path; firmware maintains the same registry from WS deltas, so the
 *  designer poll only has to be fast enough that the operator sees
 *  the canvas update before they finish a layout edit — 2 s is fine.
 *
 *  `includeCleared` widens the fetch to also emit rows in cleared
 *  states (normal/nominal). Each list widget then filters its own
 *  slice — but the fetch must run in the wider mode if any widget
 *  on the canvas wants the cleared rows. */
export function useNotifications(
  enabled: boolean,
  includeCleared: boolean = false
): NotificationRow[] {
  const [rows, setRows] = useState<NotificationRow[]>([])
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    async function tick(): Promise<void> {
      const next = await fetchNotifications({ includeCleared })
      if (!cancelled) setRows(next)
    }
    void tick()
    const id = window.setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled, includeCleared])
  return rows
}
