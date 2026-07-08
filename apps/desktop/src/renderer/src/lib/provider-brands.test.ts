import { describe, it, expect } from 'vitest'
import type { ApiProvider } from '@superone/shared/agent-types'
import { uniqueKeyName, draftFromProvider } from './provider-brands'

function makeProvider(over: Partial<ApiProvider>): ApiProvider {
  return {
    id: 'p1', name: 'GLM', key_name: 'default', provider_type: 'zhipu', api_key: 'sk-secret',
    api_key_env: '', category: 'coding', supported_agents: '["claude"]', agent_configs: '{"claude":{}}',
    capabilities: '[]', is_active_claude: 1, is_active_codex: 0, sort_order: 0, notes: '',
    created_at: 't0', updated_at: 't1', base_url: '', extra_env: '', is_active: 1, agent_type: '', api_format: '',
    ...over,
  }
}

describe('uniqueKeyName', () => {
  it('falls back to default when base is blank', () => {
    expect(uniqueKeyName('', [])).toBe('default')
    expect(uniqueKeyName('  ', [])).toBe('default')
  })

  it('returns the trimmed base when free', () => {
    expect(uniqueKeyName('  work ', ['default'])).toBe('work')
  })

  it('suffixes on collision until free', () => {
    expect(uniqueKeyName('default', ['default'])).toBe('default 2')
    expect(uniqueKeyName('default', ['default', 'default 2'])).toBe('default 3')
  })
})

describe('draftFromProvider', () => {
  it('inherits config but clears identity and secret', () => {
    const draft = draftFromProvider(makeProvider({ key_name: 'prod', agent_configs: '{"claude":{"base_url":"x"}}' }))
    expect(draft.id).toBe('')
    expect(draft.key_name).toBe('')
    expect(draft.api_key).toBe('')
    expect(draft.is_active_claude).toBe(0)
    expect(draft.agent_configs).toBe('{"claude":{"base_url":"x"}}')
    expect(draft.name).toBe('GLM')
  })
})
