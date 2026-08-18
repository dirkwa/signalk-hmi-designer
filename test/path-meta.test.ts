import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPathMeta } from '../webapp/src/api'

describe('fetchPathMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not query the server for sentinel binds', async () => {
    // Regression: `@drop_here` is a local device action, not a SignalK
    // path. Fetching its meta 404s on every layout load and litters the
    // browser console.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchPathMeta('@drop_here')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not query the server for an empty bind', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchPathMeta('')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still fetches a real SignalK path, dots become slashes', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ units: 'm' })
    })
    vi.stubGlobal('fetch', fetchSpy)
    await expect(
      fetchPathMeta('environment.depth.belowTransducer')
    ).resolves.toEqual({ units: 'm' })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/signalk/v1/api/vessels/self/environment/depth/belowTransducer/meta'
    )
  })
})
