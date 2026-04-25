import { describe, it, expect } from 'vitest'
import { PRESET_PROVIDER_KEY, resolveProviderKey, buildRemoteActiveProvider } from './provider-utils'
import type { ApiProvider } from './agent-types'

function makeProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'p1',
    name: '',
    provider_type: '',
    api_key: '',
    category: 'model_provider',
    supported_agents: '',
    agent_configs: '{}',
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

function withClaudeConfig(provider: Partial<ApiProvider>, claude: Record<string, unknown>): ApiProvider {
  return makeProvider({
    ...provider,
    agent_configs: JSON.stringify({ claude }),
  })
}

describe('PRESET_PROVIDER_KEY', () => {
  it('maps preset ids to brand keys', () => {
    expect(PRESET_PROVIDER_KEY['anthropic-official']).toBe('anthropic')
    expect(PRESET_PROVIDER_KEY['glm-cn']).toBe('zhipu')
    expect(PRESET_PROVIDER_KEY['glm-global']).toBe('zhipu')
    expect(PRESET_PROVIDER_KEY['vertex']).toBe('google')
    expect(PRESET_PROVIDER_KEY['kat-coder']).toBe('kwaikat')
    expect(PRESET_PROVIDER_KEY['siliconflow']).toBe('siliconcloud')
    expect(PRESET_PROVIDER_KEY['xiaomi-mimo']).toBe('xiaomimimo')
    expect(PRESET_PROVIDER_KEY['nvidia-nim']).toBe('nvidia')
    expect(PRESET_PROVIDER_KEY['codex-official']).toBe('openai')
  })

  it('maps custom-style presets to empty string (no preset brand)', () => {
    expect(PRESET_PROVIDER_KEY['dmxapi']).toBe('')
    expect(PRESET_PROVIDER_KEY['packycode']).toBe('')
    expect(PRESET_PROVIDER_KEY['custom-api']).toBe('')
  })
})

describe('resolveProviderKey', () => {
  it('resolves anthropic from claude base_url', () => {
    const p = withClaudeConfig({}, { base_url: 'https://api.anthropic.com', model_env: '', extra_env: '', api_format: '' })
    expect(resolveProviderKey(p)).toBe('anthropic')
  })

  it('falls back to codex base_url when claude config missing', () => {
    const p = makeProvider({
      agent_configs: JSON.stringify({ codex: { base_url: 'https://api.openrouter.ai', model_env: '', extra_env: '', api_format: '' } }),
    })
    expect(resolveProviderKey(p)).toBe('openrouter')
  })

  it('matches zhipu via z.ai or bigmodel.cn', () => {
    expect(resolveProviderKey(withClaudeConfig({}, { base_url: 'https://open.bigmodel.cn/api', model_env: '', extra_env: '', api_format: '' }))).toBe('zhipu')
    expect(resolveProviderKey(withClaudeConfig({}, { base_url: 'https://api.z.ai/v1', model_env: '', extra_env: '', api_format: '' }))).toBe('zhipu')
  })

  it('uses provider_type for bedrock/vertex even without URL hints', () => {
    expect(resolveProviderKey(makeProvider({ provider_type: 'bedrock', name: 'AWS' }))).toBe('bedrock')
    expect(resolveProviderKey(makeProvider({ provider_type: 'vertex', name: 'Google Vertex' }))).toBe('google')
  })

  it('falls back to name when no URL is configured', () => {
    expect(resolveProviderKey(makeProvider({ name: 'My DeepSeek Proxy' }))).toBe('deepseek')
    expect(resolveProviderKey(makeProvider({ name: 'My Kimi Endpoint' }))).toBe('kimi')
  })

  it('returns null for dmxapi/packy and unknown providers', () => {
    expect(resolveProviderKey(withClaudeConfig({ name: 'My Proxy' }, { base_url: 'https://www.dmxapi.com', model_env: '', extra_env: '', api_format: '' }))).toBeNull()
    expect(resolveProviderKey(makeProvider({ name: 'PackyCode' }))).toBeNull()
    expect(resolveProviderKey(makeProvider({ name: 'random-provider' }))).toBeNull()
  })

  it('handles malformed agent_configs gracefully', () => {
    expect(resolveProviderKey(makeProvider({ agent_configs: 'not-json{' }))).toBeNull()
  })

  it('matches case-insensitively on URL and name', () => {
    expect(resolveProviderKey(withClaudeConfig({ name: 'ANTHROPIC' }, { base_url: 'HTTPS://API.ANTHROPIC.COM', model_env: '', extra_env: '', api_format: '' }))).toBe('anthropic')
  })
})

describe('buildRemoteActiveProvider', () => {
  it('returns null when provider is null/undefined', () => {
    expect(buildRemoteActiveProvider(null)).toBeNull()
    expect(buildRemoteActiveProvider(undefined)).toBeNull()
  })

  it('extracts presetKey, modelEnv and forcedEffort for claude', () => {
    const provider = withClaudeConfig(
      { id: 'pid', name: 'Anthropic Official' },
      {
        base_url: 'https://api.anthropic.com',
        model_env: JSON.stringify({
          sonnet: { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
          opus: { id: 'claude-opus-4-7', description: 'Top tier' },
        }),
        extra_env: JSON.stringify({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }),
        api_format: '',
      },
    )
    const result = buildRemoteActiveProvider(provider, 'claude')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('pid')
    expect(result!.name).toBe('Anthropic Official')
    expect(result!.presetKey).toBe('anthropic')
    expect(result!.modelEnv.sonnet?.id).toBe('claude-sonnet-4-5')
    expect(result!.modelEnv.sonnet?.name).toBe('Sonnet 4.5')
    expect(result!.modelEnv.opus?.id).toBe('claude-opus-4-7')
    expect(result!.modelEnv.opus?.description).toBe('Top tier')
    expect(result!.forcedEffort).toBe('high')
  })

  it('parses CLAUDE_CODE_EFFORT_LEVEL=auto and other levels', () => {
    const make = (level: string) => withClaudeConfig({}, {
      base_url: 'https://api.anthropic.com',
      model_env: '',
      extra_env: JSON.stringify({ CLAUDE_CODE_EFFORT_LEVEL: level }),
      api_format: '',
    })
    expect(buildRemoteActiveProvider(make('auto'), 'claude')!.forcedEffort).toBe('auto')
    expect(buildRemoteActiveProvider(make('low'), 'claude')!.forcedEffort).toBe('low')
    expect(buildRemoteActiveProvider(make('xhigh'), 'claude')!.forcedEffort).toBe('xhigh')
    expect(buildRemoteActiveProvider(make('max'), 'claude')!.forcedEffort).toBe('max')
    expect(buildRemoteActiveProvider(make(''), 'claude')!.forcedEffort).toBeNull()
    expect(buildRemoteActiveProvider(make('garbage'), 'claude')!.forcedEffort).toBeNull()
  })

  it('does not set forcedEffort for codex harness', () => {
    const provider = withClaudeConfig({}, {
      base_url: 'https://api.openai.com',
      model_env: '',
      extra_env: JSON.stringify({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }),
      api_format: '',
    })
    expect(buildRemoteActiveProvider(provider, 'codex')!.forcedEffort).toBeNull()
  })

  it('returns empty modelEnv when slot data is malformed', () => {
    const provider = withClaudeConfig({}, {
      base_url: 'https://api.anthropic.com',
      model_env: 'not-json',
      extra_env: '',
      api_format: '',
    })
    expect(buildRemoteActiveProvider(provider, 'claude')!.modelEnv).toEqual({})
  })

  it('drops slots without an id field', () => {
    const provider = withClaudeConfig({}, {
      base_url: 'https://api.anthropic.com',
      model_env: JSON.stringify({
        sonnet: { name: 'Bad Slot' },
        opus: { id: 'good', name: 'Good' },
      }),
      extra_env: '',
      api_format: '',
    })
    const env = buildRemoteActiveProvider(provider, 'claude')!.modelEnv
    expect(env.sonnet).toBeUndefined()
    expect(env.opus?.id).toBe('good')
  })

  it('handles empty agent_configs', () => {
    const result = buildRemoteActiveProvider(makeProvider({ name: 'Custom', agent_configs: '' }), 'claude')
    expect(result).not.toBeNull()
    expect(result!.modelEnv).toEqual({})
    expect(result!.forcedEffort).toBeNull()
  })
})
