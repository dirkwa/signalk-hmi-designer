# signalk-hmi-designer

A SignalK webapp that designs HMI layouts for **runtime-rendering display devices** — boards that load a JSON layout at runtime and bind widgets to SignalK paths, without a firmware rebuild per change.

Reference target: [sensesp-p4-cockpit](https://github.com/dirkwa/sensesp-p4-cockpit)'s JLP (JSON Layout Player) on the ESP32-P4 / Waveshare 7B panel. Any device that implements the same `GET /hello` + `POST /layout` contract works.

## What it does

Install as a SignalK plugin; open the **HMI Designer** webapp from the SK admin UI:

1. **Connect** to a device URL. The designer GETs `/hello` to learn the widget catalog, display size, and currently-active layout name.
2. **Drag widgets** onto a canvas sized to the device's display. Bind each to a SignalK path picked from the live path list on this server. The canvas is **WYSIWYG with live SK data** — values, gauge fills, and zone-color tints update from the server's WS stream as you design.
3. **Push layout** — POSTs the JSON to the device's `/layout`, which stages it offscreen, swaps atomically, and persists to LittleFS on success.

## Designer features

- **Multi-screen** layouts with a tab strip rendered at the canvas bottom (height matches the device). Add, rename, delete screens; tab switch clears selection.
- **Save / Load** to the SK server (persists across browser refresh, via the plugin's `/layout` endpoint).
- **Export / Import** as a JSON file.
- **Clear** to start over.
- **Copy / Paste** the selected widget with Ctrl/Cmd-C and Ctrl/Cmd-V (respects focused inputs).
- **Live preview** — widgets render bound values from the SK WS stream as you design. Arc/bar fill, label text, toggle state, and zone-colored backgrounds all reflect current data.
- **Device screenshot overlay** — fetch the device's framebuffer over HTTP and dim-overlay it on the canvas with an opacity slider so you can align widgets to what the device actually draws.
- **Status overlay toggle** matches the device's optional top-strip.
- **Zone-aware coloring** — paths whose SK metadata declares `zones` colorize widgets per state (nominal / alert / warn / alarm / emergency).
- **Display formatting auto-derived from SK metadata** — `unit`, `scale`, `offset`, and `decimals` populate from the path's `displayUnits` formula when available.

## Widget kinds (v1)

`label`, `toggle`, `arc`, `bar`, `button`. Common fields: `id`, `type`, `x`, `y`, `w`, `h`, `label`, `bind`, `display { unit, scale, offset, decimals }`.
Per-kind extras live in [webapp/src/schema.ts](webapp/src/schema.ts).

Note: the firmware widget catalog can be smaller than the designer catalog — the designer refuses to push widget kinds the device's `/hello` doesn't list.

## Device contract

The designer assumes the device exposes (default port 8081 on the reference firmware):

| Method | Endpoint        | Purpose                                                  |
|--------|-----------------|----------------------------------------------------------|
| GET    | `/hello`        | Capability descriptor (schema, widgets, display, active) |
| POST   | `/layout`       | Apply a layout JSON; returns `{ok, name, screens, widgets}` or `{ok:false, err}` |
| GET    | `/screenshot`   | RGB565 BMP framebuffer dump (used for the overlay)       |
| GET    | `/healthz`      | Liveness probe                                            |

The full contract is documented in the firmware repo: [JLP-PROTOCOL.md](https://github.com/dirkwa/sensesp-p4-cockpit/blob/master/JLP-PROTOCOL.md).

## Plugin HTTP endpoints

Mounted under `/plugins/signalk-hmi-designer/`:

| Method | Endpoint         | Purpose                                                   |
|--------|------------------|-----------------------------------------------------------|
| GET    | `/status`        | Liveness                                                  |
| GET    | `/layout`        | Load the last layout saved on this SK server (404 if none) |
| PUT    | `/layout`        | Atomic save (tmp+rename) of the current layout            |
| POST   | `/device-proxy`  | Forward GET/POST to the device URL — bypasses CORS, enforces http(s)+private addresses, supports binary responses (for `/screenshot`) |

## Develop

```bash
npm install
npm run dev          # vite at http://localhost:5173,
                     # proxies /signalk and /plugins to $SIGNALK_DEV_URL (default 127.0.0.1:3000)
npm run build:all    # lint + tsc + vite build + vitest
```

The plugin compiles to `plugin/`; the webapp to `public/`. Both are gitignored.

## Status

v0.x — useful for daily layout iteration against the reference firmware. Open items:

- mDNS browse for device discovery (still URL-entry only).
- A "widget palette" of richer kinds beyond the v1 five.
- Per-widget styles (colors, fonts) — currently themed centrally.
