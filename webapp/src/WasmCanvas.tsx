// Pixel-perfect canvas preview backed by LVGL compiled to WebAssembly.
// The wasm module IS the firmware's widget_factory.cpp, so what renders
// here is bit-identical to what the panel draws — same arc rendering,
// same Montserrat fonts, same theme.
//
// Lazy-loaded: the wasm bundle is ~1.3 MB and only fetched when the
// user actually picks WASM preview mode. The first `<WasmCanvas>`
// mount kicks off the dynamic import; subsequent mounts reuse the
// cached module.
//
// One-screen surface: this component renders the active screen's
// widgets only. Screen switches in the designer call back into the
// wasm bridge with the new screen's widget list.

import { useEffect, useRef, useState } from 'react'
import type { Layout, Screen } from './schema'
import type { MetaZone, NotificationRow } from './api'
import type { SkValue } from './skStream'

// Shape of the bound emscripten module we use. We only declare what
// we actually touch — the rest stays opaque so unrelated emscripten
// API changes don't ripple into TypeScript build errors here.
interface JlpWasmModule {
  _jlp_init: (w: number, h: number) => number
  _jlp_apply_layout: (jsonPtr: number) => number
  _jlp_set_value_float: (pathPtr: number, v: number) => void
  _jlp_set_value_int: (pathPtr: number, v: number) => void
  _jlp_set_value_bool: (pathPtr: number, v: number) => void
  _jlp_set_path_meta: (pathPtr: number, metaJsonPtr: number) => void
  _jlp_set_notifications: (snapshotJsonPtr: number) => void
  _malloc: (n: number) => number
  _free: (p: number) => void
  stringToUTF8: (str: string, ptr: number, maxBytes: number) => void
  lengthBytesUTF8: (str: string) => number
  UTF8ToString: (ptr: number) => string
}

// Module-level singleton: the wasm runtime is global (one lv_disp,
// one canvas binding). Re-mounting the component just re-points the
// canvas; we don't tear LVGL down between mounts.
let modulePromise: Promise<JlpWasmModule> | null = null
let currentCanvas: HTMLCanvasElement | null = null
let inited = false

const loadModule = async (canvas: HTMLCanvasElement): Promise<JlpWasmModule> => {
  currentCanvas = canvas
  if (modulePromise) return modulePromise
  modulePromise = (async () => {
    // Vite copies /public/wasm/* into the build output verbatim. At
    // runtime the file sits next to index.html (when served by the
    // signalk-server plugin) under /plugins/signalk-hmi-designer/wasm/.
    // The base path is derived from the document so it works both in
    // `npm run dev` and in production.
    const base =
      typeof document !== 'undefined'
        ? new URL('./wasm/jlp_wasm.js', document.baseURI).href
        : './wasm/jlp_wasm.js'
    const imported = (await import(/* @vite-ignore */ base)) as {
      default: (opts: unknown) => Promise<JlpWasmModule>
    }
    const mod = await imported.default({
      canvas,
      print: (s: string) => console.warn('[jlp-wasm]', s),
      printErr: (s: string) => console.error('[jlp-wasm]', s),
    })
    return mod
  })()
  return modulePromise
}

// Helper: round-trip a JS string through wasm heap to a const char*.
const withCString = <T,>(
  mod: JlpWasmModule,
  s: string,
  fn: (ptr: number) => T
): T => {
  const len = mod.lengthBytesUTF8(s) + 1
  const ptr = mod._malloc(len)
  try {
    mod.stringToUTF8(s, ptr, len)
    return fn(ptr)
  } finally {
    mod._free(ptr)
  }
}

const applyScreen = (mod: JlpWasmModule, screen: Screen): string | null => {
  // Wrap the single screen into the top-level layout shape the
  // wasm bridge expects.
  const doc = {
    schema: 1,
    name: 'designer',
    screens: [screen],
  }
  const json = JSON.stringify(doc)
  const errStr = withCString(mod, json, (p) => {
    const errPtr = mod._jlp_apply_layout(p)
    return mod.UTF8ToString(errPtr)
  })
  return errStr || null
}

// Push SK meta (zones + description) for every path the designer
// has fetched so the wasm zone_registry can color widgets the same
// way the device does. Meta is per-path keyed; pushing the same
// path twice just overwrites in-place. Cheap enough to call before
// every layout apply (a typical helm has well under 50 bound
// paths).
const pushAllMeta = (
  mod: JlpWasmModule,
  zonesMap?: Map<string, MetaZone[]>,
  descMap?: Map<string, string>
): void => {
  const seen = new Set<string>()
  zonesMap?.forEach((_, p) => seen.add(p))
  descMap?.forEach((_, p) => seen.add(p))
  for (const path of seen) {
    const meta: { zones?: MetaZone[]; description?: string } = {}
    const z = zonesMap?.get(path)
    if (z && z.length > 0) meta.zones = z
    const d = descMap?.get(path)
    if (d) meta.description = d
    const json = JSON.stringify(meta)
    withCString(mod, path, (pathPtr) => {
      withCString(mod, json, (metaPtr) => {
        mod._jlp_set_path_meta(pathPtr, metaPtr)
      })
    })
  }
}

// Replace the wasm notifications snapshot in one shot. The wasm
// bridge diffs against its current set so removals propagate
// (cleared notifications drop out of the list widget). Safe to
// call before layout apply: the registry survives applies, and
// the list widget reads from it at build time.
const pushNotifications = (
  mod: JlpWasmModule,
  rows?: NotificationRow[]
): void => {
  const arr = rows ?? []
  const json = JSON.stringify(arr)
  withCString(mod, json, (p) => mod._jlp_set_notifications(p))
}

// Push every known SK value into the wasm subject registry. MUST be
// called AFTER applyScreen — the subjects only exist once widget
// builders ran get_or_create during the layout build. Routes each
// value to the typed setter that matches what the bridge expects
// for its subject kind (which the designer doesn't directly know;
// we use the JS value's runtime type as a proxy, matching how
// SubjectKind is chosen by each build_*).
const pushAllValues = (
  mod: JlpWasmModule,
  values?: Map<string, SkValue>
): void => {
  if (!values || values.size === 0) return
  for (const [path, v] of values) {
    if (v === null || v === undefined) continue
    withCString(mod, path, (pathPtr) => {
      if (typeof v === 'boolean') {
        mod._jlp_set_value_bool(pathPtr, v ? 1 : 0)
      } else if (typeof v === 'number') {
        // Arc / bar / range widgets use float subjects; toggles use
        // int subjects (the typed setters are no-ops if the subject
        // kind doesn't match, so it's safe to call both).
        mod._jlp_set_value_float(pathPtr, v)
        mod._jlp_set_value_int(pathPtr, Math.round(v))
      }
      // strings: not yet supported in the wasm bridge (the firmware
      // has SubjectKind::String but none of the v0.2 widgets read
      // it; label widgets prefer the SK description over the
      // formatted value anyway, via pathDescriptions).
    })
  }
}

export interface WasmCanvasProps {
  layout: Layout
  activeIdx: number
  /** Width/height of the device — matches the device's /hello.display. */
  displayW: number
  displayH: number
  /** SK zone metadata per bound path. Pushed into the wasm bridge so
   *  the LVGL widgets render with the same per-state colors the
   *  device shows. Zones live in raw units. */
  pathZones?: Map<string, MetaZone[]>
  /** Optional per-path SK description (used by label widgets that
   *  prefer the human-readable name over the raw value). */
  pathDescriptions?: Map<string, string>
  /** Live SK values per bound path. Pushed into the wasm subject
   *  registry so widgets show real readings (arc fills, bar levels,
   *  toggle state, label text) instead of defaults. */
  skValues?: Map<string, SkValue>
  /** Flat snapshot of the device-known notifications. Pushed into
   *  the wasm notifications registry so list widgets render the
   *  same rows the device's list shows. Empty / undefined means
   *  "no notifications" — the wasm registry will clear. */
  notifications?: NotificationRow[]
  /** Called with status / error strings so the toolbar can surface them. */
  onStatus?: (msg: string) => void
}

export function WasmCanvas({
  layout,
  activeIdx,
  displayW,
  displayH,
  pathZones,
  pathDescriptions,
  skValues,
  notifications,
  onStatus,
}: WasmCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [modReady, setModReady] = useState<JlpWasmModule | null>(null)

  // First mount → kick off the wasm load, then init LVGL once the
  // module resolves. Subsequent mounts (e.g. mode toggling) reuse
  // the already-loaded module.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    let cancelled = false
    onStatus?.('loading wasm…')
    loadModule(c)
      .then((mod) => {
        if (cancelled) return
        if (!inited) {
          const rc = mod._jlp_init(displayW, displayH)
          if (rc !== 0) {
            onStatus?.(`init failed: ${rc}`)
            return
          }
          inited = true
        } else if (currentCanvas !== c) {
          // Emscripten SDL binds to one canvas at module init. We
          // can't re-bind to a different canvas after the fact, so
          // remount-with-different-element warns instead of
          // attempting (and silently failing).
          onStatus?.('wasm bound to a different canvas; refresh the page to rebind')
        }
        setModReady(mod)
      })
      .catch((e) => onStatus?.(`load failed: ${e instanceof Error ? e.message : String(e)}`))
    return () => {
      cancelled = true
    }
    // displayW/H only matter on first init; the module is a singleton
    // so re-running on every change is wasted work. The intentionally-
    // empty dep array is correct here.
  }, [])  // eslint-disable-line

  // Re-apply the layout whenever the active screen, any of its
  // widgets, or any path meta changes. The wasm-side build is fast
  // (<5 ms for the four-widget smoke test); fine to do on every
  // state mutation. Meta MUST be pushed BEFORE the layout apply —
  // zone_registry.match() is consulted as widgets build, and any
  // path without a meta entry at that moment renders with the
  // fallback color even if the meta arrives a tick later.
  useEffect(() => {
    if (!modReady) return
    const screen = layout.screens[activeIdx] ?? layout.screens[0]
    if (!screen) return
    pushAllMeta(modReady, pathZones, pathDescriptions)
    pushNotifications(modReady, notifications)
    const err = applyScreen(modReady, screen)
    if (err) {
      onStatus?.(`apply: ${err}`)
      return
    }
    // Values flow AFTER apply: subjects are created during the
    // build, so any path's lv_subject_t exists only once apply
    // succeeds. Re-pushing every known value here is cheap and
    // covers both fresh applies and downstream value updates.
    pushAllValues(modReady, skValues)
    onStatus?.(`${screen.widgets.length} widgets`)
  }, [
    modReady,
    layout,
    activeIdx,
    pathZones,
    pathDescriptions,
    skValues,
    notifications,
    onStatus,
  ])

  return (
    <canvas
      ref={canvasRef}
      width={displayW}
      height={displayH}
      style={{
        display: 'block',
        position: 'absolute',
        inset: 0,
        // Sit BEHIND tile chrome (the chrome bar bumps to z=50 in
        // wasm mode via app.css; outline stays visible via
        // !important on the same selector). pointer-events: none so
        // clicks pass through to the React-Grid-Layout tiles.
        zIndex: 10,
        pointerEvents: 'none',
        background: '#0d1117',
      }}
    />
  )
}
