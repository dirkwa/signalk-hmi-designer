# signalk-hmi-designer

A SignalK webapp that designs HMI layouts for **runtime-rendering display devices** — boards that load a JSON layout at runtime and bind widgets to SignalK paths, without a firmware rebuild per change.

Reference target: [sensesp-p4-cockpit](https://github.com/dirkwa/sensesp-p4-cockpit)'s JLP (JSON Layout Player) on the ESP32-P4 / Waveshare 7B panel. Any device that implements the same `GET /hello` + `POST /layout` contract works.

## What it does

Install as a SignalK plugin; open the **HMI Designer** webapp from the SK admin UI:

1. **Connect** to a device URL. The designer GETs `/hello` to learn the widget catalog, display size, advertised capabilities (screenshot formats, idle-timeout support, ...) and the currently-active layout name.
2. **Drag widgets** onto a canvas sized to the device's display. Bind each to a SignalK path picked from the live path list on this server.
3. **Push layout** — POSTs the JSON via a server-side proxy to the device's `/layout`, which stages it offscreen, swaps atomically, and persists to LittleFS on success.

## Preview modes

The canvas always shows the device's render result, never an approximation. Two modes:

- **WASM (default)** — the firmware's `widget_factory.cpp` compiled to WebAssembly via [sensesp-p4-cockpit-wasm](https://github.com/dirkwa/sensesp-p4-cockpit-wasm). Renders pixel-identically to what the device draws, offline, no panel needed. Live SK values flow into the WASM canvas so widget fills / values / zone colors update as you design.
- **Mirror** — when a device is connected, polls `/screenshot?fmt=jpeg` and renders the actual panel framebuffer. True WYSIWYG including any state the WASM can't simulate (notifications overlay, runtime artifacts).

Toggle with the **WASM / Mirror** buttons above the canvas.

## Designer features

- **Multi-screen** layouts with a tab strip rendered at the canvas bottom (height matches the device). Add, rename, delete screens; **drag-and-drop tab reorder** (via `@dnd-kit`).
- **Save / Load** to the SK server (persists across browser refresh, via the plugin's `/layout` endpoint).
- **Export / Import** as a JSON file.
- **Clear** to start over.
- **Copy / Paste** the selected widget with Ctrl/Cmd-C and Ctrl/Cmd-V (respects focused inputs).
- **Display formatting auto-derived from SK metadata** — `unit`, `scale`, `offset`, and `decimals` populate from the path's `displayUnits` formula when you pick a path or load an existing layout (so a ratio path automatically shows as a percentage when SK says so).
- **Zone-aware coloring** — paths whose SK metadata declares `zones` colorize widgets per state (nominal / alert / warn / alarm / emergency, maritime-helm palette). The firmware fetches zone meta over REST per path on push, so even paths SK doesn't broadcast meta for still get the right colors.
- **Notifications modal** in the toolbar — opts the device's alert overlay in/out, picks the `min_state` threshold.
- **Display modal** in the toolbar — idle-backlight timeout and dim-to brightness (gated on `/hello.display.idle_timeout`). Higher dim levels keep tap-wake working; lower levels need notifications or a fresh push to wake the panel.

## Widget kinds

| Kind             | Notes |
|------------------|-------|
| `label`          | Static or path-bound text. Falls back to SK `description` when bound. Optional `display.font_size`. |
| `value`          | Big-number readout. Caption top-left, unit bottom-right. Zone-tinted background. Optional `display.font_size`. |
| `toggle`         | Boolean state with SK PUT on tap. Visual follows SK echo, not optimistic. |
| `arc`            | Gauge with min/max, advisory color bands (`bands`), optional `ticks` + `tick_labels`. Zone state colors the indicator. |
| `bar`            | Linear gauge with min/max. Horizontal or `vertical: true`. |
| `bargroup`       | Multiple labelled bars under one caption (e.g. SAIL TRIM / battery banks). Each sub-bar binds + zones independently. Signed ranges anchor at zero. |
| `button`         | Momentary action button: `press_value` PUT on press, optional `release_value` on release, optional `hold_ms` for hold-to-act. Optional fixed `bg_color` / `fg_color`. |
| `notifications`  | Scrolling list of pending notifications from `notifications.*`. State-tinted rows, configurable columns. Tap a row to ACK. |

Common fields: `id`, `type`, `x`, `y`, `w`, `h`, `label`, `bind`, `display { unit, scale, offset, decimals, font_size }`, `bg_color`, `fg_color`.
Per-kind extras live in [webapp/src/schema.ts](webapp/src/schema.ts).

The designer refuses to push widget kinds the device's `/hello` doesn't list — newer designer with older firmware still works, with the unsupported kinds greyed out in the palette.

## Device contract

The designer assumes the device exposes (default port 8081 on the reference firmware):

| Method | Endpoint        | Purpose                                                  |
|--------|-----------------|----------------------------------------------------------|
| GET    | `/hello`        | Capability descriptor (schema, widgets, display, active) |
| POST   | `/layout`       | Apply a layout JSON; returns `{ok, name, screens, widgets}` or `{ok:false, err}` |
| GET    | `/screenshot`   | Default JPEG, `?fmt=bmp` legacy RGB565 (used by Mirror preview) |
| GET    | `/healthz`      | Liveness probe                                            |

The full contract is documented in the firmware repo: [JLP-PROTOCOL.md](https://github.com/dirkwa/sensesp-p4-cockpit/blob/master/JLP-PROTOCOL.md).

## Plugin HTTP endpoints

Mounted under `/plugins/signalk-hmi-designer/`:

| Method | Endpoint         | Purpose                                                   |
|--------|------------------|-----------------------------------------------------------|
| GET    | `/status`        | Liveness                                                  |
| GET    | `/layout`        | Load the last layout saved on this SK server (404 if none) |
| PUT    | `/layout`        | Atomic save (tmp+rename) of the current layout            |
| POST   | `/device-proxy`  | Forward GET/POST to the device URL — bypasses CORS, enforces http(s) targets, supports binary responses (for `/screenshot`), 30 s upstream timeout |

## Develop

```bash
npm install
npm run dev          # vite at http://localhost:5173
                     # proxies /signalk and /plugins to $SIGNALK_DEV_URL (default 127.0.0.1:3000)
npm run build:all    # lint + tsc + vite build + vitest
```

The WASM bundle is copied from a sibling [sensesp-p4-cockpit-wasm](https://github.com/dirkwa/sensesp-p4-cockpit-wasm) checkout via `scripts/copy-wasm.sh`. If that repo isn't present locally, WASM preview just won't load — Mirror mode still works.

The plugin compiles to `plugin/`; the webapp to `public/`. Both are gitignored. Vite static assets (icon, etc.) live in `webapp/public/` and are tracked.

## Status

v0.2 — daily-usable for layout iteration against the reference firmware. Open items:

- mDNS browse for device discovery (still URL-entry only).
- Map / chart widget.
- AIS radar / polar plot widget.
- `notifications` widget v2 — arbitrary array paths with filter + projection mini-language (today it's bound to the firmware's notifications registry).
