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

// Shape of the bound emscripten module we use. We only declare what
// we actually touch — the rest stays opaque so unrelated emscripten
// API changes don't ripple into TypeScript build errors here.
interface JlpWasmModule {
  _jlp_init: (w: number, h: number) => number
  _jlp_apply_layout: (jsonPtr: number) => number
  _jlp_set_value_float: (pathPtr: number, v: number) => void
  _jlp_set_value_int: (pathPtr: number, v: number) => void
  _jlp_set_value_bool: (pathPtr: number, v: number) => void
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

export interface WasmCanvasProps {
  layout: Layout
  activeIdx: number
  /** Width/height of the device — matches the device's /hello.display. */
  displayW: number
  displayH: number
  /** Called with status / error strings so the toolbar can surface them. */
  onStatus?: (msg: string) => void
}

export function WasmCanvas({
  layout,
  activeIdx,
  displayW,
  displayH,
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

  // Re-apply the layout whenever the active screen or any of its
  // widgets change. The wasm-side build is fast (<5 ms for the
  // four-widget smoke test); fine to do on every state mutation.
  useEffect(() => {
    if (!modReady) return
    const screen = layout.screens[activeIdx] ?? layout.screens[0]
    if (!screen) return
    const err = applyScreen(modReady, screen)
    if (err) onStatus?.(`apply: ${err}`)
    else onStatus?.(`${screen.widgets.length} widgets`)
  }, [modReady, layout, activeIdx, onStatus])

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
