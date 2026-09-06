import { describe, expect, it } from 'vitest'
import type { ClaudeAccount, ModelOption } from '@superone/shared/agent-types'
import {
  acpModeCatalog,
  claudeAccountKeyName,
  deepseekModeCatalog,
  harnessProviderCatalog,
  openCodeAgentCatalog,
} from './remote-selector-catalog'

function mode(id: string, name: string, description = ''): ModelOption {
  return { id, name, description }
}

describe('ACP mode catalog', () => {
  it('reads Grok extraModes as effort, ascending and without the repeated noun', () => {
    const projection = acpModeCatalog({
      modeConfigId: null,
      selectedModeId: 'high',
      modes: [mode('high', 'High Effort'), mode('low', 'Low Effort'), mode('medium', 'Medium Effort')],
    })

    expect(projection.efforts.map((option) => option.value)).toEqual(['low', 'medium', 'high'])
    expect(projection.efforts.map((option) => option.label)).toEqual(['Low', 'Medium', 'High'])
    expect(projection.modes).toEqual([])
  })

  it('keeps real session modes out of effort, so the client does not draw a slider for them', () => {
    const projection = acpModeCatalog({
      modeConfigId: 'mode-config',
      selectedModeId: 'code',
      modes: [mode('ask', 'Ask'), mode('code', 'Code', 'Edit files directly')],
    })

    expect(projection.efforts).toEqual([])
    expect(projection.modes).toEqual([
      { id: 'ask', name: 'Ask' },
      { id: 'code', name: 'Code', description: 'Edit files directly' },
    ])
    expect(projection.selectedModeId).toBe('code')
  })

  it('falls back to the first mode when the agent named no selection', () => {
    const projection = acpModeCatalog({
      modeConfigId: 'mode-config',
      selectedModeId: null,
      modes: [mode('ask', 'Ask'), mode('code', 'Code')],
    })

    expect(projection.selectedModeId).toBe('ask')
  })

  it('projects nothing for an agent with no modes at all', () => {
    expect(acpModeCatalog(null)).toEqual({ efforts: [], modes: [], selectedModeId: null })
  })
})

describe('OpenCode agent catalog', () => {
  it('defaults to build, the same agent the desktop store resolves', () => {
    const projection = openCodeAgentCatalog({
      models: [],
      agents: [
        { id: 'general', name: 'general', description: 'Broad tasks', modelId: null },
        { id: 'build', name: 'build', description: 'Write code', modelId: 'anthropic/opus' },
      ],
      commands: [],
    } as never)

    expect(projection.selectedAgentId).toBe('build')
    expect(projection.agents.map((agent) => agent.id)).toEqual(['general', 'build'])
  })

  it('falls back to the first agent, and stays empty without a catalog', () => {
    expect(openCodeAgentCatalog({ agents: [{ id: 'plan', name: 'plan', modelId: null }] } as never).selectedAgentId).toBe('plan')
    expect(openCodeAgentCatalog(null)).toEqual({ agents: [], selectedAgentId: null })
  })
})

describe('DeepSeek preset catalog', () => {
  it('marks a broken preset disabled and reports a session that can no longer switch', () => {
    const projection = deepseekModeCatalog({
      presets: [
        { id: 'default', name: 'Default', description: 'Shipped', trust: 'system', order: 0, broken: null },
        { id: 'custom', name: 'Custom', description: null, trust: 'user', order: 1, broken: 'missing prompt' },
      ],
      current: 'custom',
      switchable: false,
    })

    expect(projection.modes).toEqual([
      { id: 'default', name: 'Default', description: 'Shipped' },
      { id: 'custom', name: 'Custom', disabled: true },
    ])
    expect(projection.selectedModeId).toBe('custom')
    expect(projection.modesLocked).toBe(true)
  })

  it('reports no lock when there is nothing to lock', () => {
    expect(deepseekModeCatalog(null)).toEqual({ modes: [], selectedModeId: null, modesLocked: false })
  })
})

describe('provider catalog', () => {
  const source = {
    credentials: [
      { id: 'cred-1', name: 'work key', platformId: 'kimi' },
      { id: 'cred-2', name: 'video key', platformId: 'volcengine' },
    ],
    servesHarness: (id: string) => (id === 'cred-1' ? { brand: 'kimi' } : null),
    platformName: (platformId: string) => (platformId === 'kimi' ? 'Kimi' : 'Volcengine'),
  }

  it('lists the host default first, then only credentials that can serve the harness', () => {
    const { providers } = harnessProviderCatalog('claude', source)

    expect(providers).toEqual([
      { id: null, name: 'Claude', brand: 'claude' },
      { id: 'cred-1', name: 'Kimi · work key', brand: 'kimi', keyName: 'work key' },
    ])
  })

  it('leaves harnesses without a credential story empty', () => {
    expect(harnessProviderCatalog('opencode', source).providers).toEqual([])
  })

  it('expands the Claude default row per account only once there are two', () => {
    const accounts: ClaudeAccount[] = [
      { credentialDir: null, email: 'a@example.com', loggedIn: true } as ClaudeAccount,
      { credentialDir: 'dir-2', email: 'b@example.com', loggedIn: true } as ClaudeAccount,
    ]
    const single = harnessProviderCatalog('claude', { ...source, claudeAccounts: [accounts[0]!] })
    const many = harnessProviderCatalog('claude', { ...source, claudeAccounts: accounts })

    expect(single.providers[0]).toEqual({ id: null, name: 'Claude', brand: 'claude' })
    expect(many.providers.slice(0, 2).map((provider) => provider.keyName))
      .toEqual(['a@example.com', 'b@example.com'])
  })
})

describe('claudeAccountKeyName', () => {
  it('appends the org only when two accounts share an email', () => {
    const shared: ClaudeAccount[] = [
      { credentialDir: null, email: 'a@example.com', orgName: 'Acme', loggedIn: true } as ClaudeAccount,
      { credentialDir: 'd', email: 'a@example.com', orgName: 'Globex', loggedIn: true } as ClaudeAccount,
    ]

    expect(claudeAccountKeyName(shared[0]!, shared)).toBe('a@example.com · Acme')
    expect(claudeAccountKeyName(shared[0]!, [shared[0]!])).toBe('a@example.com')
  })
})
