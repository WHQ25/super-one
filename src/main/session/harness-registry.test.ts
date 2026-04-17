import { describe, it, expect } from 'vitest'
import { harnessRegistry } from './harness-registry'

describe('harnessRegistry', () => {
  it('lists claude and codex harnesses', () => {
    const ids = harnessRegistry.list().map((h) => h.id).sort()
    expect(ids).toEqual(['claude', 'codex'])
  })

  it('get returns the claude harness', () => {
    const h = harnessRegistry.get('claude')
    expect(h).toBeDefined()
    expect(h?.id).toBe('claude')
    expect(h?.name).toBeTruthy()
  })

  it('get returns the codex harness', () => {
    const h = harnessRegistry.get('codex')
    expect(h).toBeDefined()
    expect(h?.id).toBe('codex')
  })

  it('get returns undefined for unknown id', () => {
    // @ts-expect-error intentional invalid id
    expect(harnessRegistry.get('unknown')).toBeUndefined()
  })

  it('createBackend throws TODO until implemented', () => {
    const h = harnessRegistry.get('claude')!
    expect(() => h.createBackend({})).toThrow(/not implemented/i)
  })

  it('configSchema is defined (Zod schema)', () => {
    const h = harnessRegistry.get('claude')!
    expect(h.configSchema).toBeDefined()
  })
})
