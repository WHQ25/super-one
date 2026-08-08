import { describe, expect, it } from 'vitest'
import { isExperimentalAgentProvider } from './provider-routing'

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
