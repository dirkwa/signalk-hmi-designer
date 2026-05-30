import { describe, it, expect } from 'vitest'
import { deriveDisplayDefaults, type PathMeta } from '../webapp/src/api'

describe('deriveDisplayDefaults', () => {
  it('returns null when no displayUnits', () => {
    expect(deriveDisplayDefaults({ units: 'K' } as PathMeta)).toBeNull()
  })

  it('identity formula', () => {
    const d = deriveDisplayDefaults({
      displayUnits: { formula: 'value', symbol: 'm', displayFormat: '0.0' }
    })
    expect(d).toEqual({ unit: 'm', scale: 1, offset: 0, decimals: 1 })
  })

  it('Kelvin to Celsius (subtract)', () => {
    const d = deriveDisplayDefaults({
      displayUnits: {
        formula: 'value - 273.15',
        symbol: '°C',
        displayFormat: '0'
      }
    })
    expect(d).toEqual({ unit: '°C', scale: 1, offset: -273.15, decimals: 0 })
  })

  it('m/s to knots (multiply)', () => {
    const d = deriveDisplayDefaults({
      displayUnits: {
        formula: 'value * 1.94384',
        symbol: 'kn',
        displayFormat: '0.0'
      }
    })
    expect(d).toEqual({ unit: 'kn', scale: 1.94384, offset: 0, decimals: 1 })
  })

  it('rad to deg', () => {
    const d = deriveDisplayDefaults({
      displayUnits: {
        formula: 'value * 57.2958',
        symbol: '°',
        displayFormat: '0'
      }
    })
    expect(d).toEqual({ unit: '°', scale: 57.2958, offset: 0, decimals: 0 })
  })

  it('division formula', () => {
    const d = deriveDisplayDefaults({
      displayUnits: { formula: 'value / 100', symbol: '%', displayFormat: '0' }
    })
    expect(d).toEqual({ unit: '%', scale: 0.01, offset: 0, decimals: 0 })
  })

  it('unrecognised formula falls back to identity', () => {
    const d = deriveDisplayDefaults({
      displayUnits: {
        formula: 'Math.log(value) * 10',
        symbol: 'dB',
        displayFormat: '0.00'
      }
    })
    expect(d).toEqual({ unit: 'dB', scale: 1, offset: 0, decimals: 2 })
  })

  it('falls back through symbol -> targetUnit -> units', () => {
    expect(
      deriveDisplayDefaults({
        units: 'K',
        displayUnits: { targetUnit: 'm' } // no symbol
      })?.unit
    ).toBe('m')
    expect(
      deriveDisplayDefaults({
        units: 'K',
        displayUnits: {} // empty
      })?.unit
    ).toBe('K')
  })
})
