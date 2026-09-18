import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchNotifications,
  getNestedField,
  resolveBindPath,
  type NotificationRow,
  type SkValue
} from './api'

export type { SkValue } from './api'

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
 * `paths`, and exposes a Map<bind, value> that updates as deltas
 * arrive. The subscription is re-issued whenever `paths` changes so
 * widgets that get newly-bound paths start receiving data on next
 * delta (without reconnecting).
 *
 * `paths` are widget binds, not necessarily real SK paths verbatim:
 * a bind may reach past a leaf into a field of its object value
 * (`navigation.position.latitude`). `knownSkPaths` (the live
 * self-paths list) splits each bind into the real SK path to
 * subscribe to plus the extra dotted segments to read from each delta
 * for that path, see `resolveBindPath`. The returned map is still
 * keyed by the original bind string, so callers (zone matching, the
 * wasm subject push) don't need to know a bind was extended.
 *
 * Re-renders are coalesced via setState's microtask batching, which is
 * fine at the typical SK delta rate. If we ever sustain >100 deltas/s
 * we'd need to throttle — but that's not a today problem.
 */
export function useSkValues(
  paths: string[],
  knownSkPaths: readonly string[] = []
): Map<string, SkValue> {
  const [values, setValues] = useState<Map<string, SkValue>>(() => new Map())
  const wsRef = useRef<WebSocket | null>(null)

  // Resolve once per change of either input, not on every render: the
  // hook re-renders on every delta, and the known-path list is the
  // whole self tree.
  const resolved = useMemo(() => {
    const known = new Set(knownSkPaths)
    return paths.map((bind) => ({ bind, ...resolveBindPath(bind, known) }))
  }, [paths, knownSkPaths])
  // Serialized keys drive the effect, not the arrays: an unrelated
  // screen edit hands in a fresh `paths` array with the same contents,
  // and that must not reconnect. A change in the bind->field mapping
  // does reconnect on purpose: SignalK sends the current value on
  // subscribe, so a bind added onto an already-subscribed path gets a
  // value at once instead of waiting for the next change.
  const skPathsKey = [...new Set(resolved.map((r) => r.skPath))]
    .sort()
    .join('|')
  const bindMapKey = resolved
    .map((r) => `${r.bind}=${r.skPath}:${r.fieldPath.join('.')}`)
    .sort()
    .join('\n')

  useEffect(() => {
    if (!skPathsKey) return undefined
    // The keys fully determine this mapping, so the one captured here
    // stays equivalent until the effect re-runs.
    const mapping = resolved
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
          subscribe: skPathsKey
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
            for (const r of mapping) {
              if (r.skPath !== v.path) continue
              if (next === null) next = new Map(prev)
              next.set(
                r.bind,
                r.fieldPath.length === 0
                  ? v.value
                  : getNestedField(v.value, r.fieldPath)
              )
            }
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
  }, [skPathsKey, bindMapKey])

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
