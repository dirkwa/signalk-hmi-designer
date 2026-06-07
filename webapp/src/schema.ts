// Mirror of the JLP device-side schema v1 (sensesp-p4-cockpit
// src/jlp/widgets/widget_factory.cpp). Kept here as the single
// source of truth on the designer side; the runtime /hello response
// from the device adds the authoritative widget catalog.

export const SCHEMA_VERSION = 1 as const

export type WidgetKind =
  | 'label'
  | 'toggle'
  | 'arc'
  | 'bar'
  | 'bargroup'
  | 'button'
  | 'notifications'

export interface DisplayConfig {
  unit?: string
  scale?: number
  offset?: number
  decimals?: number
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

/** One bar inside a bargroup. Independent bind/range/display so each
 *  bar can pull from a different SK path with its own units. */
export interface BarGroupBar {
  label: string
  bind: string
  min: number
  max: number
  display?: DisplayConfig
}

/** Group of N bars under a single caption. Each bar binds
 *  independently; SK zones tint each bar individually. */
export interface BarGroupWidget extends WidgetCommon {
  type: 'bargroup'
  bars: BarGroupBar[]
}

/** One column in a notifications-list widget. `field` is a dotted
 *  path inside the row object (e.g. `"path"`, `"state"`, `"message"`,
 *  `"createdAt"`). `format` is a tiny printf-style template applied
 *  when the field is rendered. */
export interface ListColumn {
  label: string
  field: string
  width?: number
  /** printf-like template, e.g. "%.2f nm" or "%H:%M" for time
   *  strings (designer implements a minimal strftime subset). */
  format?: string
}

/** Tabular notifications viewer.
 *
 *  Renders rows from the device's notifications registry (a flat
 *  array of `{path, state, message, createdAt?, ...}` derived from
 *  every `notifications.*` SK path the device has seen). The
 *  designer mirrors that array client-side by polling SK.
 *
 *  Today's only data source is `notifications`. A future generic
 *  table widget (bind: arbitrary array path, vessels.* iterator,
 *  etc.) would land as a separate kind. */
export interface NotificationsWidget extends WidgetCommon {
  type: 'notifications'
  max_rows?: number
  row_height?: number
  columns: ListColumn[]
  /** Optional field that names a zone state (alert/warn/etc.) used
   *  to tint each row's background per the maritime palette. */
  row_color_field?: string
  /** Include cleared entries (state="normal"/"nominal"). Default
   *  false — a "pending" list shouldn't show what's already
   *  cleared. Set true for an audit-style snapshot of every known
   *  notification path. */
  include_cleared?: boolean
}

/** Momentary / hold-to-act button.
 *
 *  - `bind` (required): the SK path to PUT.
 *  - `press_value`: value sent on press.
 *  - `release_value` (optional): value sent on release. Omit for a
 *    one-shot action like ACK.
 *  - `hold_ms` (optional): when set, the press_value PUT only fires
 *    after the button has been held this long; releasing earlier
 *    cancels with no PUT. Use as a safety latch for STOP, anchor
 *    release, etc.
 */
export interface ButtonWidget extends WidgetCommon {
  type: 'button'
  bind: string
  press_value: boolean | number | string
  release_value?: boolean | number | string
  hold_ms?: number
}

export type Widget =
  | LabelWidget
  | ToggleWidget
  | ArcWidget
  | BarWidget
  | BarGroupWidget
  | ButtonWidget
  | NotificationsWidget

export interface Screen {
  id: string
  title: string
  widgets: Widget[]
}

/** Notification states ordered by ascending severity. Matches the
 *  SignalK convention. */
export type NotificationState =
  | 'alert'
  | 'warn'
  | 'alarm'
  | 'emergency'

/** Layout-level alert-overlay config. The overlay is a runtime
 *  artifact (modal that pops above the active screen when SK
 *  delivers a qualifying notification); the designer doesn't
 *  preview it on the canvas. */
export interface NotificationsConfig {
  enabled: boolean
  /** Only notifications with state >= min_state trigger the modal. */
  min_state: NotificationState
  /** v1: always "modal" (locked in the designer). */
  ack_method?: 'modal'
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
  /** Layout-level alert-overlay configuration. Default behaviour
   *  when omitted: enabled, min_state="alarm", modal ack. */
  notifications?: NotificationsConfig
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
