import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { type Layout as GLLayout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { WidgetPreview } from './WidgetPreview'
import { useNotifications, useSkValues } from './skStream'
import { DEFAULT_TAB_STRIP_HEIGHT, STATUS_OVERLAY_HEIGHT } from './schema'

import {
  deriveDisplayDefaults,
  fetchHello,
  fetchPathMeta,
  fetchScreenshot,
  fetchSelfPaths,
  loadSavedLayout,
  pushLayout,
  saveLayout,
  type MetaZone,
  type PushResult
} from './api'
import { Layout, Screen, Widget, WidgetKind, HelloResponse } from './schema'
import './app.css'

declare const __PLUGIN_VERSION__: string

/* ---------- helpers ---------- */

// react-grid-layout uses unitless column/row coordinates. We translate
// to device pixels on export. Column width is derived per-render from
// the target display's `display.w` reported in /hello; rows are a
// fixed pixel height for stability across different aspect ratios.
const COLS = 24
const ROW_HEIGHT = 25
const ROW_PX_H = ROW_HEIGHT
// Fallback width used before a device has connected (hello not loaded
// yet). 1024 matches the Waveshare 7B which we develop against.
const DEFAULT_DISPLAY_W = 1024
const DEFAULT_DISPLAY_H = 600

/** Every SK path a widget binds. Top-level for most kinds; the
 *  sub-bars inside a bargroup each contribute their own path. */
function bindsOf(w: Widget): string[] {
  const out: string[] = []
  if ('bind' in w && w.bind) out.push(w.bind)
  if (w.type === 'bargroup') {
    for (const b of w.bars) if (b.bind) out.push(b.bind)
  }
  return out
}

/** Returns the first `<prefix>-<n>` not already present in `existing`. */
function freshId(prefix: string, existing: ReadonlyArray<{ id: string }>): string {
  const taken = new Set(existing.map((w) => w.id))
  for (let n = 1; n < 1_000_000; n++) {
    const candidate = `${prefix}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('genId exhausted (somehow)')
}

function defaultWidget(kind: WidgetKind, existing: ReadonlyArray<{ id: string }>): Widget {
  const id = freshId(kind, existing)
  const base = {
    id,
    x: 0,
    y: 0,
    w: 240,
    h: 100,
    label: kind
  } as const
  switch (kind) {
    case 'label':
      return {
        ...base,
        type: 'label',
        display: { unit: '', scale: 1, offset: 0, decimals: 1 }
      }
    case 'toggle':
      return { ...base, type: 'toggle', bind: '' }
    case 'arc':
      return {
        ...base,
        type: 'arc',
        bind: '',
        min: 0,
        max: 100,
        display: { unit: '', scale: 1, offset: 0, decimals: 0 }
      }
    case 'bar':
      return {
        ...base,
        type: 'bar',
        bind: '',
        min: 0,
        max: 100,
        display: { unit: '', scale: 1, offset: 0, decimals: 0 }
      }
    case 'bargroup':
      return {
        ...base,
        type: 'bargroup',
        w: 360,
        h: 160,
        bars: [
          { label: 'A', bind: '', min: 0, max: 100 },
          { label: 'B', bind: '', min: 0, max: 100 },
          { label: 'C', bind: '', min: 0, max: 100 }
        ]
      }
    case 'button':
      return {
        ...base,
        type: 'button',
        bind: '',
        press_value: 1
      }
    case 'list':
      return {
        ...base,
        type: 'list',
        w: 480,
        h: 320,
        bind: 'notifications',
        max_rows: 8,
        columns: [
          { label: 'PATH', field: 'path', width: 220 },
          { label: 'STATE', field: 'state', width: 80 },
          { label: 'MSG', field: 'message', width: 180 }
        ],
        row_color_field: 'state'
      }
  }
}

/* ---------- layout <-> grid conversion ---------- */

interface GridSpec {
  i: string
  x: number
  y: number
  w: number
  h: number
}

function widgetToGrid(w: Widget, colPxW: number): GridSpec {
  return {
    i: w.id,
    x: Math.round(w.x / colPxW),
    y: Math.round(w.y / ROW_PX_H),
    w: Math.max(1, Math.round(w.w / colPxW)),
    h: Math.max(1, Math.round(w.h / ROW_PX_H))
  }
}

function applyGrid(w: Widget, g: GLLayout, colPxW: number): Widget {
  return {
    ...w,
    x: Math.round(g.x * colPxW),
    y: Math.round(g.y * ROW_PX_H),
    w: Math.round(g.w * colPxW),
    h: Math.round(g.h * ROW_PX_H)
  }
}

/* ---------- the app ---------- */

export function App(): JSX.Element {
  const [deviceUrl, setDeviceUrl] = useState<string>(
    'http://p4-cockpit.local:8081'
  )
  const [hello, setHello] = useState<HelloResponse | null>(null)
  const [helloErr, setHelloErr] = useState<string | null>(null)

  const [paths, setPaths] = useState<string[]>([])
  const [pathFilter, setPathFilter] = useState<string>('')

  const [screens, setScreens] = useState<Screen[]>([
    { id: 'main', title: 'Main', widgets: [] }
  ])
  const [activeIdx, setActiveIdx] = useState<number>(0)
  const [statusOverlay, setStatusOverlay] = useState<boolean>(true)
  const [notifConfig, setNotifConfig] = useState<
    Layout['notifications'] | undefined
  >(undefined)
  const [showNotifModal, setShowNotifModal] = useState<boolean>(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // The currently-active screen. Reads use this; writes use setActive().
  // Multi-screen layouts: tab strip at the bottom of canvas switches.
  const screen = screens[activeIdx] ?? screens[0] ?? {
    id: 'main',
    title: 'Main',
    widgets: []
  }

  // Replace the active screen with a new value. Helper because every
  // legacy site that did setScreen((prev) => ...) now needs to splice
  // into the screens array at activeIdx.
  const setScreen = (
    update: Screen | ((prev: Screen) => Screen)
  ): void => {
    setScreens((prev) => {
      const cur = prev[activeIdx] ?? prev[0]
      if (!cur) return prev
      const next = typeof update === 'function' ? update(cur) : update
      const out = [...prev]
      out[activeIdx] = next
      return out
    })
  }
  const [pathZones, setPathZones] = useState<Map<string, MetaZone[]>>(
    () => new Map()
  )
  // SK meta `description` per bound path; LabelPreview prefers this
  // over the formatted value (matches firmware behaviour).
  const [pathDescriptions, setPathDescriptions] = useState<Map<string, string>>(
    () => new Map()
  )
  const [shotUrl, setShotUrl] = useState<string | null>(null)
  const [shotOpacity, setShotOpacity] = useState<number>(0.5)
  const [shotErr, setShotErr] = useState<string | null>(null)
  const [shotBusy, setShotBusy] = useState<boolean>(false)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [pushErr, setPushErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchSelfPaths()
      .then(setPaths)
      .catch(() => setPaths([]))
  }, [])

  // Restore previously-saved layout on first mount. Hydrates all
  // screens (multi-screen support); zones are pre-fetched for every
  // bound path across every screen.
  useEffect(() => {
    void loadSavedLayout()
      .then((saved) => {
        if (!saved) return
        if (saved.screens.length > 0) {
          setScreens(saved.screens)
          setActiveIdx(0)
          for (const scr of saved.screens) {
            for (const w of scr.widgets) {
              for (const p of bindsOf(w)) {
                void fetchPathMeta(p).then((meta) => {
                  if (!meta) return
                  if (meta.zones && meta.zones.length > 0) {
                    setPathZones((prev) => {
                      const next = new Map(prev)
                      next.set(p, meta.zones!)
                      return next
                    })
                  }
                  if (meta.description) {
                    setPathDescriptions((prev) => {
                      const next = new Map(prev)
                      next.set(p, meta.description!)
                      return next
                    })
                  }
                })
              }
            }
          }
        }
        if (saved.status_overlay !== undefined) {
          setStatusOverlay(saved.status_overlay)
        }
        if (saved.notifications !== undefined) {
          setNotifConfig(saved.notifications)
        }
      })
      .catch(() => {
        /* nothing to restore — leave the empty default */
      })
  }, [])

  const layoutDoc: Layout = useMemo(
    () => ({
      schema: 1,
      name: 'Designer',
      status_overlay: statusOverlay,
      ...(notifConfig ? { notifications: notifConfig } : {}),
      screens
    }),
    [screens, statusOverlay, notifConfig]
  )

  // Canvas dimensions track the connected device's /hello.display
  // so the designer is 1:1 with whatever panel it's targeting.
  // Before Connect, fall back to the Waveshare 7B native resolution.
  const displayW = hello?.display?.w ?? DEFAULT_DISPLAY_W
  const displayH = hello?.display?.h ?? DEFAULT_DISPLAY_H
  const colPxW = displayW / COLS
  // Tab strip is rendered only when there's more than one screen, to
  // match the firmware (which hides the strip in that case).
  const tabStripHeight = DEFAULT_TAB_STRIP_HEIGHT
  const showTabStrip = screens.length > 1

  const grid = useMemo(
    () => screen.widgets.map((w) => widgetToGrid(w, colPxW)),
    [screen.widgets, colPxW]
  )

  // Live SK values for any bound widget. The hook re-subscribes when
  // the set of bound paths changes. Includes top-level widget binds
  // AND sub-bar binds inside bargroup widgets so per-bar tinting and
  // value display work in the canvas preview.
  const boundPaths = useMemo(
    () => screens.flatMap((s) => s.widgets.flatMap(bindsOf)),
    [screens]
  )
  const skValues = useSkValues(boundPaths)

  // List widgets bound to the synthetic "notifications" path pull
  // from a separate REST-poll source. Only enable the poll if at
  // least one list widget needs it (avoids hammering the server
  // when the layout doesn't use notifications at all).
  const wantsNotifications = useMemo(
    () =>
      screens.some((s) =>
        s.widgets.some(
          (w) => w.type === 'list' && w.bind === 'notifications'
        )
      ),
    [screens]
  )
  const notifications = useNotifications(wantsNotifications)
  const selected = screen.widgets.find((w) => w.id === selectedId) ?? null

  const filteredPaths = useMemo(() => {
    if (!pathFilter) return paths
    const f = pathFilter.toLowerCase()
    return paths.filter((p) => p.toLowerCase().includes(f))
  }, [paths, pathFilter])

  // Apply RGL geometry back to state ONLY for the single widget the
  // user just dragged or resized. Uses onDragStop / onResizeStop
  // (not onLayoutChange) because the latter fires on mount, remount,
  // and any layout-prop change — including tab switches, paste, load
  // — and writing those back to state grid-quantizes pixel positions,
  // drifting widgets over time.
  const onDragStop = (
    _layout: GLLayout[],
    _oldItem: GLLayout,
    newItem: GLLayout
  ): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === newItem.i ? applyGrid(w, newItem, colPxW) : w
      )
    }))
  }
  const onResizeStop = onDragStop

  /* ---- screen management ---- */

  const addScreen = (): void => {
    setScreens((prev) => {
      const taken = new Set(prev.map((s) => s.id))
      let n = prev.length + 1
      let id = `screen${n}`
      while (taken.has(id)) {
        n++
        id = `screen${n}`
      }
      const next = [...prev, { id, title: `Tab ${n}`, widgets: [] }]
      setActiveIdx(next.length - 1)
      return next
    })
    setSelectedId(null)
  }

  const removeScreen = (idx: number): void => {
    setScreens((prev) => {
      if (prev.length <= 1) return prev // keep at least one
      const next = prev.filter((_, i) => i !== idx)
      // Keep active in range; prefer the screen to the left.
      setActiveIdx((cur) => {
        if (cur > idx) return cur - 1
        if (cur === idx) return Math.max(0, idx - 1)
        return cur
      })
      return next
    })
    setSelectedId(null)
  }

  const renameScreen = (idx: number, title: string): void => {
    setScreens((prev) => {
      const cur = prev[idx]
      if (!cur) return prev
      const out = [...prev]
      out[idx] = { ...cur, title }
      return out
    })
  }

  const addWidget = (kind: WidgetKind): void => {
    // Pick a fresh id based on the *current* set so we don't collide
    // with anything already in the layout (e.g. loaded from server).
    setScreen((prev) => {
      const w = defaultWidget(kind, prev.widgets)
      setSelectedId(w.id)
      return { ...prev, widgets: [...prev.widgets, w] }
    })
  }

  const removeWidget = (id: string): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.id !== id)
    }))
    if (selectedId === id) setSelectedId(null)
  }

  /* ---- copy/paste clipboard (in-memory, session-scoped) ---- */
  const clipboardRef = useRef<Widget | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const copySelected = (): void => {
    const w = screen.widgets.find((x) => x.id === selectedId)
    if (!w) return
    clipboardRef.current = w
  }

  const pasteFromClipboard = (): void => {
    const src = clipboardRef.current
    if (!src) return
    setScreen((prev) => {
      const kind = src.type
      // Keep the existing id-prefix scheme so the paste fits in.
      const id = freshId(kind, prev.widgets)
      // Offset the paste so it doesn't overlap the source exactly.
      // 20 device-px down+right is enough to be obviously a copy
      // without leaving the visible area.
      const pasted = {
        ...src,
        id,
        x: src.x + 20,
        y: src.y + 20
      } as Widget
      setSelectedId(id)
      return { ...prev, widgets: [...prev.widgets, pasted] }
    })
  }

  // Wire Ctrl/Cmd-C / Ctrl/Cmd-V to copy/paste. Ignore when the user
  // is typing in an input/textarea so native text copy/paste still
  // works in the property panels and path filter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (t?.isContentEditable ?? false)
      if (isEditable) return
      if (e.key === 'c' || e.key === 'C') {
        if (!selectedId) return
        e.preventDefault()
        copySelected()
      } else if (e.key === 'v' || e.key === 'V') {
        if (!clipboardRef.current) return
        e.preventDefault()
        pasteFromClipboard()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, screen.widgets, activeIdx])

  const updateWidget = (id: string, patch: Partial<Widget>): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === id ? ({ ...w, ...patch } as Widget) : w
      )
    }))
  }

  // Setting the bind ALSO triggers a metadata fetch from SK and
  // prefills any unfilled display fields (unit/scale/offset/decimals).
  // User-modified fields aren't overwritten — only empty/default
  // values get filled. Toggle / button widgets have no display block,
  // so the fetch is skipped.
  const applyBind = (id: string, path: string): void => {
    updateWidget(id, { bind: path })
    if (!path) return
    void fetchPathMeta(path).then((meta) => {
      if (!meta) return
      if (meta.zones && meta.zones.length > 0) {
        setPathZones((prev) => {
          const next = new Map(prev)
          next.set(path, meta.zones!)
          return next
        })
      }
      if (meta.description) {
        setPathDescriptions((prev) => {
          const next = new Map(prev)
          next.set(path, meta.description!)
          return next
        })
      }
      const d = deriveDisplayDefaults(meta)
      if (!d) return
      setScreen((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) => {
          if (w.id !== id) return w
          // Only widgets that have a display block get prefilled.
          if (
            w.type !== 'label' &&
            w.type !== 'arc' &&
            w.type !== 'bar' &&
            w.type !== 'button'
          ) {
            return w
          }
          const cur = w.display ?? {}
          const merged = {
            unit: cur.unit && cur.unit !== '' ? cur.unit : d.unit,
            scale: cur.scale !== undefined && cur.scale !== 1 ? cur.scale : d.scale,
            offset:
              cur.offset !== undefined && cur.offset !== 0 ? cur.offset : d.offset,
            decimals:
              cur.decimals !== undefined && cur.decimals !== 1
                ? cur.decimals
                : d.decimals
          }
          return { ...w, display: merged } as Widget
        })
      }))
    })
  }

  const onConnect = async (): Promise<void> => {
    setHelloErr(null)
    setHello(null)
    try {
      const h = await fetchHello(deviceUrl)
      setHello(h)
    } catch (e) {
      setHelloErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onTakeScreenshot = async (): Promise<void> => {
    setShotErr(null)
    setShotBusy(true)
    try {
      const blob = await fetchScreenshot(deviceUrl)
      // Replace the previous blob URL (free its memory).
      if (shotUrl) URL.revokeObjectURL(shotUrl)
      setShotUrl(URL.createObjectURL(blob))
    } catch (e) {
      setShotErr(e instanceof Error ? e.message : String(e))
    } finally {
      setShotBusy(false)
    }
  }

  const onHideScreenshot = (): void => {
    if (shotUrl) URL.revokeObjectURL(shotUrl)
    setShotUrl(null)
    setShotErr(null)
  }

  /* ---- file ops: save / load / export / import / clear ---- */

  const [fileMsg, setFileMsg] = useState<string | null>(null)

  /** One-shot migration for layouts saved under v0.1 schema:
   *
   *  - button widgets with `action: {put: {value, path?}}` are
   *    rewritten to `{bind: path ?? bind, press_value: value}`.
   *
   *  Non-button widgets pass through. New widgets authored in v0.2+
   *  never use the old shape.
   */
  const migrateLayout = (l: Layout): Layout => {
    return {
      ...l,
      screens: l.screens.map((s) => ({
        ...s,
        widgets: s.widgets.map((w) => {
          if (w.type !== 'button') return w
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const legacy = w as any
          if (legacy.action?.put && legacy.press_value === undefined) {
            const { action: _drop, ...rest } = legacy
            void _drop
            return {
              ...rest,
              bind: legacy.action.put.path ?? w.bind ?? '',
              press_value: legacy.action.put.value
            } as Widget
          }
          return w
        })
      }))
    }
  }

  // Replaces the entire designer state (screens + statusOverlay) with
  // a loaded Layout. Also re-fetches zones for every bound path so
  // colors appear immediately.
  const adoptLayout = (raw: Layout): void => {
    const l = migrateLayout(raw)
    setScreens(l.screens.length > 0 ? l.screens : [
      { id: 'main', title: 'Main', widgets: [] }
    ])
    setActiveIdx(0)
    setSelectedId(null)
    if (l.status_overlay !== undefined) setStatusOverlay(l.status_overlay)
    if (l.notifications !== undefined) setNotifConfig(l.notifications)
    for (const scr of l.screens) {
      for (const w of scr.widgets) {
        for (const p of bindsOf(w)) {
          void fetchPathMeta(p).then((meta) => {
            if (!meta) return
            if (meta.zones && meta.zones.length > 0) {
              setPathZones((prev) => {
                const next = new Map(prev)
                next.set(p, meta.zones!)
                return next
              })
            }
            if (meta.description) {
              setPathDescriptions((prev) => {
                const next = new Map(prev)
                next.set(p, meta.description!)
                return next
              })
            }
          })
        }
      }
    }
  }

  const onSave = async (): Promise<void> => {
    setFileMsg(null)
    try {
      await saveLayout(layoutDoc)
      setFileMsg('saved to SK server')
    } catch (e) {
      setFileMsg(`save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onLoad = async (): Promise<void> => {
    setFileMsg(null)
    if (!confirm('Load saved layout from SK server? Unsaved edits will be lost.')) return
    try {
      const saved = await loadSavedLayout()
      if (!saved) {
        setFileMsg('no saved layout on server')
        return
      }
      adoptLayout(saved)
      setFileMsg('loaded from SK server')
    } catch (e) {
      setFileMsg(`load failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onExport = (): void => {
    const blob = new Blob([JSON.stringify(layoutDoc, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = (layoutDoc.name || 'layout').replace(/[^a-z0-9_-]/gi, '_')
    a.href = url
    a.download = `${safeName}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setFileMsg(`exported ${safeName}.json`)
  }

  const onImportFile = async (file: File): Promise<void> => {
    setFileMsg(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Layout
      if (parsed.schema !== 1 || !Array.isArray(parsed.screens)) {
        throw new Error('not a valid layout (schema 1 with screens[])')
      }
      adoptLayout(parsed)
      setFileMsg(`imported ${file.name}`)
    } catch (e) {
      setFileMsg(`import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onClear = (): void => {
    if (!confirm('Clear the canvas? All screens and widgets will be removed.')) return
    setScreens([{ id: 'main', title: 'Main', widgets: [] }])
    setActiveIdx(0)
    setSelectedId(null)
    setFileMsg('cleared')
  }

  const onPush = async (): Promise<void> => {
    setPushErr(null)
    setPushResult(null)
    try {
      const r = await pushLayout(deviceUrl, layoutDoc)
      setPushResult(r)
      // Persist on successful device push (not on validation failure).
      // Save errors are non-fatal — surface but don't overwrite the
      // push success message.
      if (r.ok) {
        try {
          await saveLayout(layoutDoc)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('layout saved on device but failed to persist on SK:', e)
        }
      }
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : String(e))
    }
  }

  const availableKinds = useMemo<WidgetKind[]>(() => {
    if (!hello)
      return ['label', 'toggle', 'arc', 'bar', 'bargroup', 'button', 'list']
    return Object.keys(hello.widgets).filter(
      (k): k is WidgetKind =>
        k === 'label' ||
        k === 'toggle' ||
        k === 'arc' ||
        k === 'bar' ||
        k === 'bargroup' ||
        k === 'button' ||
        k === 'list'
    )
  }, [hello])

  return (
    <div
      className="hmi-app"
      // Click anywhere not absorbed by a tile or interactive control
      // clears the selection. Tile clicks stopPropagation below; form
      // controls naturally don't bubble through to here in a way that
      // matters because they don't change selection state.
      onClick={() => setSelectedId(null)}
    >
      <header>
        <div className="brand">
          <strong>HMI Designer</strong>
          <span className="ver">v{__PLUGIN_VERSION__}</span>
        </div>
        <div className="topbar-device">
          <input
            type="text"
            className="topbar-url"
            value={deviceUrl}
            onChange={(e) => setDeviceUrl(e.target.value)}
            placeholder="http://p4-cockpit.local:8081"
          />
          <button onClick={() => void onConnect()}>Connect</button>
          <button className="primary" onClick={() => void onPush()}>
            Push
          </button>
          <label
            className="topbar-toggle"
            title="Show the device's status strip at top of screen"
          >
            <input
              type="checkbox"
              checked={statusOverlay}
              onChange={(e) => setStatusOverlay(e.target.checked)}
            />
            status bar
          </label>
          <button
            onClick={() =>
              shotUrl ? onHideScreenshot() : void onTakeScreenshot()
            }
            disabled={shotBusy}
            title="Fetch the device's current screen and overlay it on the canvas"
          >
            {shotBusy ? '…' : shotUrl ? 'Hide device' : 'Show device'}
          </button>
          {shotUrl && (
            <label
              className="topbar-toggle"
              title="Overlay opacity"
              style={{ minWidth: 80 }}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={shotOpacity}
                onChange={(e) => setShotOpacity(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        <div className="topbar-status">
          {hello && (
            <span className="topbar-hello">
              {hello.firmware ?? 'device'} ·{' '}
              {hello.display ? `${hello.display.w}×${hello.display.h} · ` : ''}
              schema {hello.schema}
              {hello.active_layout_name &&
                ` · active: ${hello.active_layout_name} (${hello.layout_source ?? '?'})`}
            </span>
          )}
          {helloErr && <span className="err">{helloErr}</span>}
          {pushErr && <span className="err">{pushErr}</span>}
          {shotErr && <span className="err">{shotErr}</span>}
          {pushResult && (
            <span className={pushResult.ok ? 'ok' : 'err'}>
              {pushResult.ok
                ? `pushed — ${pushResult.screens} screens, ${pushResult.widgets} widgets`
                : (pushResult.err ?? 'push failed')}
            </span>
          )}
          {fileMsg && <span className="muted small">{fileMsg}</span>}
        </div>
        <div className="topbar-files">
          <button onClick={() => void onSave()} title="Save to SK server">
            Save
          </button>
          <button onClick={() => void onLoad()} title="Load from SK server">
            Load
          </button>
          <button onClick={onExport} title="Download JSON file">
            Export
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload a JSON file"
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              // Reset so picking the same file again still fires onChange.
              e.target.value = ''
            }}
          />
          <button
            onClick={onClear}
            title="Reset to a single empty screen"
            className="danger"
          >
            Clear
          </button>
          <button
            onClick={() => setShowNotifModal(true)}
            title="Configure the device alert overlay"
          >
            Notifications
          </button>
        </div>
      </header>

      {showNotifModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowNotifModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Alert overlay</h3>
            <p className="muted small">
              Layout-level setting. The device pops a full-screen modal
              above the active screen whenever SK publishes a
              notification with state &gt;= min state. Tapping ACK on
              the device PUTs <code>state: "normal"</code> to the
              notification path. Defaults: enabled, alarm.
            </p>
            <label>
              <input
                type="checkbox"
                checked={notifConfig?.enabled ?? true}
                onChange={(e) =>
                  setNotifConfig({
                    enabled: e.target.checked,
                    min_state: notifConfig?.min_state ?? 'alarm',
                    ack_method: 'modal'
                  })
                }
              />
              enabled
            </label>
            <label>
              min state
              <select
                value={notifConfig?.min_state ?? 'alarm'}
                onChange={(e) =>
                  setNotifConfig({
                    enabled: notifConfig?.enabled ?? true,
                    min_state: e.target.value as NonNullable<
                      Layout['notifications']
                    >['min_state'],
                    ack_method: 'modal'
                  })
                }
              >
                <option value="alert">alert</option>
                <option value="warn">warn</option>
                <option value="alarm">alarm</option>
                <option value="emergency">emergency</option>
              </select>
            </label>
            <label>
              ack method
              <select value="modal" disabled>
                <option value="modal">modal</option>
              </select>
            </label>
            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => {
                  setNotifConfig(undefined)
                  setShowNotifModal(false)
                }}
                title="Drop the notifications block (firmware defaults apply)"
              >
                clear
              </button>
              <button onClick={() => setShowNotifModal(false)}>done</button>
            </div>
          </div>
        </div>
      )}

      <div className="cols">
        {/* ---- left column: palette + selected props ---- */}
        <aside className="col left" onClick={(e) => e.stopPropagation()}>
          <h3>Add widget</h3>
          <div className="palette">
            {availableKinds.map((k) => (
              <button key={k} onClick={() => addWidget(k)}>
                + {k}
              </button>
            ))}
          </div>

          <h3>Selected</h3>
          {!selected && <p className="muted">click a tile to edit</p>}
          {selected && (
            <div className="props">
              <label>
                id
                <input value={selected.id} readOnly />
              </label>
              <label>
                label
                <input
                  value={selected.label ?? ''}
                  onChange={(e) =>
                    updateWidget(selected.id, { label: e.target.value })
                  }
                />
              </label>
              <label>
                bind (SK path)
                <input
                  value={selected.bind ?? ''}
                  onChange={(e) => applyBind(selected.id, e.target.value)}
                />
              </label>
              {(selected.type === 'arc' || selected.type === 'bar') && (
                <>
                  <label>
                    min
                    <input
                      type="number"
                      value={selected.min}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          min: Number(e.target.value)
                        })
                      }
                    />
                  </label>
                  <label>
                    max
                    <input
                      type="number"
                      value={selected.max}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          max: Number(e.target.value)
                        })
                      }
                    />
                  </label>
                </>
              )}
              {selected.type === 'arc' && (
                <>
                  <label>
                    ticks
                    <input
                      type="number"
                      min={0}
                      value={selected.ticks ?? 0}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          ticks: Number(e.target.value) || undefined
                        })
                      }
                    />
                  </label>
                  <label>
                    tick labels
                    <input
                      type="checkbox"
                      checked={Boolean(selected.tick_labels)}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          tick_labels: e.target.checked || undefined
                        })
                      }
                    />
                  </label>
                  <fieldset className="bands">
                    <legend>bands</legend>
                    {(selected.bands ?? []).map((b, i) => (
                      <div className="band-row" key={i}>
                        <input
                          type="number"
                          value={b.from}
                          title="from"
                          onChange={(e) => {
                            const next = [...(selected.bands ?? [])]
                            next[i] = { ...b, from: Number(e.target.value) }
                            updateWidget(selected.id, { bands: next })
                          }}
                        />
                        <input
                          type="number"
                          value={b.to}
                          title="to"
                          onChange={(e) => {
                            const next = [...(selected.bands ?? [])]
                            next[i] = { ...b, to: Number(e.target.value) }
                            updateWidget(selected.id, { bands: next })
                          }}
                        />
                        <input
                          type="color"
                          value={b.color}
                          onChange={(e) => {
                            const next = [...(selected.bands ?? [])]
                            next[i] = { ...b, color: e.target.value }
                            updateWidget(selected.id, { bands: next })
                          }}
                        />
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            const next = (selected.bands ?? []).filter(
                              (_, j) => j !== i
                            )
                            updateWidget(selected.id, {
                              bands: next.length ? next : undefined
                            })
                          }}
                          title="Remove band"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        const cur = selected.bands ?? []
                        // Suggest a band spanning the upper third of
                        // the range — useful "warn zone" default.
                        const span = selected.max - selected.min
                        const next = [
                          ...cur,
                          {
                            from: selected.min + span * 0.7,
                            to: selected.max,
                            color: '#d29922'
                          }
                        ]
                        updateWidget(selected.id, { bands: next })
                      }}
                    >
                      + add band
                    </button>
                  </fieldset>
                </>
              )}
              {selected.type === 'bargroup' && (
                <>
                  <fieldset className="bands">
                    <legend>bars</legend>
                    {selected.bars.map((b, i) => (
                      <div className="band-row" key={i}>
                        <input
                          value={b.label}
                          title="label"
                          onChange={(e) => {
                            const next = [...selected.bars]
                            next[i] = { ...b, label: e.target.value }
                            updateWidget(selected.id, { bars: next })
                          }}
                        />
                        <input
                          value={b.bind}
                          placeholder="signalk.path"
                          title="bind"
                          onChange={(e) => {
                            const next = [...selected.bars]
                            next[i] = { ...b, bind: e.target.value }
                            updateWidget(selected.id, { bars: next })
                          }}
                        />
                        <input
                          type="number"
                          value={b.min}
                          title="min"
                          onChange={(e) => {
                            const next = [...selected.bars]
                            next[i] = { ...b, min: Number(e.target.value) }
                            updateWidget(selected.id, { bars: next })
                          }}
                        />
                        <input
                          type="number"
                          value={b.max}
                          title="max"
                          onChange={(e) => {
                            const next = [...selected.bars]
                            next[i] = { ...b, max: Number(e.target.value) }
                            updateWidget(selected.id, { bars: next })
                          }}
                        />
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            const next = selected.bars.filter(
                              (_, j) => j !== i
                            )
                            // Keep at least one bar; refuse to drop the last.
                            if (next.length === 0) return
                            updateWidget(selected.id, { bars: next })
                          }}
                          title="Remove bar"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        const next = [
                          ...selected.bars,
                          { label: '', bind: '', min: 0, max: 100 }
                        ]
                        updateWidget(selected.id, { bars: next })
                      }}
                    >
                      + add bar
                    </button>
                  </fieldset>
                </>
              )}
              {selected.type === 'list' && (
                <>
                  <label>
                    max rows
                    <input
                      type="number"
                      min={1}
                      value={selected.max_rows ?? 8}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          max_rows: Math.max(1, Number(e.target.value))
                        })
                      }
                    />
                  </label>
                  <label>
                    row height
                    <input
                      type="number"
                      min={16}
                      value={selected.row_height ?? 28}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          row_height: Math.max(16, Number(e.target.value))
                        })
                      }
                    />
                  </label>
                  <label>
                    row color field
                    <input
                      value={selected.row_color_field ?? ''}
                      placeholder="state"
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          row_color_field: e.target.value || undefined
                        })
                      }
                    />
                  </label>
                  <fieldset className="bands">
                    <legend>columns</legend>
                    {selected.columns.map((c, i) => (
                      <div className="band-row" key={i}>
                        <input
                          value={c.label}
                          title="header"
                          onChange={(e) => {
                            const next = [...selected.columns]
                            next[i] = { ...c, label: e.target.value }
                            updateWidget(selected.id, { columns: next })
                          }}
                        />
                        <input
                          value={c.field}
                          title="field (dotted path)"
                          placeholder="path"
                          onChange={(e) => {
                            const next = [...selected.columns]
                            next[i] = { ...c, field: e.target.value }
                            updateWidget(selected.id, { columns: next })
                          }}
                        />
                        <input
                          type="number"
                          value={c.width ?? 100}
                          title="width px"
                          onChange={(e) => {
                            const next = [...selected.columns]
                            next[i] = { ...c, width: Number(e.target.value) }
                            updateWidget(selected.id, { columns: next })
                          }}
                        />
                        <input
                          value={c.format ?? ''}
                          title="format"
                          placeholder="%s"
                          onChange={(e) => {
                            const next = [...selected.columns]
                            next[i] = { ...c, format: e.target.value || undefined }
                            updateWidget(selected.id, { columns: next })
                          }}
                        />
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            const next = selected.columns.filter(
                              (_, j) => j !== i
                            )
                            if (next.length === 0) return
                            updateWidget(selected.id, { columns: next })
                          }}
                          title="Remove column"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        const next = [
                          ...selected.columns,
                          { label: '', field: '', width: 100 }
                        ]
                        updateWidget(selected.id, { columns: next })
                      }}
                    >
                      + add column
                    </button>
                  </fieldset>
                </>
              )}
              {selected.type === 'button' && (
                <>
                  <label>
                    press value
                    <input
                      value={String(selected.press_value ?? '')}
                      onChange={(e) => {
                        const t = e.target.value
                        const n = Number(t)
                        const v: boolean | number | string =
                          t === 'true'
                            ? true
                            : t === 'false'
                              ? false
                              : !isNaN(n) && t !== ''
                                ? n
                                : t
                        updateWidget(selected.id, { press_value: v })
                      }}
                    />
                  </label>
                  <label>
                    release value
                    <input
                      value={
                        selected.release_value === undefined
                          ? ''
                          : String(selected.release_value)
                      }
                      placeholder="(no release PUT)"
                      onChange={(e) => {
                        const t = e.target.value
                        if (t === '') {
                          updateWidget(selected.id, {
                            release_value: undefined
                          })
                          return
                        }
                        const n = Number(t)
                        const v: boolean | number | string =
                          t === 'true'
                            ? true
                            : t === 'false'
                              ? false
                              : !isNaN(n)
                                ? n
                                : t
                        updateWidget(selected.id, { release_value: v })
                      }}
                    />
                  </label>
                  <label>
                    hold ms
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={selected.hold_ms ?? 0}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        updateWidget(selected.id, {
                          hold_ms: n > 0 ? n : undefined
                        })
                      }}
                    />
                  </label>
                  <div className="muted small">
                    With release_value set, this is a momentary button
                    (PUT on press, PUT on release). Without, it's a
                    one-shot action. hold_ms requires sustained press
                    before any PUT fires — safety latch for STOP, etc.
                  </div>
                </>
              )}
              {(selected.type === 'label' ||
                selected.type === 'arc' ||
                selected.type === 'bar') && (
                <>
                  <label>
                    unit
                    <input
                      value={selected.display?.unit ?? ''}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          display: {
                            ...(selected.display ?? {}),
                            unit: e.target.value
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    scale
                    <input
                      type="number"
                      step="any"
                      value={selected.display?.scale ?? 1}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          display: {
                            ...(selected.display ?? {}),
                            scale: Number(e.target.value)
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    offset
                    <input
                      type="number"
                      step="any"
                      value={selected.display?.offset ?? 0}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          display: {
                            ...(selected.display ?? {}),
                            offset: Number(e.target.value)
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    decimals
                    <input
                      type="number"
                      value={selected.display?.decimals ?? 1}
                      onChange={(e) =>
                        updateWidget(selected.id, {
                          display: {
                            ...(selected.display ?? {}),
                            decimals: Number(e.target.value)
                          }
                        })
                      }
                    />
                  </label>
                </>
              )}
              {/* ---- Colors (applicable to every widget kind) ---- */}
              <div className="hr" />
              <label>
                bg color
                <input
                  type="color"
                  value={selected.bg_color ?? '#161b22'}
                  onChange={(e) =>
                    updateWidget(selected.id, { bg_color: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    updateWidget(selected.id, { bg_color: undefined })
                  }
                  title="Clear bg color override (use theme default)"
                >
                  clear
                </button>
              </label>
              <label>
                fg color
                <input
                  type="color"
                  value={selected.fg_color ?? '#e6edf3'}
                  onChange={(e) =>
                    updateWidget(selected.id, { fg_color: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    updateWidget(selected.id, { fg_color: undefined })
                  }
                  title="Clear fg color override (use theme default)"
                >
                  clear
                </button>
              </label>
              <div className="muted small">
                Zone state colors always win when the bound path has a
                matching zone — these are fallbacks.
              </div>
            </div>
          )}
        </aside>

        {/* ---- center: canvas ---- */}
        <main className="canvas">
          <h3>
            <input
              className="screen-title"
              value={screen.title}
              onChange={(e) => renameScreen(activeIdx, e.target.value)}
              title="Edit screen title"
            />
            <span className="muted">
              {' '}
              · screen {activeIdx + 1}/{screens.length}
            </span>
          </h3>
          {/* Deselect on click bubbles up to the app root. */}
          <div
            className="grid-wrap"
            style={{
              width: `${displayW}px`,
              height: `${displayH}px`,
              backgroundSize: `${colPxW}px ${ROW_PX_H}px`
            }}
          >
            {statusOverlay && (
              <div
                className="canvas-overlay"
                style={{ height: `${STATUS_OVERLAY_HEIGHT}px` }}
              >
                <span>host · wifi · sk · n2k · uptime · heap</span>
              </div>
            )}
            {shotUrl && (
              <img
                className="canvas-shot"
                src={shotUrl}
                alt="device screenshot"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: shotOpacity,
                  pointerEvents: 'none',
                  zIndex: 100
                }}
              />
            )}
            <div
              className="canvas-content"
              style={{
                position: 'absolute',
                top: statusOverlay ? STATUS_OVERLAY_HEIGHT : 0,
                left: 0,
                right: 0,
                bottom: showTabStrip ? tabStripHeight : 0
              }}
            >
            <GridLayout
              className="grid"
              layout={grid}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              width={displayW}
              // Force the grid container to fill the full canvas height
              // (display minus the status overlay strip) so widgets can
              // be dragged into the lower portion. Without this RGL
              // auto-sizes to the lowest existing widget's row, which
              // leaves no drop zone below.
              autoSize={false}
              maxRows={Math.floor(
                (displayH -
                  (statusOverlay ? STATUS_OVERLAY_HEIGHT : 0) -
                  (showTabStrip ? tabStripHeight : 0)) /
                  ROW_HEIGHT
              )}
              // RGL defaults margin=[10,10] and containerPadding=[10,10]
              // which shift everything down by ~10-20px per widget — the
              // canvas no longer reflects 1:1 with the device. Zero both
              // so JSON pixel coords map directly to canvas pixels.
              margin={[0, 0]}
              containerPadding={[0, 0]}
              // The designer must NOT auto-reflow: a drag of one
              // widget should never displace another. allowOverlap lets
              // tiles park anywhere; compactType=null disables gravity;
              // preventCollision=true keeps RGL from pushing siblings.
              compactType={null}
              preventCollision={true}
              allowOverlap={true}
              // Drag only via the chrome bar (which only appears on
              // selected widgets), so unselected widgets behave as
              // pure click targets.
              draggableHandle=".chrome"
              onDragStop={onDragStop}
              onResizeStop={onResizeStop}
            >
              {screen.widgets.map((w) => {
                const isSel = selectedId === w.id
                return (
                  <div
                    key={w.id}
                    className={`tile ${isSel ? 'sel' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(w.id)
                    }}
                  >
                    {isSel && (
                      <div className="chrome">
                        <span>{w.type}</span>
                        <button
                          className="x"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeWidget(w.id)
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <WidgetPreview
                      w={w}
                      value={
                        'bind' in w && w.bind
                          ? skValues.get(w.bind)
                          : undefined
                      }
                      zones={
                        'bind' in w && w.bind
                          ? pathZones.get(w.bind)
                          : undefined
                      }
                      description={
                        'bind' in w && w.bind
                          ? pathDescriptions.get(w.bind)
                          : undefined
                      }
                      valueMap={skValues}
                      zonesMap={pathZones}
                      notifications={notifications}
                    />
                  </div>
                )
              })}
            </GridLayout>
            </div>
            {showTabStrip && (
              <div
                className="canvas-tabs"
                style={{ height: `${tabStripHeight}px` }}
                onClick={(e) => e.stopPropagation()}
              >
                {screens.map((s, i) => (
                  <button
                    key={s.id}
                    className={`tab ${i === activeIdx ? 'active' : ''}`}
                    onClick={() => {
                      setActiveIdx(i)
                      setSelectedId(null)
                    }}
                    title={s.id}
                  >
                    {s.title || s.id}
                    {screens.length > 1 && i === activeIdx && (
                      <span
                        className="tab-x"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (
                            confirm(`Delete screen "${s.title}"?`)
                          )
                            removeScreen(i)
                        }}
                        title="Delete this screen"
                      >
                        ×
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="canvas-tools" onClick={(e) => e.stopPropagation()}>
            <button onClick={addScreen}>+ tab</button>
            {screens.length > 1 && (
              <span className="muted small">
                Tab strip shown on device when more than 1 screen exists
              </span>
            )}
          </div>
        </main>

        {/* ---- right: SK paths only ---- */}
        <aside className="col right" onClick={(e) => e.stopPropagation()}>
          <h3>SK paths {paths.length > 0 && `(${paths.length})`}</h3>
          <input
            placeholder="filter…"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
          />
          <ul className="paths">
            {filteredPaths.map((p) => (
              <li
                key={p}
                onClick={() => {
                  if (selected) applyBind(selected.id, p)
                }}
                title="click to bind to selected widget"
              >
                {p}
              </li>
            ))}
            {paths.length === 0 && (
              <li className="muted">
                no SK data — connect this designer via SK server
              </li>
            )}
          </ul>
        </aside>
      </div>
    </div>
  )
}
