import { describe, it, expect } from 'vitest'
import { resolvePresetKey, getPresetByKey } from './preset-match'
import type { ApiProvider } from '../../../shared/agent-types'

function makeProvider(partial: Partial<ApiProvider> & { agent_configs: string }): ApiProvider {
  return {
    id: 'p1',
    name: 'Test',
    provider_type: 'custom',
    api_key: '',
    category: 'custom',
    supported_agents: '["claude"]',
    is_active_claude: 0,
    is_active_codex: 0,
    base_url: '',
    extra_env: '{}',
    is_active: 0,
    sort_order: 0,
    notes: '',
    created_at: '',
    updated_at: '',
    agent_type: 'claude',
    api_format: 'anthropic',
    ...partial,
  } as ApiProvider
}

describe('preset key matching', () => {
  it('resolves a stored MiniMax (CN) provider to minimax-cn even when extra_env was stripped', () => {
    const provider = makeProvider({
      name: 'MiniMax (CN)',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://api.minimaxi.com/anthropic',
          extra_env: '{"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1"}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    expect(resolvePresetKey(provider)).toBe('minimax-cn')
  })

  it('resolves a stored DeepSeek provider to deepseek even with user-customized extra_env', () => {
    const provider = makeProvider({
      name: 'DeepSeek',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://api.deepseek.com/anthropic',
          extra_env: '{"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","CLAUDE_CODE_EFFORT_LEVEL":"max"}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    expect(resolvePresetKey(provider)).toBe('deepseek')
  })

  it('disambiguates GLM (CN) vs GLM (Global) by base_url domain', () => {
    const cn = makeProvider({
      name: 'My GLM',
      agent_configs: JSON.stringify({ claude: { base_url: 'https://open.bigmodel.cn/api/anthropic', extra_env: '{}', model_env: '{}', api_format: 'anthropic' } }),
    })
    const global = makeProvider({
      name: 'My GLM',
      agent_configs: JSON.stringify({ claude: { base_url: 'https://api.z.ai/api/anthropic', extra_env: '{}', model_env: '{}', api_format: 'anthropic' } }),
    })
    expect(resolvePresetKey(cn)).toBe('glm-cn')
    expect(resolvePresetKey(global)).toBe('glm-global')
  })

  it('uses provider name to break tie when two presets share base_url (doubao-seed vs volcengine)', () => {
    const doubao = makeProvider({
      name: 'DouBaoSeed',
      agent_configs: JSON.stringify({ claude: { base_url: 'https://ark.cn-beijing.volces.com/api/coding', extra_env: '{}', model_env: '{}', api_format: 'anthropic' } }),
    })
    const volc = makeProvider({
      name: 'Volcengine Ark',
      agent_configs: JSON.stringify({ claude: { base_url: 'https://ark.cn-beijing.volces.com/api/coding', extra_env: '{}', model_env: '{}', api_format: 'anthropic' } }),
    })
    expect(resolvePresetKey(doubao)).toBe('doubao-seed')
    expect(resolvePresetKey(volc)).toBe('volcengine')
  })

  it('returns null for a fully custom base_url with no provider_type hint', () => {
    const provider = makeProvider({
      name: 'My local proxy',
      agent_configs: JSON.stringify({ claude: { base_url: 'https://my-private-proxy.example.com/v1', extra_env: '{}', model_env: '{}', api_format: 'anthropic' } }),
    })
    expect(resolvePresetKey(provider)).toBe(null)
  })

  it('falls back to provider_type for bedrock/vertex/anthropic when base_url is empty', () => {
    const bedrock = makeProvider({
      name: 'AWS', provider_type: 'bedrock',
      agent_configs: JSON.stringify({ claude: { base_url: '', extra_env: '{}', model_env: '{}', api_format: 'anthropic' } }),
    })
    expect(resolvePresetKey(bedrock)).toBe('bedrock')
  })

  it('getPresetByKey returns the matching preset object', () => {
    const preset = getPresetByKey('minimax-cn')
    expect(preset?.name).toBe('MiniMax (CN)')
  })
})
