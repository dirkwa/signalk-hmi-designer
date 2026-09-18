import { describe, it, expect } from 'vitest'
import {
  getNestedField,
  isNestedBind,
  resolveBindPath
} from '../webapp/src/api'

describe('resolveBindPath', () => {
  const knownPaths = [
    'environment.depth.belowTransducer',
    'bar.foo.thing',
    'electrical.batteries.house.voltage'
  ]

  it('treats an exact known path as-is, with no extra field', () => {
    expect(
      resolveBindPath('environment.depth.belowTransducer', knownPaths)
    ).toEqual({
      skPath: 'environment.depth.belowTransducer',
      fieldPath: []
    })
  })

  it('splits a manually-extended bind at the longest known SK path prefix', () => {
    expect(resolveBindPath('bar.foo.thing.value.name', knownPaths)).toEqual({
      skPath: 'bar.foo.thing',
      fieldPath: ['value', 'name']
    })
  })

  it('resolves a single extra segment', () => {
    expect(resolveBindPath('bar.foo.thing.value', knownPaths)).toEqual({
      skPath: 'bar.foo.thing',
      fieldPath: ['value']
    })
  })

  it('never splits mid-segment (no false-positive substring prefix)', () => {
    // `bar.foo.thingamajig` is NOT an extension of `bar.foo.thing` —
    // "thing" is a substring of "thingamajig" but not a dot-segment.
    expect(resolveBindPath('bar.foo.thingamajig', knownPaths)).toEqual({
      skPath: 'bar.foo.thingamajig',
      fieldPath: []
    })
  })

  it('falls back to the literal bind when no known path matches', () => {
    expect(resolveBindPath('totally.unknown.path', knownPaths)).toEqual({
      skPath: 'totally.unknown.path',
      fieldPath: []
    })
  })

  it('falls back to the literal bind when knownPaths is empty (not loaded yet)', () => {
    expect(resolveBindPath('bar.foo.thing.value.name', [])).toEqual({
      skPath: 'bar.foo.thing.value.name',
      fieldPath: []
    })
  })

  it('returns an empty skPath/fieldPath for an empty bind', () => {
    expect(resolveBindPath('', knownPaths)).toEqual({
      skPath: '',
      fieldPath: []
    })
  })

  it('reaches into a real object-valued leaf like navigation.position', () => {
    expect(
      resolveBindPath('navigation.position.latitude', ['navigation.position'])
    ).toEqual({ skPath: 'navigation.position', fieldPath: ['latitude'] })
  })

  it('accepts a prebuilt Set of known paths', () => {
    const known = new Set(knownPaths)
    expect(resolveBindPath('bar.foo.thing.value.name', known)).toEqual({
      skPath: 'bar.foo.thing',
      fieldPath: ['value', 'name']
    })
    expect(resolveBindPath('bar.foo.thing', known)).toEqual({
      skPath: 'bar.foo.thing',
      fieldPath: []
    })
  })
})

describe('isNestedBind', () => {
  const known = new Set([
    'navigation.position',
    'environment.depth.belowTransducer'
  ])

  it('flags a bind that reaches into an object value', () => {
    expect(isNestedBind('navigation.position.latitude', known)).toBe(true)
  })

  it('leaves a leaf, an unknown path and an empty bind alone', () => {
    expect(isNestedBind('navigation.position', known)).toBe(false)
    expect(isNestedBind('environment.depth.belowTransducer', known)).toBe(false)
    expect(isNestedBind('totally.unknown.path', known)).toBe(false)
    expect(isNestedBind('', known)).toBe(false)
  })

  it('cannot tell before the path list has loaded', () => {
    expect(isNestedBind('navigation.position.latitude', [])).toBe(false)
  })
})

describe('getNestedField', () => {
  const position = { latitude: -36.84, longitude: 174.76 }

  it('reads a scalar field out of a delta value', () => {
    expect(getNestedField(position, ['latitude'])).toBe(-36.84)
    expect(
      getNestedField({ state: 'alarm', method: ['visual'] }, ['state'])
    ).toBe('alarm')
    expect(getNestedField({ on: false }, ['on'])).toBe(false)
  })

  it('walks several layers and array indexes', () => {
    expect(getNestedField({ a: { b: { c: 7 } } }, ['a', 'b', 'c'])).toBe(7)
    expect(
      getNestedField({ method: ['visual', 'sound'] }, ['method', '1'])
    ).toBe('sound')
  })

  it('addresses the delta value itself, not a REST envelope', () => {
    // A bind typed as `navigation.position.value.latitude` after reading the
    // REST tree finds no `value` key inside the delta value.
    expect(getNestedField(position, ['value', 'latitude'])).toBeNull()
  })

  it('is null past the last object layer or for a non-scalar leaf', () => {
    expect(getNestedField(position, ['altitude'])).toBeNull()
    expect(getNestedField(position, ['latitude', 'deeper'])).toBeNull()
    expect(getNestedField({ a: { b: 1 } }, ['a'])).toBeNull()
    expect(getNestedField(null, ['a'])).toBeNull()
    expect(getNestedField(42, ['a'])).toBeNull()
  })

  it('returns the value itself for an empty field path', () => {
    expect(getNestedField(3.5, [])).toBe(3.5)
    expect(getNestedField(position, [])).toBeNull()
  })
})
