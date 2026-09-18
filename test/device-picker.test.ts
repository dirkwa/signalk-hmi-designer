import { describe, it, expect } from 'vitest'
import {
  deviceLabel,
  matchDevice,
  normalizeDeviceUrl,
  sortDevices,
  type DiscoveredDevice
} from '../webapp/src/api'

const panel = (name: string, url: string): DiscoveredDevice => ({
  name,
  url,
  txt: {}
})

const cockpit = panel('cockpit', 'http://cockpit.local:8081')
const spare = panel('espos-2be9', 'http://espos-2be9.local:8081')

describe('normalizeDeviceUrl', () => {
  it('keeps scheme, host and port', () => {
    expect(normalizeDeviceUrl('http://cockpit.local:8081')).toBe(
      'http://cockpit.local:8081'
    )
    expect(normalizeDeviceUrl('https://panel.local')).toBe(
      'https://panel.local'
    )
  })

  it('ignores host case, a trailing slash and surrounding space', () => {
    expect(normalizeDeviceUrl('  http://Cockpit.LOCAL:8081/ ')).toBe(
      'http://cockpit.local:8081'
    )
  })

  it('drops the trailing dot of an mDNS FQDN', () => {
    expect(normalizeDeviceUrl('http://cockpit.local.:8081')).toBe(
      'http://cockpit.local:8081'
    )
  })

  it('returns a half-typed address as typed', () => {
    expect(normalizeDeviceUrl(' cockpit.loc ')).toBe('cockpit.loc')
    expect(normalizeDeviceUrl('')).toBe('')
  })
})

describe('matchDevice', () => {
  const devices = [cockpit, spare]

  it('finds the panel the url box points at', () => {
    expect(matchDevice(devices, 'http://espos-2be9.local:8081')).toBe(spare)
  })

  it('matches despite case and a trailing slash', () => {
    expect(matchDevice(devices, 'http://COCKPIT.local:8081/')).toBe(cockpit)
  })

  it('does not match the same panel typed by address', () => {
    // The scan reports .local names; an IP is a different string and the
    // picker must fall back to its placeholder rather than guess.
    expect(matchDevice(devices, 'http://192.168.0.118:8081')).toBeUndefined()
  })

  it('does not match a different port on the same host', () => {
    expect(matchDevice(devices, 'http://cockpit.local:8082')).toBeUndefined()
  })

  it('matches nothing for a half-typed url or an empty scan', () => {
    expect(matchDevice(devices, 'http://cock')).toBeUndefined()
    expect(matchDevice([], 'http://cockpit.local:8081')).toBeUndefined()
  })
})

describe('deviceLabel', () => {
  it('shows the name and where the panel lives', () => {
    expect(deviceLabel(cockpit)).toBe('cockpit (cockpit.local:8081)')
  })

  it('shows only the host when the name adds nothing', () => {
    expect(deviceLabel(panel('', 'http://cockpit.local:8081'))).toBe(
      'cockpit.local:8081'
    )
    expect(
      deviceLabel(panel('cockpit.local:8081', 'http://cockpit.local:8081'))
    ).toBe('cockpit.local:8081')
  })

  it('falls back to the raw url when it does not parse', () => {
    expect(deviceLabel(panel('odd', 'not a url'))).toBe('odd (not a url)')
  })
})

describe('sortDevices', () => {
  it('orders by name, then url, so scans list panels consistently', () => {
    const twin = panel('cockpit', 'http://cockpit-2.local:8081')
    expect(sortDevices([spare, cockpit, twin])).toEqual([twin, cockpit, spare])
  })

  it('leaves the scan result it was given untouched', () => {
    const found = [spare, cockpit]
    sortDevices(found)
    expect(found).toEqual([spare, cockpit])
  })
})
