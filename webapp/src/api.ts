// API helpers. All device traffic goes through the plugin's
// /device-proxy so the browser doesn't see cross-origin requests.

import {
  HelloResponse,
  isHelloResponse,
  Layout,
  SCHEMA_VERSION
} from './schema'

const PLUGIN_BASE = '/plugins/signalk-hmi-designer'

interface ProxyRequest {
  url: string
  method?: 'GET' | 'POST'
  body?: unknown
}

async function deviceProxy<T>(req: ProxyRequest): Promise<T> {
  const r = await fetch(`${PLUGIN_BASE}/device-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  })
  const text = await r.text()
  if (!r.ok) {
    let msg = text
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed.error === 'string') msg = parsed.error
    } catch {
      /* not JSON */
    }
    throw new Error(`device proxy ${r.status}: ${msg}`)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Capability fetch from a target device. */
export async function fetchHello(deviceUrl: string): Promise<HelloResponse> {
  const v = await deviceProxy<unknown>({
    url: `${deviceUrl.replace(/\/$/, '')}/hello`,
    method: 'GET'
  })
  if (!isHelloResponse(v)) {
    throw new Error('device returned a /hello with unexpected shape')
  }
  return v
}

export interface PushResult {
  ok: boolean
  err?: string
  name?: string
  screens?: number
  widgets?: number
}

/** Push a layout to a target device. */
export async function pushLayout(
  deviceUrl: string,
  layout: Layout
): Promise<PushResult> {
  if (layout.schema !== SCHEMA_VERSION) {
    throw new Error(`schema must be ${SCHEMA_VERSION}`)
  }
  const v = await deviceProxy<unknown>({
    url: `${deviceUrl.replace(/\/$/, '')}/layout`,
    method: 'POST',
    body: layout
  })
  if (typeof v !== 'object' || v === null) {
    throw new Error('device returned unexpected push result shape')
  }
  return v as PushResult
}

/**
 * Returns all SignalK paths currently published on this server, by
 * walking GET /signalk/v1/api/vessels/self. Returns an alphabetically
 * sorted list.
 */
export async function fetchSelfPaths(): Promise<string[]> {
  const r = await fetch('/signalk/v1/api/vessels/self')
  if (!r.ok) throw new Error(`signalk self: ${r.status}`)
  const data = (await r.json()) as unknown
  const paths: string[] = []
  walk('', data, paths)
  paths.sort()
  return paths
}

function walk(prefix: string, node: unknown, out: string[]): void {
  if (typeof node !== 'object' || node === null) return
  const obj = node as Record<string, unknown>
  // A SignalK leaf node is an object with `value` (or `values`) and
  // `timestamp`. Detect leaves and stop recursing into their internals.
  if ('value' in obj && 'timestamp' in obj) {
    if (prefix) out.push(prefix)
    return
  }
  if ('values' in obj && 'timestamp' in obj) {
    if (prefix) out.push(prefix)
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    // SignalK uses dot-paths under vessels.self; we already start
    // walking *inside* vessels.self so we don't prefix it.
    const next = prefix ? `${prefix}.${k}` : k
    walk(next, v, out)
  }
}
