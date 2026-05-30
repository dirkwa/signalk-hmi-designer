import { useEffect, useMemo, useState } from 'react'
import GridLayout, { type Layout as GLLayout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { WidgetPreview } from './WidgetPreview'
import { useSkValues } from './skStream'
import { STATUS_OVERLAY_HEIGHT } from './schema'

import {
  deriveDisplayDefaults,
  fetchHello,
  fetchPathMeta,
  fetchSelfPaths,
  loadSavedLayout,
  pushLayout,
  saveLayout,
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

let nextId = 1
const genId = (prefix: string): string => `${prefix}-${nextId++}`

function defaultWidget(kind: WidgetKind): Widget {
  const id = genId(kind)
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
    case 'button':
      return { ...base, type: 'button', action: { put: { value: 1 } } }
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

  const [screen, setScreen] = useState<Screen>({
    id: 'main',
    title: 'Main',
    widgets: []
  })
  const [statusOverlay, setStatusOverlay] = useState<boolean>(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [pushErr, setPushErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchSelfPaths()
      .then(setPaths)
      .catch(() => setPaths([]))
  }, [])

  // Restore previously-saved layout on first mount. The saved doc
  // wraps the screen we render; v1 only supports a single screen so
  // we lift screens[0] out. Future versions need a screens-array
  // state shape.
  useEffect(() => {
    void loadSavedLayout()
      .then((saved) => {
        if (!saved) return
        const first = saved.screens[0]
        if (first) setScreen(first)
        if (saved.status_overlay !== undefined) {
          setStatusOverlay(saved.status_overlay)
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
      screens: [screen]
    }),
    [screen, statusOverlay]
  )

  // Canvas dimensions track the connected device's /hello.display
  // so the designer is 1:1 with whatever panel it's targeting.
  // Before Connect, fall back to the Waveshare 7B native resolution.
  const displayW = hello?.display?.w ?? DEFAULT_DISPLAY_W
  const displayH = hello?.display?.h ?? DEFAULT_DISPLAY_H
  const colPxW = displayW / COLS

  const grid = useMemo(
    () => screen.widgets.map((w) => widgetToGrid(w, colPxW)),
    [screen.widgets, colPxW]
  )

  // Live SK values for any bound widget. The hook re-subscribes when
  // the set of bound paths changes.
  const boundPaths = useMemo(
    () =>
      screen.widgets
        .map((w) => w.bind ?? '')
        .filter((p): p is string => p.length > 0),
    [screen.widgets]
  )
  const skValues = useSkValues(boundPaths)
  const selected = screen.widgets.find((w) => w.id === selectedId) ?? null

  const filteredPaths = useMemo(() => {
    if (!pathFilter) return paths
    const f = pathFilter.toLowerCase()
    return paths.filter((p) => p.toLowerCase().includes(f))
  }, [paths, pathFilter])

  const onLayoutChange = (next: GLLayout[]): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => {
        const g = next.find((n) => n.i === w.id)
        return g ? applyGrid(w, g, colPxW) : w
      })
    }))
  }

  const addWidget = (kind: WidgetKind): void => {
    const w = defaultWidget(kind)
    setScreen((prev) => ({ ...prev, widgets: [...prev.widgets, w] }))
    setSelectedId(w.id)
  }

  const removeWidget = (id: string): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.id !== id)
    }))
    if (selectedId === id) setSelectedId(null)
  }

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
    if (!hello) return ['label', 'toggle', 'arc', 'bar', 'button']
    return Object.keys(hello.widgets).filter(
      (k): k is WidgetKind =>
        k === 'label' ||
        k === 'toggle' ||
        k === 'arc' ||
        k === 'bar' ||
        k === 'button'
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
          {pushResult && (
            <span className={pushResult.ok ? 'ok' : 'err'}>
              {pushResult.ok
                ? `pushed — ${pushResult.screens} screens, ${pushResult.widgets} widgets`
                : (pushResult.err ?? 'push failed')}
            </span>
          )}
        </div>
      </header>

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
            </div>
          )}
        </aside>

        {/* ---- center: canvas ---- */}
        <main className="canvas">
          <h3>{screen.title} canvas</h3>
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
            <div
              className="canvas-content"
              style={{
                position: 'absolute',
                top: statusOverlay ? STATUS_OVERLAY_HEIGHT : 0,
                left: 0,
                right: 0,
                bottom: 0
              }}
            >
            <GridLayout
              className="grid"
              layout={grid}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              width={displayW}
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
              onLayoutChange={onLayoutChange}
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
                      value={w.bind ? skValues.get(w.bind) : undefined}
                    />
                  </div>
                )
              })}
            </GridLayout>
            </div>
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
