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

  it('folds a mapped bucket onto its plain alias', () => {
    const env = expandProviderModelEnv(TOKEN_PLAN_MAPPING)
    expect(resolveMappedClaudeModelId('opus', env)).toBe('opus')
    expect(resolveMappedClaudeModelId('sonnet', env)).toBe('sonnet')
    // A full Anthropic id is not rewritten by the env mapping; its bucket alias is.
    expect(resolveMappedClaudeModelId('claude-opus-5', env)).toBe('opus')
    expect(resolveMappedClaudeModelId(undefined, env)).toBeUndefined()
  })

  it('sends the ANTHROPIC_MODEL slot id for the default row instead of the alias', () => {
    // Regression: Claude Code expands `default` to `opus[1m]` and re-attaches the
    // suffix to the substituted id, so `kimi-for-coding` went out with the
    // context-1m beta header — a 256K plan answers 401.
    const env = expandProviderModelEnv({
      default: { id: 'kimi-for-coding' },
      opus: { id: 'kimi-for-coding' },
      haiku: { id: 'kimi-for-coding' },
    })
    expect(resolveMappedClaudeModelId('default', env)).toBe('kimi-for-coding')
  })

  it('keeps an explicit [1m] on the default slot id', () => {
    const env = expandProviderModelEnv({ default: { id: 'k3[1m]' }, opus: { id: 'k3[1m]' } })
    expect(resolveMappedClaudeModelId('default', env)).toBe('k3[1m]')
  })

  it('folds a full catalog id with no alias slot onto the default slot', () => {
    // Regression: the catalog's Fable row is the full id `claude-fable-5-1[1m]`;
    // the selector showed the mapped name while the provider received the
    // Anthropic id verbatim and rejected it.
    const env = expandProviderModelEnv({ default: { id: 'kimi-for-coding' }, opus: { id: 'kimi-for-coding' } })
    expect(resolveMappedClaudeModelId('claude-fable-5-1[1m]', env)).toBe('kimi-for-coding')
  })

  it('falls back to the opus alias when only slot overrides are mapped', () => {
    const env = expandProviderModelEnv(TOKEN_PLAN_MAPPING)
    expect(resolveMappedClaudeModelId('default', env)).toBe('opus')
    expect(resolveMappedClaudeModelId('claude-fable-5-1[1m]', env)).toBe('opus')
  })

  it('treats a bucket whose slot is unmapped like the default row', () => {
    const env = expandProviderModelEnv(TOKEN_PLAN_MAPPING)
    expect(resolveMappedClaudeModelId('haiku', env)).toBe('opus')
  })

  it('passes a slot id already on the wire through unchanged', () => {
    // Only the catalog alias forms need folding; a slot id has nothing to map.
    const env = expandProviderModelEnv({ default: { id: 'kimi-for-coding' }, haiku: { id: 'kimi-for-coding' } })
    expect(resolveMappedClaudeModelId('kimi-for-coding', env)).toBe('kimi-for-coding')
  })
})
