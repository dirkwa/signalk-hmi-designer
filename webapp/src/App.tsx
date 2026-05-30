import { useEffect, useMemo, useState } from 'react'
import GridLayout, { type Layout as GLLayout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { fetchHello, fetchSelfPaths, pushLayout, type PushResult } from './api'
import { Layout, Screen, Widget, WidgetKind, HelloResponse } from './schema'
import './app.css'

declare const __PLUGIN_VERSION__: string

/* ---------- helpers ---------- */

// react-grid-layout uses unitless column/row coordinates. We translate
// to device pixels on export. cols * COL_PX_W and rows * ROW_PX_H must
// fit the target display.
const COLS = 24
const ROW_HEIGHT = 25
const COL_PX_W = 1024 / COLS // 42.67 px per column on a 1024-wide panel
const ROW_PX_H = ROW_HEIGHT

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

function widgetToGrid(w: Widget): GridSpec {
  return {
    i: w.id,
    x: Math.round(w.x / COL_PX_W),
    y: Math.round(w.y / ROW_PX_H),
    w: Math.max(1, Math.round(w.w / COL_PX_W)),
    h: Math.max(1, Math.round(w.h / ROW_PX_H))
  }
}

function applyGrid(w: Widget, g: GLLayout): Widget {
  return {
    ...w,
    x: Math.round(g.x * COL_PX_W),
    y: Math.round(g.y * ROW_PX_H),
    w: Math.round(g.w * COL_PX_W),
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [pushErr, setPushErr] = useState<string | null>(null)

  useEffect(() => {
    void fetchSelfPaths()
      .then(setPaths)
      .catch(() => setPaths([]))
  }, [])

  const layoutDoc: Layout = useMemo(
    () => ({ schema: 1, name: 'Designer', screens: [screen] }),
    [screen]
  )

  const grid = useMemo(() => screen.widgets.map(widgetToGrid), [screen.widgets])
  const selected = screen.widgets.find((w) => w.id === selectedId) ?? null

  const filteredPaths = useMemo(() => {
    if (!pathFilter) return paths.slice(0, 200)
    const f = pathFilter.toLowerCase()
    return paths.filter((p) => p.toLowerCase().includes(f)).slice(0, 200)
  }, [paths, pathFilter])

  const onLayoutChange = (next: GLLayout[]): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => {
        const g = next.find((n) => n.i === w.id)
        return g ? applyGrid(w, g) : w
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
    <div className="hmi-app">
      <header>
        <strong>HMI Designer</strong>
        <span className="ver">v{__PLUGIN_VERSION__}</span>
      </header>

      <div className="cols">
        {/* ---- left column: device & push ---- */}
        <aside className="col left">
          <h3>Device</h3>
          <label>
            URL
            <input
              type="text"
              value={deviceUrl}
              onChange={(e) => setDeviceUrl(e.target.value)}
              placeholder="http://p4-cockpit.local:8081"
            />
          </label>
          <button onClick={() => void onConnect()}>Connect</button>
          {helloErr && <p className="err">{helloErr}</p>}
          {hello && (
            <div className="hello">
              <div>
                schema <code>{hello.schema}</code>
              </div>
              {hello.firmware && <div>fw {hello.firmware}</div>}
              {hello.display && (
                <div>
                  display {hello.display.w}×{hello.display.h}
                </div>
              )}
              <div>widgets: {Object.keys(hello.widgets).join(', ')}</div>
              {hello.active_layout_name && (
                <div>
                  active: {hello.active_layout_name} (
                  {hello.layout_source ?? '?'})
                </div>
              )}
            </div>
          )}

          <h3>Push</h3>
          <button className="primary" onClick={() => void onPush()}>
            Push layout
          </button>
          {pushErr && <p className="err">{pushErr}</p>}
          {pushResult && (
            <p className={pushResult.ok ? 'ok' : 'err'}>
              {pushResult.ok
                ? `ok — ${pushResult.screens} screens, ${pushResult.widgets} widgets`
                : (pushResult.err ?? 'failed')}
            </p>
          )}

          <h3>Layout JSON</h3>
          <textarea
            readOnly
            className="json"
            value={JSON.stringify(layoutDoc, null, 2)}
          />
        </aside>

        {/* ---- center: canvas ---- */}
        <main className="canvas">
          <h3>{screen.title} canvas</h3>
          <div className="grid-wrap">
            <GridLayout
              className="grid"
              layout={grid}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              width={1024}
              compactType={null}
              preventCollision={false}
              onLayoutChange={onLayoutChange}
            >
              {screen.widgets.map((w) => (
                <div
                  key={w.id}
                  className={`tile ${selectedId === w.id ? 'sel' : ''}`}
                  onClick={() => setSelectedId(w.id)}
                >
                  <div className="tile-head">
                    <span className="tile-kind">{w.type}</span>
                    <button
                      className="x"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeWidget(w.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div className="tile-body">
                    <div>{w.label ?? w.id}</div>
                    {w.bind && <code>{w.bind}</code>}
                  </div>
                </div>
              ))}
            </GridLayout>
          </div>
        </main>

        {/* ---- right: palette + props ---- */}
        <aside className="col right">
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
                  onChange={(e) =>
                    updateWidget(selected.id, { bind: e.target.value })
                  }
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
                  if (selected) updateWidget(selected.id, { bind: p })
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
