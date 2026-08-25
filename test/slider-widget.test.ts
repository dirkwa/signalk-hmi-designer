import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Same rationale as voice-widgets.test.ts: the palette is driven by
 * hand-maintained lists in App.tsx, and a kind missing from one of them
 * fails silently rather than loudly. Pin all three lists together here too
 * -- plus, unlike the four panel-local kinds slider is modeled on, assert
 * it's a normal *bound* widget (bind field shown, display prefill wired up).
 */
const APP = readFileSync(
  fileURLToPath(new URL('../webapp/src/App.tsx', import.meta.url)),
  'utf8'
)
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../webapp/src/schema.ts', import.meta.url)),
  'utf8'
)

describe('slider widget kind', () => {
  it('is in the WidgetKind union', () => {
    const union = SCHEMA.slice(
      SCHEMA.indexOf('export type WidgetKind'),
      SCHEMA.indexOf('export interface DisplayConfig')
    )
    expect(union).toContain("'slider'")
  })

  it('has a defaultWidget case', () => {
    expect(APP).toContain("case 'slider':")
  })

  it('is in the availableKinds fallback list', () => {
    const fallback = APP.slice(
      APP.indexOf('const availableKinds'),
      APP.indexOf('return Object.keys(hello.widgets)')
    )
    expect(fallback).toContain("'slider'")
  })

  it('is in the availableKinds type-guard filter', () => {
    const filter = APP.slice(APP.indexOf('return Object.keys(hello.widgets)'))
    expect(filter).toContain("k === 'slider'")
  })

  it('is NOT in PANEL_LOCAL_KINDS -- it takes a real SignalK bind', () => {
    const set = APP.slice(
      APP.indexOf('PANEL_LOCAL_KINDS'),
      APP.indexOf('function defaultWidget')
    )
    expect(set).not.toContain("'slider'")
  })

  it('gets min/max and the unit/scale/offset/decimals inspector blocks', () => {
    // Both blocks gate on `selected.type === 'slider'` (min/max alongside
    // arc/bar, display alongside label/value/arc/bar) -- not asserting
    // exact source formatting, just that both call sites exist.
    const occurrences = APP.split("selected.type === 'slider'").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })
})
