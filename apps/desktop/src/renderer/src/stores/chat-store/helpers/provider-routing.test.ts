import { describe, expect, it } from 'vitest'
import { inferProviderFromHarnessId, isExperimentalAgentProvider } from './provider-routing'

describe('isExperimentalAgentProvider', () => {
  it('keeps Grok stable while gating other optional agents', () => {
    expect(isExperimentalAgentProvider('claude')).toBe(false)
    expect(isExperimentalAgentProvider('codex')).toBe(false)
    expect(isExperimentalAgentProvider('acp-grok')).toBe(false)
    expect(isExperimentalAgentProvider('acp-grok', 'grok-build')).toBe(false)
    expect(isExperimentalAgentProvider('acp-antigravity', 'kimi-code')).toBe(false)
    expect(isExperimentalAgentProvider('opencode')).toBe(true)
  })
})

describe('inferProviderFromHarnessId', () => {
  it('knows every harness, dsh included, and nothing else', () => {
    for (const id of ['claude', 'codex', 'acp-grok', 'acp-antigravity', 'opencode', 'cursor', 'dsh']) expect(inferProviderFromHarnessId(id)).toBe(id)
    expect(inferProviderFromHarnessId('acp')).toBe('acp-grok')
    expect(inferProviderFromHarnessId('acp', 'antigravity')).toBe('acp-antigravity')
    expect(inferProviderFromHarnessId('toString')).toBeNull()
    expect(inferProviderFromHarnessId('future-harness')).toBeNull()
    expect(inferProviderFromHarnessId(null)).toBeNull()
  })
})
