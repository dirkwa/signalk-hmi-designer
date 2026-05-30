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
}

export interface LabelWidget extends WidgetCommon {
  type: 'label'
}

export interface ToggleWidget extends WidgetCommon {
  type: 'toggle'
  bind: string
}

export interface ArcWidget extends WidgetCommon {
  type: 'arc'
  bind: string
  min: number
  max: number
  start_angle?: number
  end_angle?: number
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
  theme?: { bg?: string; fg?: string; accent?: string }
  screens: Screen[]
}

/** Height in device pixels of the status overlay strip (matches the
 *  firmware constant kStripHeight in status_overlay.cpp). */
export const STATUS_OVERLAY_HEIGHT = 28

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
