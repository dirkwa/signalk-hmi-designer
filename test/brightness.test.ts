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

const commitBody = (): string => {
  const i = APP.indexOf('const onBrightnessCommit')
  expect(i, 'onBrightnessCommit not found').toBeGreaterThan(-1)
  return APP.slice(i, APP.indexOf('\n  }', i))
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
    const body = commitBody()
    expect(body).toContain('const target = connectedUrl')
    expect(body).not.toMatch(/const target = deviceUrl\b/)
  })

  // Reconnecting to the SAME url must invalidate the previous attempt, which
  // a url comparison cannot express.
  it('drops results from a superseded connect attempt', () => {
    expect(APP).toContain('const gen = ++connectGen.current')
    expect(APP).toContain('gen === connectGen.current')
  })

  // null hides the slider and means "no brightness reported". A failed
  // request must not look the same, or a reachable panel appears unsupported.
  it('reports a failed brightness load as an error', () => {
    const i = APP.indexOf('const onConnect')
    const body = APP.slice(i, APP.indexOf('\n  }', APP.indexOf('catch (e)', i)))
    expect(body).toContain('brightness unavailable:')
  })

  // The device clamps too, but sending 0 from a UI that cannot be recovered
  // from the panel itself is the kind of thing a slider should refuse.
  it('never writes a brightness below the device minimum', () => {
    expect(API).toContain('Math.max(5, Math.min(100, Math.round(pct)))')
    expect(APP).toContain('min={5}')
  })
})
