# signalk-hmi-designer

A SignalK webapp that designs HMI layouts for **runtime-rendering display devices** — boards that load a JSON layout at runtime and bind widgets to SignalK paths, without a firmware rebuild per change.

Reference target: [sensesp-p4-cockpit](https://github.com/dirkwa/sensesp-p4-cockpit)'s `jlp` JSON Layout Player on the ESP32-P4 / Waveshare 7B panel. Any device that implements the same `GET /hello` + `POST /layout` contract works.

## What it is

A SignalK plugin you install on your SK server. From the SK admin UI, open the **HMI Designer** webapp. Workflow:

1. Enter the device URL (or pick one from the discovered list — mDNS browse coming in v2).
2. **Connect** — the designer GETs `/hello` to learn the device's widget catalog, display size, and currently-active layout.
3. Drag widgets onto the canvas. Bind each to a SignalK path from the filtered list of live paths on this server.
4. **Push layout** — POSTs the JSON to the device's `/layout`, which stages it offscreen, swaps atomically, and persists to LittleFS on success.

## Device contract

The designer assumes the device exposes:

- `GET  /hello`   → capability descriptor (schema version, widget catalog, display size).
- `POST /layout`  → applies a layout JSON. Returns `{ok, name, screens, widgets}` or `{ok:false, err}`.

Schema and widget kinds are documented in [webapp/src/schema.ts](webapp/src/schema.ts).

## Status

v0.1 — minimum useful designer:
- Single screen (multi-screen tabs in v2).
- Widget kinds: label, toggle, arc, bar, button.
- Push-only persistence (no SignalK `applicationData` commit yet — that's v2).
- No mDNS browse in the webapp yet — you enter the device URL by hand.

## Develop

```bash
npm install
npm run dev          # vite, http://localhost:5173, proxies /signalk and /plugins to $SIGNALK_DEV_URL (default 127.0.0.1:3000)
npm run build:all    # lint + tsc + vite build + vitest
```

The plugin entry compiles to `plugin/`, the webapp to `public/`. Both are gitignored.
