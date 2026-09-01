import { describe, expect, it } from 'vitest'
import {
  expandProviderModelEnv,
  hasProviderModelMappingEnv,
  resolveMappedClaudeModelId,
  type ProviderModelEnv,
} from './agent-types'

const TOKEN_PLAN_MAPPING: ProviderModelEnv = {
  opus: { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
  sonnet: { id: 'qwen3.8-plus', name: 'Qwen3.8 Plus' },
}

describe('hasProviderModelMappingEnv', () => {
  it('is false for an env with no slot overrides', () => {
    expect(hasProviderModelMappingEnv({ ANTHROPIC_BASE_URL: 'https://example.test' })).toBe(false)
    expect(hasProviderModelMappingEnv(undefined)).toBe(false)
    expect(hasProviderModelMappingEnv(null)).toBe(false)
  })

  it('is true once any bucket env var carries a value', () => {
    expect(hasProviderModelMappingEnv(expandProviderModelEnv(TOKEN_PLAN_MAPPING))).toBe(true)
    expect(hasProviderModelMappingEnv({ ANTHROPIC_MODEL: 'glm-5.2' })).toBe(true)
    expect(hasProviderModelMappingEnv({ CLAUDE_CODE_SUBAGENT_MODEL: 'k3' })).toBe(true)
  })

  it('ignores a declared-but-empty override', () => {
    expect(hasProviderModelMappingEnv({ ANTHROPIC_DEFAULT_OPUS_MODEL: '' })).toBe(false)
  })
})

describe('resolveMappedClaudeModelId', () => {
  it('drops the alias-side [1m] when a slot mapping is live', () => {
    // Regression: the catalog's `opus[1m]` row was picked as the fallback
    // default, and Claude Code re-attached the suffix to the substituted id —
    // `qwen3.8-max[1m]`, which the provider answers with 404.
    const env = expandProviderModelEnv(TOKEN_PLAN_MAPPING)
    expect(resolveMappedClaudeModelId('opus[1m]', env)).toBe('opus')
  })

  it('leaves the alias alone on the official endpoint', () => {
    expect(resolveMappedClaudeModelId('opus[1m]', { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }))
      .toBe('opus[1m]')
    expect(resolveMappedClaudeModelId('opus[1m]', undefined)).toBe('opus[1m]')
  })

  it('never rewrites the slot id the user explicitly set to [1m]', () => {
    const env = expandProviderModelEnv({ opus: { id: 'qwen3.8-max[1m]' } })
    expect(resolveMappedClaudeModelId('opus[1m]', env)).toBe('opus')
    // The 1M intent survives where it belongs: in the slot the harness reads.
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('qwen3.8-max[1m]')
  })

  it('passes through ids that carry no suffix', () => {
    const env = expandProviderModelEnv(TOKEN_PLAN_MAPPING)
    expect(resolveMappedClaudeModelId('opus', env)).toBe('opus')
    expect(resolveMappedClaudeModelId('claude-opus-5', env)).toBe('claude-opus-5')
    expect(resolveMappedClaudeModelId(undefined, env)).toBeUndefined()
  })
})
