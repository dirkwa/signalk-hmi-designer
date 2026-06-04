// Mirror of the JLP device-side schema v1 (sensesp-p4-cockpit
// src/jlp/widgets/widget_factory.cpp). Kept here as the single
// source of truth on the designer side; the runtime /hello response
// from the device adds the authoritative widget catalog.

export const SCHEMA_VERSION = 1 as const

export type WidgetKind = 'label' | 'toggle' | 'arc' | 'bar' | 'button'

export interface DisplayConfig {
  unit?: string
  scale?: number
  offset?: number
  decimals?: number
}

export interface PutAction {
  put: {
    value: boolean | number | string
    path?: string
  }
}

export interface WidgetCommon {
  type: WidgetKind
  id: string
  x: number
  y: number
  w: number
  h: number
  label?: string
  bind?: string
  display?: DisplayConfig
  /** Optional fixed background color (hex e.g. "#f85149"). When the
   *  widget binds a path and the path's SK zones match the current
   *  value, the zone color wins. Use these for purely action-coloured
   *  widgets (STOP=red, ACK=yellow) that have no SK feedback loop. */
  bg_color?: string
  /** Optional fixed foreground color (value text / arc indicator).
   *  Same zone-wins precedence as bg_color. */
  fg_color?: string
}

export interface LabelWidget extends WidgetCommon {
  type: 'label'
}

export interface ToggleWidget extends WidgetCommon {
  type: 'toggle'
  bind: string
}

/** Advisory color band on an arc widget. `from` and `to` are in the
 *  arc's display-space (after `display.scale`/`offset`). Painted as
 *  a thin ring behind the live indicator. */
export interface ArcBand {
  from: number
  to: number
  color: string
}

export interface ArcWidget extends WidgetCommon {
  type: 'arc'
  bind: string
  min: number
  max: number
  start_angle?: number
  end_angle?: number
  /** N evenly-spaced major tick marks around the arc; 0/omit = none. */
  ticks?: number
  /** Print min, max, and intermediate tick values around the arc. */
  tick_labels?: boolean
  /** Advisory colored bands painted as a ring behind the indicator. */
  bands?: ArcBand[]
}

export interface BarWidget extends WidgetCommon {
  type: 'bar'
  bind: string
  min: number
  max: number
  vertical?: boolean
}

export interface ButtonWidget extends WidgetCommon {
  type: 'button'
  action: PutAction
}

export type Widget =
  | LabelWidget
  | ToggleWidget
  | ArcWidget
  | BarWidget
  | ButtonWidget

export interface Screen {
  id: string
  title: string
  widgets: Widget[]
}

export interface Layout {
  schema: 1
  name: string
  /** Show the device's status strip (hostname, wifi, sk, n2k, heap)
   *  at the top of the screen. Default true (matches firmware
   *  behavior since v0.1). Set false for a clean operational helm. */
  status_overlay?: boolean
  /** Height in device pixels of the bottom tab strip used to switch
   *  between screens. Only relevant when `screens.length > 1`;
   *  ignored otherwise. Default 56 px. */
  tab_strip_height?: number
  theme?: { bg?: string; fg?: string; accent?: string }
  screens: Screen[]
}

/** Height in device pixels of the status overlay strip (matches the
 *  firmware constant kStripHeight in status_overlay.cpp). */
export const STATUS_OVERLAY_HEIGHT = 28

/** Default bottom tab-strip height when not set on the layout. */
export const DEFAULT_TAB_STRIP_HEIGHT = 56

/** Returned by the device's GET /hello — capability descriptor. */
export interface HelloResponse {
  schema: number
  name?: string
  hostname?: string
  firmware?: string
  display?: { w: number; h: number }
  widgets: Record<string, { fields: string[] }>
  active_layout_name?: string
  layout_source?: string
}

/** Narrowing helper — verifies an unknown value matches HelloResponse. */
export function isHelloResponse(v: unknown): v is HelloResponse {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.schema !== 'number') return false
  if (typeof o.widgets !== 'object' || o.widgets === null) return false
  return true
}
