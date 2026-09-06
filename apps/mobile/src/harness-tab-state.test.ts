import { describe, expect, it } from 'vitest'
import { harnessTabSlots } from './harness-tab-state'

describe('harnessTabSlots', () => {
  it('returns null when there is nothing to switch between', () => {
    expect(harnessTabSlots({ harnesses: [], active: 'claude' })).toBeNull()
    expect(harnessTabSlots({ harnesses: ['claude'], active: 'claude' })).toBeNull()
  })

  it('keeps the second slot a plain tab when exactly two harnesses exist', () => {
    const slots = harnessTabSlots({ harnesses: ['claude', 'codex'], active: 'claude' })
    expect(slots).toEqual({ fixed: 'claude', menu: ['codex'], menuTab: 'codex', menuActive: false })
  })

  it('names the active harness in the second slot when it lives there', () => {
    const slots = harnessTabSlots({ harnesses: ['claude', 'codex', 'cursor'], active: 'cursor' })
    expect(slots?.menuTab).toBe('cursor')
    expect(slots?.menuActive).toBe(true)
  })

  it('falls back to the remembered pick while the fixed slot is active', () => {
    const slots = harnessTabSlots({ harnesses: ['claude', 'codex', 'cursor'], active: 'claude', remembered: 'cursor' })
    expect(slots?.menuTab).toBe('cursor')
    expect(slots?.menuActive).toBe(false)
  })

  it('ignores a remembered pick that is no longer enabled', () => {
    const slots = harnessTabSlots({ harnesses: ['claude', 'codex'], active: 'claude', remembered: 'cursor' })
    expect(slots?.menuTab).toBe('codex')
  })

  it('de-duplicates the harness list before splitting it', () => {
    const slots = harnessTabSlots({ harnesses: ['claude', 'claude', 'codex'], active: 'codex' })
    expect(slots).toEqual({ fixed: 'claude', menu: ['codex'], menuTab: 'codex', menuActive: true })
  })
})
