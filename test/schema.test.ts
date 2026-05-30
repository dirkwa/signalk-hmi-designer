import { describe, it, expect } from 'vitest'
import { isHelloResponse } from '../webapp/src/schema'

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
