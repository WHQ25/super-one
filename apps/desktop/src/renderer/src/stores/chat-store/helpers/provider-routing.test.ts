import { describe, expect, it } from 'vitest'
import { isExperimentalAgentProvider } from './provider-routing'

describe('isExperimentalAgentProvider', () => {
  it('treats every provider other than Claude and Codex as experimental', () => {
    expect(isExperimentalAgentProvider('claude')).toBe(false)
    expect(isExperimentalAgentProvider('codex')).toBe(false)
    expect(isExperimentalAgentProvider('acp')).toBe(true)
    expect(isExperimentalAgentProvider('opencode')).toBe(true)
  })
})
