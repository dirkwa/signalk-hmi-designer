import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The brightness slider writes to a device and persists in its NVS, so three
 * properties matter and none of them are visible in a type check. There is no
 * DOM harness in this repo, so these pin the source the way voice-widgets.ts
 * pins the palette lists.
 */
const APP = readFileSync(
  fileURLToPath(new URL('../webapp/src/App.tsx', import.meta.url)),
  'utf8'
)
const API = readFileSync(
  fileURLToPath(new URL('../webapp/src/api.ts', import.meta.url)),
  'utf8'
)

/** Source of one top-level handler, so assertions cannot be satisfied by an
 *  unrelated line elsewhere in a 1500-line file. */
const handler = (name: string): string => {
  const i = APP.indexOf(`const ${name}`)
  expect(i, `${name} not found`).toBeGreaterThan(-1)
  const end = APP.indexOf('\n  }', i)
  expect(end, `${name} body not delimited`).toBeGreaterThan(i)
  return APP.slice(i, end)
}

describe('brightness slider', () => {
  // A touch dispatches touchend AND a compatibility mouseup. Binding both
  // sends two PUTs, so two NVS writes, for one release.
  it('commits once per release, via pointer events', () => {
    expect(APP).toContain('onPointerUp={(e) =>')
    expect(APP).not.toContain('onTouchEnd={(e) =>')
    expect(APP).not.toContain('onMouseUp={(e) =>')
  })

  // The url box is editable, so deviceUrl is where the user is typing, not
  // where the device is. Writing there can hit a panel that was never
  // connected.
  it('writes to the connected device, not the url input', () => {
    const body = handler('onBrightnessCommit')
    expect(body).toContain('const target = connectedUrl')
    // The binding alone proves nothing: assert the actual call, or
    // setBrightness(deviceUrl, pct) would still satisfy the test.
    expect(body).toMatch(/await setBrightness\(\s*target\s*,/)
    expect(body).not.toMatch(/setBrightness\(\s*deviceUrl\b/)
    expect(body).not.toMatch(/fetchBrightness\(\s*deviceUrl\b/)
  })

  // Reconnecting to the SAME url must invalidate the previous attempt, which
  // a url comparison cannot express.
  it('drops results from a superseded connect attempt', () => {
    // Scoped to onConnect: a generation taken there but never checked there
    // would otherwise pass on onBrightnessCommit's own check alone.
    const body = handler('onConnect')
    expect(body).toContain('const gen = ++connectGen.current')
    expect(body).toContain('gen === connectGen.current')
    // Each result applied only while the attempt is still the newest one.
    const guards = body.match(/if \(!?current\(\)\)/g) ?? []
    expect(
      guards.length,
      'every applied result needs a guard'
    ).toBeGreaterThanOrEqual(4)
    // ...and the commit path carries its own, for a connect that changed
    // while a write was in flight.
    expect(handler('onBrightnessCommit')).toContain(
      'gen !== connectGen.current'
    )
  })

  // null hides the slider and means "no brightness reported". A failed
  // request must not look the same, or a reachable panel appears unsupported.
  it('reports a failed brightness load as an error', () => {
    expect(handler('onConnect')).toContain('brightness unavailable:')
  })

  // The device clamps too, but sending 0 from a UI that cannot be recovered
  // from the panel itself is the kind of thing a slider should refuse.
  it('never writes a brightness below the device minimum', () => {
    expect(API).toContain('Math.max(5, Math.min(100, Math.round(pct)))')
    expect(APP).toContain('min={5}')
  })
})
