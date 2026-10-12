import { describe, expect, it } from 'vitest'
import { inferProviderFromHarnessId, isExperimentalAgentProvider } from './provider-routing'

describe('isExperimentalAgentProvider', () => {
  it('keeps Grok stable while gating other optional agents', () => {
    expect(isExperimentalAgentProvider('claude')).toBe(false)
    expect(isExperimentalAgentProvider('codex')).toBe(false)
    expect(isExperimentalAgentProvider('acp')).toBe(false)
    expect(isExperimentalAgentProvider('acp', 'grok-build')).toBe(false)
    expect(isExperimentalAgentProvider('acp', 'kimi-code')).toBe(true)
    expect(isExperimentalAgentProvider('opencode')).toBe(true)
  })
})

describe('inferProviderFromHarnessId', () => {
  it('knows every harness, dsh included, and nothing else', () => {
    for (const id of ['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh']) expect(inferProviderFromHarnessId(id)).toBe(id)
    expect(inferProviderFromHarnessId('toString')).toBeNull()
    expect(inferProviderFromHarnessId('future-harness')).toBeNull()
    expect(inferProviderFromHarnessId(null)).toBeNull()
  })
})
