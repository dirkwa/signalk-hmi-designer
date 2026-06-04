# signalk-hmi-designer

A SignalK webapp + plugin that designs **JSON Layouts** for runtime-
rendering display devices and pushes them over HTTP. Reference target
is [sensesp-p4-cockpit](https://github.com/dirkwa/sensesp-p4-cockpit)
running the JLP (JSON Layout Player) on an ESP32-P4 / Waveshare 7B.
Any device that honours the same `GET /hello` + `POST /layout`
contract works.

Two halves in one repo:

- **Webapp** (`webapp/`): Vite + React + TypeScript canvas. Builds to
  `public/`, which the plugin serves at
  `/plugins/signalk-hmi-designer/`.
- **Plugin** (`src/`): tiny Express plugin exposing `/status`,
  `/layout` (save/load on the SK server), and `/device-proxy` (HTTP
  proxy to the device, bypasses CORS and supports binary responses).

## Where to start reading

| File                                                                          | Why                                          |
|-------------------------------------------------------------------------------|----------------------------------------------|
| [README.md](README.md)                                                        | Feature list + dev workflow                  |
| [webapp/src/schema.ts](webapp/src/schema.ts)                                  | **The single source of truth** for types     |
| [webapp/src/App.tsx](webapp/src/App.tsx)                                      | Root component, inspector, toolbar, canvas wiring |
| [webapp/src/WidgetPreview.tsx](webapp/src/WidgetPreview.tsx)                  | Per-kind SVG/CSS renditions of the device    |
| [webapp/src/api.ts](webapp/src/api.ts)                                        | All HTTP helpers (deviceProxy, push, save, fetchMeta, fetchNotifications) |
| [webapp/src/skStream.ts](webapp/src/skStream.ts)                              | WS hook for live SK values + notifications poll |
| [src/index.ts](src/index.ts)                                                  | Plugin entrypoint + HTTP endpoints           |
| Companion firmware **JLP-PROTOCOL.md** (in the cockpit repo)                  | The wire contract the device implements      |

## Architecture invariants

1. **Schema is the source of truth.** `webapp/src/schema.ts` is the
   only place widget kinds, layout shape, and the `Layout` interface
   are defined. Both `App.tsx` and `WidgetPreview.tsx` import from it.
   Update schema first, then the preview, then the inspector.
2. **Canvas mirrors the device 1:1 in pixels.** The grid uses the
   device's `/hello.display.{w,h}` so positions you author here land
   in the same pixels on the device. Don't introduce CSS that
   uppercases / restyles content without checking the firmware does
   the same.
3. **Refuse to push fields/kinds the device doesn't advertise.**
   `availableKinds` filters by `hello.widgets`. New fields must also
   make it into `/hello` on the firmware side or pushes will be
   silently dropped or rejected.
4. **Loaded layouts get migrated, not rejected.** v0.1 layouts
   (button `action.put.value`) are rewritten to the v0.2 shape at
   `adoptLayout` time. Never break loadability.
5. **Live values come from one WS connection.** `useSkValues` opens
   one `ws://.../signalk/v1/stream` per unique set of bound paths.
   Don't open more.

## File ops & state

- `layoutDoc` is derived in a `useMemo` from `screens`,
  `statusOverlay`, `notifConfig`. Anything written into the layout
  JSON lives in one of those three pieces of state.
- `loadSavedLayout()` / `saveLayout()` hit the plugin's
  `/plugins/signalk-hmi-designer/layout` endpoint (a single file on
  the SK server, atomic tmp+rename).
- `pushLayout(deviceUrl, layout)` goes through `/device-proxy` to
  bypass the browser's CORS gate against the device's 8081.
- `fetchScreenshot(deviceUrl)` returns a BMP blob; designer dims it
  over the canvas for align-to-device work.
- `useNotifications(enabled)` polls `/signalk/v1/api/.../notifications`
  every 2 s. **Only enables itself when at least one list widget
  binds to `"notifications"`** — don't hammer SK otherwise.

## Adding a widget kind

Mirror the protocol additions on the firmware side. The minimum diff:

1. **schema.ts**: extend `WidgetKind`, add a `XxxWidget` interface,
   add to the `Widget` union.
2. **App.tsx — defaultWidget**: seed sensible defaults so dropping a
   new widget onto the canvas doesn't render broken.
3. **App.tsx — availableKinds**: add to both the fallback list AND the
   `hello.widgets` filter so it shows up in the palette only when the
   device supports it.
4. **App.tsx — inspector block**: a `{selected.type === 'xxx' && ...}`
   block under the existing selected-widget panel. Per-kind fields
   thread through `updateWidget(selected.id, patch)`.
5. **WidgetPreview.tsx**: a `XxxPreview` function and a dispatch
   branch. Use the `zoneColor(w, value, zones, fallback)` helper so
   per-widget `bg_color` / `fg_color` overrides + zone state both
   apply consistently.
6. **schema.test.ts**: parse + round-trip a sample layout.

For widgets that bind **multiple** SK paths (`bargroup`, `list`):

- `bindsOf(w)` in `App.tsx` enumerates every path the widget needs.
- `boundPaths` flows through `useSkValues` so the WS subscribes per
  sub-bind.
- Both meta-fetch loops (boot restore + `adoptLayout`) iterate
  `bindsOf(w)` for zones + descriptions.
- For path-picker UX, set `bindTarget` to point at the focused field
  (`{barIdx: i}`) on input focus, route the click in the right-hand
  panel accordingly. Reset `bindTarget` to `'widget'` whenever
  `selectedId` changes.

## Zones, descriptions, formatting

- Zones live in **raw SK units**. `matchZone(zones, raw)` matches
  against the raw subject value, NOT the display-scaled one.
- `colorForZoneState(state)` uses the **maritime-helm palette**:
  green / yellow / orange / red / purple — one severity step warmer
  than SK spec defaults so the helm reads like a traffic light. Stays
  in lockstep with firmware `color_for_state` in `zone_registry.cpp`.
- `fetchPathMeta(path)` returns `{description, units, zones,
  displayUnits}`. `deriveDisplayDefaults(meta)` parses the
  `displayUnits.formula` (`value`, `value - N`, `value + N`, `value *
  N`, `value / N`) into `{unit, scale, offset, decimals}`. Use it to
  prefill the inspector when the user picks a path.
- A label widget bound to a SK path **prefers `description` over the
  formatted value**, matching firmware behaviour. So a switch state
  bind shows "BMS DnC" instead of "1.0".

## Build / dev workflow

```bash
npm install
npm run dev          # vite at http://localhost:5173
                     # proxies /signalk + /plugins to $SIGNALK_DEV_URL
                     # (default 127.0.0.1:3000)
npm run build:all    # lint + tsc + vite build + vitest
```

`npm run build:all` is the gate. Tests use vitest; canvas/UI
behaviour gets tested via the schema + display-defaults suites.

When iterating against the local SK server on :4100:

```bash
cd /home/dirk/dev/signalk-server && PORT=4100 npm start -- \
    -c /home/dirk/.signalk-hmi-designer
```

After `npm run build:all`, the plugin's `public/` folder is fresh.
Hard-reload (Ctrl/Cmd-Shift-R) or open an incognito tab to bust the
browser's bundle cache.

## Strict TypeScript

`tsconfig.webapp.json` enables strict mode + `noUncheckedIndexedAccess`.
Array accesses can return `undefined`; guard with `const target =
arr[i]; if (target) { ... }` rather than `arr[i]!`. Don't disable the
check — it's caught real bugs already.

## Repo conventions

- **Build/test gate**: `npm run format && npm run build:all && npm run
  test` (the second already runs tests, but the user's habit is to
  run them separately).
- **Commits**: focused, atomic. Body wrapped at 72; subject ≤ 50,
  imperative.
- **Never auto-commit, never auto-push.** Do both only when the user
  explicitly asks.
- **PR style**: succinct, no boilerplate test plans, only mention
  tests actually performed. No AI attribution anywhere.
- **No release-flow work** (version bumps, tags) unless the user says
  release.
- **Code review**: `cr review --plain --type committed --base master`
  on a feature branch. Save output the first time; `cr` is
  rate-limited ~50 min between runs.
- **Comments**: WHY only. No echo comments, no "added for issue #X"
  rot bait.

## Out of scope (deferred to v0.3+)

- mDNS device discovery in the browser (URL entry only today).
- Map / chart widget preview.
- Polar / AIS-radar plot.
- `list` widget v2: vessels.\* iterator with filter + projection.
- Per-widget theming beyond `bg_color` / `fg_color`.
- LVGL-WASM pixel-perfect preview (too heavy for the bundle).
