import { JSX } from 'react'
import { Widget } from './schema'

type SkValue = number | string | boolean | null

interface PreviewProps {
  w: Widget
  value?: SkValue | undefined
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
export function WidgetPreview({ w, value }: PreviewProps): JSX.Element {
  switch (w.type) {
    case 'label':
      return <LabelPreview w={w} value={value} />
    case 'toggle':
      return <TogglePreview w={w} value={value} />
    case 'arc':
      return <ArcPreview w={w} value={value} />
    case 'bar':
      return <BarPreview w={w} value={value} />
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
  value
}: {
  w: Extract<Widget, { type: 'label' }>
  value: SkValue | undefined
}) {
  const hasBind = Boolean(w.bind)
  const hasCaption = Boolean(w.label)
  if (!hasBind) {
    return <div className="wp wp-label-text">{w.label ?? ''}</div>
  }
  return (
    <div className="wp wp-label-tile">
      {hasCaption && <div className="wp-caption">{w.label}</div>}
      <div className={hasCaption ? 'wp-value-stacked' : 'wp-value-centered'}>
        {formatValue(w, value)}
      </div>
    </div>
  )
}

function TogglePreview({
  w,
  value
}: {
  w: Extract<Widget, { type: 'toggle' }>
  value: SkValue | undefined
}) {
  const on = value === true || value === 1
  return (
    <div className="wp wp-tile">
      {w.label && <div className="wp-caption">{w.label}</div>}
      <div className={`wp-switch ${on ? 'wp-switch-on' : 'wp-switch-off'}`}>
        <div className="wp-switch-knob" />
      </div>
    </div>
  )
}

function ArcPreview({
  w,
  value
}: {
  w: Extract<Widget, { type: 'arc' }>
  value: SkValue | undefined
}) {
  // Device default: arc sweeps from 135° (start) clockwise to 45°
  // (end). Same convention used here. When no value, show ~30% so
  // the indicator is visible during design.
  const start = w.start_angle ?? 135
  const end = w.end_angle ?? 45
  const d = w.display
  const fill =
    fillFraction(value, w.min, w.max, d?.scale ?? 1, d?.offset ?? 0) ?? 0.3
  let sweep = end - start
  if (sweep <= 0) sweep += 360
  const indicatorEnd = (start + sweep * fill) % 360

  return (
    <div className="wp wp-arc">
      <svg viewBox="0 0 100 100" className="wp-arc-svg">
        <ArcPath start={start} end={end} color="#30363d" width={8} />
        <ArcPath
          start={start}
          end={indicatorEnd}
          color="#58a6ff"
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
  value
}: {
  w: Extract<Widget, { type: 'bar' }>
  value: SkValue | undefined
}) {
  const d = w.display
  const fill =
    fillFraction(value, w.min, w.max, d?.scale ?? 1, d?.offset ?? 0) ?? 0.3
  const fillPct = Math.round(fill * 100)
  return (
    <div className="wp wp-tile">
      <div className="wp-bar-head">
        {w.label && <span className="wp-caption">{w.label}</span>}
        <span className="wp-bar-value">{formatValue(w, value)}</span>
      </div>
      <div className={`wp-bar-track ${w.vertical ? 'vertical' : 'horizontal'}`}>
        <div
          className="wp-bar-fill"
          style={
            w.vertical ? { height: `${fillPct}%` } : { width: `${fillPct}%` }
          }
        />
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
