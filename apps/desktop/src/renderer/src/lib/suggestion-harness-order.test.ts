import { describe, expect, it } from 'vitest'
import { orderSuggestionHarnesses, suggestionHarnessKey } from './suggestion-harness-order'

describe('suggestionHarnessKey', () => {
  it('keys top-level harnesses by provider id', () => {
    expect(suggestionHarnessKey('claude')).toBe('claude')
    expect(suggestionHarnessKey('codex')).toBe('codex')
    expect(suggestionHarnessKey('opencode')).toBe('opencode')
  })

  it('keys ACP agents per agent id', () => {
    expect(suggestionHarnessKey('acp', 'grok-build')).toBe('acp:grok-build')
    expect(suggestionHarnessKey('acp', null)).toBe('acp')
  })
})

describe('orderSuggestionHarnesses', () => {
  const agents = [
    { id: 'grok-build', name: 'Grok Build' },
    { id: 'other-agent', name: 'Other' },
  ]

  it('defaults to claude, codex, then grok ACP when all counts are zero', () => {
    const ordered = orderSuggestionHarnesses({
      ranks: [],
      acpAgents: agents,
      experimentalAgentsEnabled: false,
    })
    expect(ordered.map((o) => o.key)).toEqual([
      'claude',
      'codex',
      'acp:grok-build',
      'acp:other-agent',
    ])
  })

  it('puts highest session count first and keeps rest sorted by count', () => {
    const ordered = orderSuggestionHarnesses({
      ranks: [
        { key: 'codex', provider: 'codex', acpAgentId: null, sessionCount: 12 },
        { key: 'claude', provider: 'claude', acpAgentId: null, sessionCount: 3 },
        { key: 'acp:grok-build', provider: 'acp', acpAgentId: 'grok-build', sessionCount: 8 },
      ],
      acpAgents: agents,
      experimentalAgentsEnabled: false,
    })
    expect(ordered.map((o) => o.key)).toEqual([
      'codex',
      'acp:grok-build',
      'claude',
      'acp:other-agent',
    ])
    expect(ordered[0]?.sessionCount).toBe(12)
  })

  it('includes opencode only when experimental agents are enabled', () => {
    const off = orderSuggestionHarnesses({
      ranks: [{ key: 'opencode', provider: 'opencode', acpAgentId: null, sessionCount: 99 }],
      acpAgents: [],
      experimentalAgentsEnabled: false,
    })
    expect(off.map((o) => o.key)).toEqual(['claude', 'codex'])

    const on = orderSuggestionHarnesses({
      ranks: [{ key: 'opencode', provider: 'opencode', acpAgentId: null, sessionCount: 99 }],
      acpAgents: [],
      experimentalAgentsEnabled: true,
    })
    expect(on.map((o) => o.key)).toEqual(['opencode', 'claude', 'codex'])
  })

  it('breaks ties with product default order', () => {
    const ordered = orderSuggestionHarnesses({
      ranks: [
        { key: 'codex', provider: 'codex', acpAgentId: null, sessionCount: 5 },
        { key: 'claude', provider: 'claude', acpAgentId: null, sessionCount: 5 },
        { key: 'acp:grok-build', provider: 'acp', acpAgentId: 'grok-build', sessionCount: 5 },
      ],
      acpAgents: [{ id: 'grok-build', name: 'Grok Build' }],
      experimentalAgentsEnabled: false,
    })
    expect(ordered.map((o) => o.key)).toEqual(['claude', 'codex', 'acp:grok-build'])
  })
})
