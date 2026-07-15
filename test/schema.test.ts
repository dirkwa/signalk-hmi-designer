import { describe, it, expect } from 'vitest'
import {
  firmwareMeets,
  isHelloResponse,
  parseFirmwareVersion,
  type AnchorWidget,
  type ButtonWidget,
  type Widget,
  type WidgetKind
} from '../webapp/src/schema'

describe('isHelloResponse', () => {
  it('accepts a minimal hello', () => {
    expect(
      isHelloResponse({
        schema: 1,
        widgets: {}
      })
    ).toBe(true)
  })

  it('rejects null', () => {
    expect(isHelloResponse(null)).toBe(false)
  })

  it('rejects missing schema', () => {
    expect(isHelloResponse({ widgets: {} })).toBe(false)
  })

  it('rejects missing widgets', () => {
    expect(isHelloResponse({ schema: 1 })).toBe(false)
  })
})

describe('parseFirmwareVersion', () => {
  it('extracts semver from a prefixed firmware string', () => {
    expect(parseFirmwareVersion('p4-cockpit-jlp-0.1.0')).toEqual({
      major: 0,
      minor: 1,
      patch: 0
    })
  })

  it('returns null for missing input', () => {
    expect(parseFirmwareVersion(undefined)).toBeNull()
  })

  it('returns null for an unparseable string', () => {
    expect(parseFirmwareVersion('garbage')).toBeNull()
  })
})

describe('firmwareMeets', () => {
  it('accepts an exact match', () => {
    expect(firmwareMeets('p4-cockpit-jlp-0.1.0', '0.1.0')).toBe(true)
  })

  it('accepts a higher patch', () => {
    expect(firmwareMeets('p4-cockpit-jlp-0.1.3', '0.1.0')).toBe(true)
  })

  it('accepts a higher minor', () => {
    expect(firmwareMeets('p4-cockpit-jlp-0.2.0', '0.1.5')).toBe(true)
  })

  it('rejects an older patch', () => {
    expect(firmwareMeets('p4-cockpit-jlp-0.0.9', '0.1.0')).toBe(false)
  })

  it('accepts a higher major', () => {
    expect(firmwareMeets('p4-cockpit-jlp-1.0.0', '0.1.0')).toBe(true)
  })

  it('rejects an older major even with higher minor + patch', () => {
    expect(firmwareMeets('p4-cockpit-jlp-0.9.9', '1.0.0')).toBe(false)
  })

  it('rejects undefined firmware (cannot tell)', () => {
    expect(firmwareMeets(undefined, '0.1.0')).toBe(false)
  })
})

describe('anchor widget', () => {
  it("'anchor' is a WidgetKind and an AnchorWidget is a Widget", () => {
    const kind: WidgetKind = 'anchor'
    const w: AnchorWidget = {
      type: 'anchor',
      id: 'a1',
      x: 0,
      y: 0,
      w: 240,
      h: 240,
      display: { unit: 'm', decimals: 1 }
    }
    // Assignable to the Widget union (fails to compile if the union
    // wasn't extended).
    const asWidget: Widget = w
    expect(kind).toBe('anchor')
    expect(asWidget.type).toBe('anchor')
    // Anchor owns a fixed navigation.anchor.* family, so it carries no
    // user `bind`.
    expect('bind' in w).toBe(false)
  })
})

describe('button null press_value', () => {
  it('accepts null press_value (raise-anchor button)', () => {
    const w: ButtonWidget = {
      type: 'button',
      id: 'raise',
      x: 0,
      y: 0,
      w: 120,
      h: 60,
      bind: 'navigation.anchor.position',
      press_value: null
    }
    const asWidget: Widget = w
    expect(asWidget.type).toBe('button')
    expect(w.press_value).toBe(null)
    // Round-trips through JSON as a real null (not dropped).
    const round = JSON.parse(JSON.stringify(w))
    expect(round.press_value).toBe(null)
  })
})
