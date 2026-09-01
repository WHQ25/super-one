import { describe, expect, it } from 'vitest'
import { findCodexFastServiceTier, resolveCodexFastServiceTier } from './codex-fast-mode'

describe('findCodexFastServiceTier', () => {
  it('recognizes the priority tier advertised as Fast by app-server', () => {
    expect(findCodexFastServiceTier({
      serviceTiers: [{ id: 'priority', name: 'Fast', description: '1.5x speed' }],
    })?.id).toBe('priority')
  })

  it('keeps compatibility with the legacy fast tier id', () => {
    expect(findCodexFastServiceTier({
      serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }],
    })?.id).toBe('fast')
  })

  it('keeps Fast off by default and resolves the advertised tier when enabled', () => {
    const model = {
      serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
    }

    expect(resolveCodexFastServiceTier(model, false)).toBeNull()
    expect(resolveCodexFastServiceTier(model, true)).toBe('priority')
  })
})
