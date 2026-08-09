import { describe, expect, it } from 'vitest'
import {
  orderSuggestionHarnesses,
  resolveMenuTabOption,
  suggestionHarnessKey,
  type SuggestionHarnessOption,
} from './suggestion-harness-order'

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

describe('resolveMenuTabOption', () => {
  const menu: SuggestionHarnessOption[] = [
    { key: 'codex', provider: 'codex', acpAgentId: null, label: 'Codex', sessionCount: 2 },
    {
      key: 'acp:grok-build',
      provider: 'acp',
      acpAgentId: 'grok-build',
      label: 'Grok Build',
      sessionCount: 1,
    },
  ]

  it('prefers the currently active menu harness', () => {
    const option = resolveMenuTabOption({
      menuHarnesses: menu,
      activeKey: 'acp:grok-build',
      rememberedMenu: { provider: 'codex', acpAgentId: null },
    })
    expect(option?.key).toBe('acp:grok-build')
  })

  it('keeps the last menu pick after switching to the fixed slot', () => {
    // activeKey is the fixed Top1 (claude) — not in the menu list.
    const option = resolveMenuTabOption({
      menuHarnesses: menu,
      activeKey: 'claude',
      rememberedMenu: { provider: 'acp', acpAgentId: 'grok-build' },
    })
    expect(option?.key).toBe('acp:grok-build')
  })

  it('falls back to rank #2 when there is no remembered menu pick', () => {
    const option = resolveMenuTabOption({
      menuHarnesses: menu,
      activeKey: 'claude',
      rememberedMenu: null,
    })
    expect(option?.key).toBe('codex')
  })
})
