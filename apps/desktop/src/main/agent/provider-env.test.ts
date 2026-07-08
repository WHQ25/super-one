import { describe, it, expect } from 'vitest'
import type { ApiProvider, ProviderCapability } from '@superone/shared/agent-types'
import { buildProviderEnv } from './provider-env'

function makeProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'p1',
    name: '',
    provider_type: '',
    api_key: '',
    api_key_env: '',
    category: 'model_provider',
    supported_agents: '',
    agent_configs: '{}',
    capabilities: '[]',
    is_active_claude: 0,
    is_active_codex: 0,
    sort_order: 0,
    notes: '',
    created_at: '',
    updated_at: '',
    base_url: '',
    extra_env: '',
    is_active: 0,
    agent_type: '',
    api_format: '',
    ...overrides,
  }
}

describe('buildProviderEnv (capabilities)', () => {
  it('builds ANTHROPIC_* env from an anthropic-messages chat capability', () => {
    const cap: ProviderCapability = {
      id: 'chat-claude',
      task: 'chat',
      protocol: 'anthropic-messages',
      enabled: true,
      baseUrl: 'https://api.anthropic.com',
      extraEnv: { ANTHROPIC_AUTH_TOKEN: 'placeholder' },
      modelMapping: { opus: { id: 'glm-4.6', name: 'GLM' } },
      harnesses: ['claude'],
    }
    const env = buildProviderEnv(makeProvider({ api_key: 'sk-real', capabilities: JSON.stringify([cap]) }), 'claude')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-real')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-real')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-4.6')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBe('GLM')
  })

  it('falls back to legacy agent_configs when capabilities are empty', () => {
    const provider = makeProvider({
      api_key: 'sk-legacy',
      agent_configs: JSON.stringify({
        claude: { base_url: 'https://legacy.example.com', api_format: 'anthropic', extra_env: '{}', model_env: '{}' },
      }),
    })
    const env = buildProviderEnv(provider, 'claude')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-legacy')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://legacy.example.com')
  })

  it('returns empty env when the harness has no chat capability', () => {
    const cap: ProviderCapability = { id: 'chat-codex', task: 'chat', protocol: 'openai-chat', enabled: true, harnesses: ['codex'] }
    expect(buildProviderEnv(makeProvider({ capabilities: JSON.stringify([cap]) }), 'claude')).toEqual({})
  })
})
