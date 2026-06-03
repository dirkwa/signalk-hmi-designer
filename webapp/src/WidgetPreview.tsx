import type { CSSProperties, JSX } from 'react'
import { Widget } from './schema'
import { colorForZoneState, matchZone, type MetaZone } from './api'

type SkValue = number | string | boolean | null

interface PreviewProps {
  w: Widget
  value?: SkValue | undefined
  zones?: MetaZone[] | undefined
  /** SK meta `description` for the bound path. Some widgets (label)
   *  prefer this over the formatted numeric value. */
  description?: string | undefined
}

const ACCENT = '#58a6ff'
const TILE_BG = '#161b22'

/** Returns the zone color for the widget's current raw SK value,
 *  or fallback when no zones/no match.
 *
 *  SK metadata zones are in RAW units (e.g. SOC zones use 0..1 ratio
 *  even when the widget displays 0..100 %). Match against the raw
 *  value, NOT the display-scaled one — otherwise zones never hit when
 *  the path has a non-identity displayUnits formula.
 *
 *  Fallback precedence: widget's optional `bg_color`/`fg_color` (passed
 *  here as `fallback`) > theme default. This is how STOP=red works
 *  even when its bound path has no zones.
 */
function zoneColor(
  _w: Widget,
  value: SkValue | undefined,
  zones: MetaZone[] | undefined,
  fallback: string
): string {
  if (!zones) return fallback
  // Bools come in as true/false; coerce to 0/1 so matchZone works.
  const raw = typeof value === 'boolean' ? (value ? 1 : 0) : value
  if (typeof raw !== 'number') return fallback
  const z = matchZone(zones, raw)
  return z ? colorForZoneState(z.state) : fallback
}

/** Pick the bg fallback: widget's bg_color override, else theme bg. */
function bgFallback(w: Widget): string {
  return w.bg_color ?? TILE_BG
}

/** Pick the fg fallback: widget's fg_color override, else theme accent
 *  (used for arc indicator + bar fill color). */
function fgFallback(w: Widget): string {
  return w.fg_color ?? ACCENT
}

/**
 * Faithful-ish CSS/SVG renditions of how the device renders each
 * widget kind. CSS/SVG and LVGL are different rendering engines, so
 * this is visually equivalent rather than pixel-identical. Pixel-
 * perfect would require LVGL-WASM (~500KB bundle), traded against
 * "looks the same to a human".
 *
 * Bound widgets show the live value (formatted per `display`) when
 * present in `value`; otherwise "—" placeholder, matching what the
 * device shows before its first delta lands.
 */
export function WidgetPreview({
  w,
  value,
  zones,
  description
}: PreviewProps): JSX.Element {
  switch (w.type) {
    case 'label':
      return (
        <LabelPreview w={w} value={value} zones={zones} description={description} />
      )
    case 'toggle':
      return <TogglePreview w={w} value={value} zones={zones} />
    case 'arc':
      return <ArcPreview w={w} value={value} zones={zones} />
    case 'bar':
      return <BarPreview w={w} value={value} zones={zones} />
    case 'button':
      return <ButtonPreview w={w} />
  }
}

/** Apply scale+offset+decimals+unit to a raw SK value. */
function formatValue(w: Widget, value: SkValue | undefined): string {
  const d = 'display' in w ? w.display : undefined
  const unit = d?.unit ?? ''
  if (value === undefined || value === null) {
    return unit ? `— ${unit}` : '—'
  }
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string') return value
  const scale = d?.scale ?? 1
  const offset = d?.offset ?? 0
  const decimals = d?.decimals ?? 1
  const v = value * scale + offset
  return unit ? `${v.toFixed(decimals)} ${unit}` : v.toFixed(decimals)
}

/** Normalised 0..1 position of value within a widget's min..max range. */
function fillFraction(
  value: SkValue | undefined,
  min: number,
  max: number,
  scale: number,
  offset: number
): number | null {
  if (typeof value !== 'number') return null
  if (max <= min) return null
  const displayed = value * scale + offset
  const n = (displayed - min) / (max - min)
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function LabelPreview({
  w,
  value,
  zones,
  description
}: {
  w: Extract<Widget, { type: 'label' }>
  value: SkValue | undefined
  zones: MetaZone[] | undefined
  description: string | undefined
}) {
  const hasBind = Boolean(w.bind)
  const hasCaption = Boolean(w.label)
  if (!hasBind) {
    const staticStyle: CSSProperties = {}
    if (w.bg_color) staticStyle.background = w.bg_color
    if (w.fg_color) staticStyle.color = w.fg_color
    return (
      <div className="wp wp-label-text" style={staticStyle}>
        {w.label ?? ''}
      </div>
    )
  }
  // Prefer the SK meta description over the formatted value — matches
  // firmware behaviour. A label bound to a switch state then shows the
  // operator-facing relay name ("BMS DnC") instead of "1.0".
  const body = description ?? formatValue(w, value)
  // Zone-tint the tile bg, same as toggle / arc / bar. Falls back to
  // the widget's bg_color override, then theme default.
  const bg = zoneColor(w, value, zones, bgFallback(w))
  const tileStyle: CSSProperties = { background: bg }
  if (w.fg_color) tileStyle.color = w.fg_color
  return (
    <div className="wp wp-label-tile" style={tileStyle}>
      {hasCaption && <div className="wp-caption">{w.label}</div>}
      <div className={hasCaption ? 'wp-value-stacked' : 'wp-value-centered'}>
        {body}
      </div>
    </div>
  )
}

function TogglePreview({
  w,
  value,
  zones
}: {
  w: Extract<Widget, { type: 'toggle' }>
  value: SkValue | undefined
  zones: MetaZone[] | undefined
}) {
  const on = value === true || value === 1
  // For zones we treat the bool/int as a numeric value.
  const numericValue = typeof value === 'boolean' ? (value ? 1 : 0) : value
  const bg = zoneColor(w, numericValue, zones, bgFallback(w))
  const tileStyle: CSSProperties = { background: bg }
  if (w.fg_color) tileStyle.color = w.fg_color
  return (
    <div className="wp wp-tile wp-toggle" style={tileStyle}>
      {w.label && <div className="wp-toggle-label">{w.label}</div>}
      <div className={`wp-switch ${on ? 'wp-switch-on' : 'wp-switch-off'}`}>
        <div className="wp-switch-knob" />
      </div>
    </div>
  )
}

function ArcPreview({
  w,
  value,
  zones
}: {
  w: Extract<Widget, { type: 'arc' }>
  value: SkValue | undefined
  zones: MetaZone[] | undefined
}) {
  const start = w.start_angle ?? 135
  const end = w.end_angle ?? 45
  const d = w.display
  const fill =
    fillFraction(value, w.min, w.max, d?.scale ?? 1, d?.offset ?? 0) ?? 0.3
  let sweep = end - start
  if (sweep <= 0) sweep += 360
  const indicatorEnd = (start + sweep * fill) % 360
  const indicatorColor = zoneColor(w, value, zones, fgFallback(w))

  // Device firmware squares the arc to min(w,h) and centers it.
  // preserveAspectRatio="xMidYMid meet" replicates that: the SVG
  // keeps a circular arc and centers it within the user's box.
  return (
    <div className="wp wp-arc">
      <svg
        viewBox="0 0 100 100"
        className="wp-arc-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <ArcPath start={start} end={end} color="#30363d" width={8} />
        <ArcPath
          start={start}
          end={indicatorEnd}
          color={indicatorColor}
          width={8}
        />
      </svg>
      <div className="wp-arc-text">
        {w.label && <div className="wp-arc-caption">{w.label}</div>}
        <div className="wp-arc-value">{formatValue(w, value)}</div>
      </div>
    </div>
  )
}

function ArcPath({
  start,
  end,
  color,
  width
}: {
  start: number
  end: number
  color: string
  width: number
}) {
  // Convert LVGL angle convention (0° = right, clockwise) to SVG
  // polar coords centered on (50, 50), radius 42.
  const r = 42
  const rad = (a: number) => ((a - 0) * Math.PI) / 180
  const sx = 50 + r * Math.cos(rad(start))
  const sy = 50 + r * Math.sin(rad(start))
  const ex = 50 + r * Math.cos(rad(end))
  const ey = 50 + r * Math.sin(rad(end))
  let sweep = end - start
  if (sweep < 0) sweep += 360
  const largeArc = sweep > 180 ? 1 : 0
  return (
    <path
      d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      fill="none"
    />
  )
}

function BarPreview({
  w,
  value,
  zones
}: {
  w: Extract<Widget, { type: 'bar' }>
  value: SkValue | undefined
  zones: MetaZone[] | undefined
}) {
  const d = w.display
  const fill =
    fillFraction(value, w.min, w.max, d?.scale ?? 1, d?.offset ?? 0) ?? 0.3
  const fillPct = Math.round(fill * 100)
  const fillColor = zoneColor(w, value, zones, fgFallback(w))
  const fillStyle: CSSProperties = {
    background: fillColor,
    ...(w.vertical ? { height: `${fillPct}%` } : { width: `${fillPct}%` })
  }
  const tileStyle: CSSProperties = {}
  if (w.bg_color) tileStyle.background = w.bg_color
  if (w.fg_color) tileStyle.color = w.fg_color
  return (
    <div className="wp wp-tile" style={tileStyle}>
      <div className="wp-bar-head">
        {w.label && <span className="wp-caption">{w.label}</span>}
        <span className="wp-bar-value">{formatValue(w, value)}</span>
      </div>
      <div className={`wp-bar-track ${w.vertical ? 'vertical' : 'horizontal'}`}>
        <div className="wp-bar-fill" style={fillStyle} />
      </div>
    </div>
  )
}

function ButtonPreview({ w }: { w: Extract<Widget, { type: 'button' }> }) {
  return (
    <div className="wp wp-tile wp-button">
      <div className="wp-button-label">{w.label ?? 'button'}</div>
    </div>
  )
}
