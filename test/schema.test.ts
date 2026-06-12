import { describe, it, expect } from 'vitest'
import {
  firmwareMeets,
  isHelloResponse,
  parseFirmwareVersion,
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
      patch: 0,
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

  it('rejects undefined firmware (cannot tell)', () => {
    expect(firmwareMeets(undefined, '0.1.0')).toBe(false)
  })
})
