import { describe, expect, it } from 'vitest'
import { planNodeAction } from './node-action-plan'
import type { UiOutlineNode } from './types'

const field: UiOutlineNode = { ref: '@e2', role: 'textField', name: 'Search', appFocused: true, capabilities: { setText: true, typeText: true } }

describe('observed node action plans', () => {
  it('maps press and replacement to native computer_act actions', () => {
    expect(planNodeAction({ ...field, capabilities: { press: true } }, { kind: 'press' }, 'click')).toEqual({ actions: [{ type: 'press', ref: '@e2' }] })
    expect(planNodeAction(field, { kind: 'setText', text: 'cats' }, 'full')).toEqual({ actions: [{ type: 'setText', ref: '@e2', text: 'cats' }], expect: { kind: 'valueEquals', ref: '@e2', value: 'cats' } })
  })

  it('maps scroll to the scroll area ref and focused Return to a key', () => {
    // The platform writes the area's scroll bar value for a scroll with a ref.
    expect(planNodeAction({ ...field, capabilities: { scroll: true }, bounds: { x: 0, y: 0, width: 200, height: 100 } }, { kind: 'scroll', dy: 600 }, 'click')).toEqual({ actions: [{ type: 'scroll', ref: '@e2', dy: 600 }] })
    expect(planNodeAction(field, { kind: 'enter' }, 'full')).toEqual({ actions: [{ type: 'keypress', keys: ['Return'] }] })
  })

  it('does not confuse keyboard typing with exact replacement', () => {
    expect(planNodeAction({ ...field, capabilities: { typeText: true } }, { kind: 'setText', text: 'cats' }, 'full')).toBeUndefined()
  })

  it('withholds Return without app focus and scrolling without usable bounds', () => {
    expect(planNodeAction({ ...field, appFocused: false }, { kind: 'enter' }, 'full')).toBeUndefined()
    expect(planNodeAction({ ...field, capabilities: { scroll: true } }, { kind: 'scroll', dy: 600 }, 'full')).toBeUndefined()
  })

  it.each([{ secure: true }, { enabled: false }, { pictureOnly: true }])('excludes unavailable targets: %j', (extra) => {
    expect(planNodeAction({ ...field, ...extra }, { kind: 'setText', text: 'cats' }, 'full')).toBeUndefined()
  })

  it('honors read and click capability tiers for every intent', () => {
    expect(planNodeAction(field, { kind: 'setText', text: 'cats' }, null)).toBeUndefined()
    expect(planNodeAction({ ...field, capabilities: { press: true } }, { kind: 'press' }, 'read')).toBeUndefined()
    expect(planNodeAction(field, { kind: 'setText', text: 'cats' }, 'click')).toBeUndefined()
    expect(planNodeAction(field, { kind: 'enter' }, 'click')).toBeUndefined()
  })
})
