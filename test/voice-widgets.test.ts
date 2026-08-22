import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { WidgetKind } from '../webapp/src/schema'

/**
 * The palette is driven by two hand-maintained lists in App.tsx — a fallback
 * array used before /hello arrives, and a type-guard filter applied to what
 * the device advertises. A kind missing from the filter is silently dropped
 * even when the device offers it, which looks like a firmware problem rather
 * than a designer one. These tests pin all three lists together.
 */
const APP = readFileSync(
  fileURLToPath(new URL('../webapp/src/App.tsx', import.meta.url)),
  'utf8'
)
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../webapp/src/schema.ts', import.meta.url)),
  'utf8'
)

const VOICE_KINDS: WidgetKind[] = ['voice', 'speaker', 'mic', 'volume']

describe('voice widget kinds', () => {
  it('are in the WidgetKind union', () => {
    const union = SCHEMA.slice(
      SCHEMA.indexOf('export type WidgetKind'),
      SCHEMA.indexOf('export interface DisplayConfig')
    )
    for (const k of VOICE_KINDS) expect(union).toContain(`'${k}'`)
  })

  it('have a defaultWidget case', () => {
    for (const k of VOICE_KINDS) expect(APP).toContain(`case '${k}':`)
  })

  it('are in the availableKinds fallback list', () => {
    const fallback = APP.slice(
      APP.indexOf('const availableKinds'),
      APP.indexOf('return Object.keys(hello.widgets)')
    )
    for (const k of VOICE_KINDS) expect(fallback).toContain(`'${k}'`)
  })

  it('are in the availableKinds type-guard filter', () => {
    const filter = APP.slice(APP.indexOf('return Object.keys(hello.widgets)'))
    for (const k of VOICE_KINDS) expect(filter).toContain(`k === '${k}'`)
  })

  it('take no SignalK bind', () => {
    // The device ignores a bind on these; offering the field would invite a
    // path that silently does nothing.
    const set = APP.slice(
      APP.indexOf('PANEL_LOCAL_KINDS'),
      APP.indexOf('function defaultWidget')
    )
    for (const k of VOICE_KINDS) expect(set).toContain(`'${k}'`)
  })
})
