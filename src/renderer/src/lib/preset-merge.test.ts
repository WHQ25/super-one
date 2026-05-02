import { describe, it, expect } from 'vitest'
import { diffProviderAgainstPreset, applyPresetSync } from './preset-merge'
import { getPresetByKey } from './preset-match'
import type { ApiProvider } from '../../../shared/agent-types'

function makeProvider(partial: Partial<ApiProvider> & { agent_configs: string; supported_agents?: string }): ApiProvider {
  return {
    id: 'p1', name: 'Test', provider_type: 'custom', api_key: '', category: 'custom',
    supported_agents: '["claude"]',
    is_active_claude: 0, is_active_codex: 0,
    base_url: '', extra_env: '{}', is_active: 0, sort_order: 0, notes: '',
    created_at: '', updated_at: '', agent_type: 'claude', api_format: 'anthropic',
    ...partial,
  } as ApiProvider
}

describe('preset diff & apply (regression: stale provider missing AUTH_TOKEN placeholder)', () => {
  it('detects ANTHROPIC_AUTH_TOKEN placeholder is missing on a legacy MiniMax (CN) provider', () => {
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
    const preset = getPresetByKey('minimax-cn')!
    const diff = diffProviderAgainstPreset(provider, preset)
    expect(diff.hasChanges).toBe(true)
    const claude = diff.perAgent.find((a) => a.agent === 'claude')!
    expect(claude.extraEnvAdded).toHaveProperty('ANTHROPIC_AUTH_TOKEN', '')
    expect(claude.extraEnvAdded).toHaveProperty('API_TIMEOUT_MS', '3000000')
  })

  it('preserves user-modified extra_env values when applying sync', () => {
    const provider = makeProvider({
      name: 'DeepSeek',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://api.deepseek.com/anthropic',
          extra_env: '{"CLAUDE_CODE_EFFORT_LEVEL":"max","CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK":"1"}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('deepseek')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const updated = applyPresetSync(provider, preset, diff)
    const cfg = JSON.parse(updated.agent_configs).claude
    const extra = JSON.parse(cfg.extra_env)
    expect(extra.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')
    expect(extra.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK).toBe('1')
    expect(extra.ANTHROPIC_AUTH_TOKEN).toBe('')
  })

  it('reports user-customized model_env slots as modelEnvSlotsChanged (not added)', () => {
    const provider = makeProvider({
      name: 'DeepSeek',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://api.deepseek.com/anthropic',
          extra_env: '{}',
          model_env: JSON.stringify({
            default: { id: 'my-custom-default', name: 'Custom' },
            opus: { id: 'my-custom-opus', name: 'Custom Opus' },
            sonnet: { id: 'my-custom-sonnet', name: 'Custom Sonnet' },
            haiku: { id: 'my-custom-haiku', name: 'Custom Haiku' },
            subagent: { id: 'my-custom-subagent', name: 'Custom Subagent' },
          }),
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('deepseek')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const claude = diff.perAgent.find((a) => a.agent === 'claude')
    expect(claude?.modelEnvSlotsAdded ?? {}).toEqual({})
    expect(claude?.modelEnvSlotsChanged.length).toBeGreaterThan(0)

    const filtered = {
      ...diff,
      perAgent: diff.perAgent.map((ad) => ({ ...ad, modelEnvSlotsChanged: [] })),
    }
    const updated = applyPresetSync(provider, preset, filtered)
    const me = JSON.parse(JSON.parse(updated.agent_configs).claude.model_env)
    expect(me.default.id).toBe('my-custom-default')
    expect(me.haiku.id).toBe('my-custom-haiku')
  })

  it('reports base_url mismatch and applies it when included in the diff', () => {
    const provider = makeProvider({
      name: 'GLM (CN)',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://my-proxy.example.com/glm',
          extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('glm-cn')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const claude = diff.perAgent.find((a) => a.agent === 'claude')
    expect(claude?.baseUrlMismatch).toBeDefined()

    const updated = applyPresetSync(provider, preset, diff)
    expect(JSON.parse(updated.agent_configs).claude.base_url).toBe(preset.agent_configs.claude!.base_url)
  })

  it('does not touch base_url when caller filters baseUrlMismatch out (user unchecked it)', () => {
    const provider = makeProvider({
      name: 'GLM (CN)',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://my-proxy.example.com/glm',
          extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('glm-cn')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const filtered = {
      ...diff,
      perAgent: diff.perAgent.map((ad) => ({ ...ad, baseUrlMismatch: undefined })),
    }
    const updated = applyPresetSync(provider, preset, filtered)
    expect(JSON.parse(updated.agent_configs).claude.base_url).toBe('https://my-proxy.example.com/glm')
  })

  it('detects extraEnvChanged for keys whose value differs from the preset', () => {
    const provider = makeProvider({
      name: 'GLM (CN)',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://open.bigmodel.cn/api/anthropic',
          extra_env: '{"API_TIMEOUT_MS":"9999","ANTHROPIC_AUTH_TOKEN":"","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1"}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('glm-cn')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const claude = diff.perAgent.find((a) => a.agent === 'claude')!
    const apiTimeout = claude.extraEnvChanged.find((c) => c.key === 'API_TIMEOUT_MS')
    expect(apiTimeout).toBeDefined()
    expect(apiTimeout?.from).toBe('9999')
    expect(apiTimeout?.to).toBe('3000000')
  })

  it('applies extraEnvChanged when included in the diff (overriding existing value)', () => {
    const provider = makeProvider({
      name: 'GLM (CN)',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://open.bigmodel.cn/api/anthropic',
          extra_env: '{"API_TIMEOUT_MS":"9999","ANTHROPIC_AUTH_TOKEN":"","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1"}',
          model_env: '{}',
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('glm-cn')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const updated = applyPresetSync(provider, preset, diff)
    const extra = JSON.parse(JSON.parse(updated.agent_configs).claude.extra_env)
    expect(extra.API_TIMEOUT_MS).toBe('3000000')
  })

  it('detects modelEnvSlotsChanged when slot id differs', () => {
    const provider = makeProvider({
      name: 'GLM (CN)',
      agent_configs: JSON.stringify({
        claude: {
          base_url: 'https://open.bigmodel.cn/api/anthropic',
          extra_env: '{}',
          model_env: JSON.stringify({ default: { id: 'glm-old', name: 'old' } }),
          api_format: 'anthropic',
        },
      }),
    })
    const preset = getPresetByKey('glm-cn')!
    const diff = diffProviderAgainstPreset(provider, preset)
    const claude = diff.perAgent.find((a) => a.agent === 'claude')!
    const change = claude.modelEnvSlotsChanged.find((c) => c.slot === 'default')
    expect(change?.from.id).toBe('glm-old')
    expect(change?.to.id).toBe(preset.agent_configs.claude!.model_env!.default!.id)
  })

  it('returns hasChanges=false when provider already in sync', () => {
    const preset = getPresetByKey('deepseek')!
    const presetClaude = preset.agent_configs.claude!
    const provider = makeProvider({
      name: 'DeepSeek',
      agent_configs: JSON.stringify({
        claude: {
          base_url: presetClaude.base_url,
          extra_env: presetClaude.extra_env,
          model_env: JSON.stringify(presetClaude.model_env ?? {}),
          api_format: 'anthropic',
        },
      }),
    })
    const diff = diffProviderAgainstPreset(provider, preset)
    expect(diff.hasChanges).toBe(false)
  })
})
