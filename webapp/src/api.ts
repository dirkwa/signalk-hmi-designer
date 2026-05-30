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
 * Read the last-saved layout from the plugin's data dir. Returns null
 * if nothing has been saved yet (HTTP 404).
 */
export async function loadSavedLayout(): Promise<Layout | null> {
  const r = await fetch(`${PLUGIN_BASE}/layout`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`load layout: HTTP ${r.status}`)
  return (await r.json()) as Layout
}

/** Persist a layout to the plugin's data dir (atomic write). */
export async function saveLayout(layout: Layout): Promise<void> {
  const r = await fetch(`${PLUGIN_BASE}/layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout)
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`save layout: HTTP ${r.status} ${t}`)
  }
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

/**
 * SK path metadata as returned by
 *   GET /signalk/v1/api/vessels/self/<dot.path>/meta
 *
 * `displayUnits` is what the SK server delivers after merging user
 * unit preferences. `formula` is a simple JS-ish expression in `value`,
 * e.g. "value - 273.15" or "value * 1.94384". We only auto-resolve the
 * common shapes; unrecognised formulas fall back to identity.
 */
export interface PathMeta {
  description?: string
  units?: string
  displayUnits?: {
    category?: string
    targetUnit?: string
    formula?: string
    inverseFormula?: string
    symbol?: string
    displayFormat?: string
  }
}

export interface DisplayDefaults {
  unit: string
  scale: number
  offset: number
  decimals: number
}

/** Fetch metadata for a SK path. Returns null on 404 / non-200. */
export async function fetchPathMeta(skPath: string): Promise<PathMeta | null> {
  const slashed = skPath.replace(/\./g, '/')
  const r = await fetch(`/signalk/v1/api/vessels/self/${slashed}/meta`)
  if (!r.ok) return null
  return (await r.json()) as PathMeta
}

/**
 * Derive display defaults from SK metadata. Returns null if `meta` has
 * no displayUnits at all. Recognised formulas:
 *   "value"            -> scale=1 offset=0  (identity)
 *   "value - <N>"      -> scale=1 offset=-N (K -> C)
 *   "value + <N>"      -> scale=1 offset=+N
 *   "value * <N>"      -> scale=N offset=0  (rad->deg, m/s->kn, ratio->%)
 *   "value / <N>"      -> scale=1/N offset=0
 * Anything else stays identity and the user can fix it.
 */
export function deriveDisplayDefaults(meta: PathMeta): DisplayDefaults | null {
  if (!meta.displayUnits) return null
  const du = meta.displayUnits
  const unit = du.symbol ?? du.targetUnit ?? meta.units ?? ''
  const decimals = decimalsFromFormat(du.displayFormat)
  const { scale, offset } = parseFormula(du.formula ?? 'value')
  return { unit, scale, offset, decimals }
}

function decimalsFromFormat(fmt: string | undefined): number {
  if (!fmt) return 1
  // "0.0" -> 1, "0.00" -> 2, "0" -> 0
  const dot = fmt.indexOf('.')
  if (dot === -1) return 0
  return fmt.length - dot - 1
}

function parseFormula(formula: string): { scale: number; offset: number } {
  const trimmed = formula.trim()
  if (trimmed === 'value') return { scale: 1, offset: 0 }
  const sub = /^value\s*-\s*([\d.eE+-]+)$/.exec(trimmed)
  if (sub && sub[1] !== undefined) return { scale: 1, offset: -Number(sub[1]) }
  const add = /^value\s*\+\s*([\d.eE+-]+)$/.exec(trimmed)
  if (add && add[1] !== undefined) return { scale: 1, offset: Number(add[1]) }
  const mul = /^value\s*\*\s*([\d.eE+-]+)$/.exec(trimmed)
  if (mul && mul[1] !== undefined) return { scale: Number(mul[1]), offset: 0 }
  const div = /^value\s*\/\s*([\d.eE+-]+)$/.exec(trimmed)
  if (div && div[1] !== undefined) {
    const n = Number(div[1])
    return { scale: n === 0 ? 1 : 1 / n, offset: 0 }
  }
  return { scale: 1, offset: 0 }
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
