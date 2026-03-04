import { describe, expect, it } from 'vitest'
import { splitEnv, mergeEnv, MODEL_ENV_KEY_SET, INTERNAL_ENV_KEYS } from './provider-env'

describe('splitEnv', () => {
  it('separates model, internal, and rest env vars', () => {
    const input = JSON.stringify({
      ANTHROPIC_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
      ANTHROPIC_AUTH_TOKEN: '',
      API_TIMEOUT_MS: '3000000',
      CUSTOM_VAR: 'hello',
    })
    const { modelEnv, internalEnv, restEnv } = splitEnv(input)
    expect(modelEnv).toEqual({
      ANTHROPIC_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
    })
    expect(internalEnv).toEqual({ ANTHROPIC_AUTH_TOKEN: '' })
    expect(JSON.parse(restEnv)).toEqual({ API_TIMEOUT_MS: '3000000', CUSTOM_VAR: 'hello' })
  })

  it('returns empty categories when no matching keys', () => {
    const input = JSON.stringify({ FOO: 'bar' })
    const { modelEnv, internalEnv, restEnv } = splitEnv(input)
    expect(modelEnv).toEqual({})
    expect(internalEnv).toEqual({})
    expect(JSON.parse(restEnv)).toEqual({ FOO: 'bar' })
  })

  it('handles empty JSON object', () => {
    const { modelEnv, internalEnv, restEnv } = splitEnv('{}')
    expect(modelEnv).toEqual({})
    expect(internalEnv).toEqual({})
    expect(restEnv).toBe('{}')
  })

  it('returns original string on invalid JSON', () => {
    const { modelEnv, internalEnv, restEnv } = splitEnv('not-json')
    expect(modelEnv).toEqual({})
    expect(internalEnv).toEqual({})
    expect(restEnv).toBe('not-json')
  })

  it('coerces non-string values to strings', () => {
    const input = JSON.stringify({ ANTHROPIC_MODEL: 123 })
    const { modelEnv } = splitEnv(input)
    expect(modelEnv).toEqual({ ANTHROPIC_MODEL: '123' })
  })

  it('splits ANTHROPIC_API_KEY into internalEnv', () => {
    const input = JSON.stringify({ ANTHROPIC_API_KEY: 'sk-test', FOO: 'bar' })
    const { internalEnv, restEnv } = splitEnv(input)
    expect(internalEnv).toEqual({ ANTHROPIC_API_KEY: 'sk-test' })
    expect(JSON.parse(restEnv)).toEqual({ FOO: 'bar' })
  })

  it('handles all 5 model env keys', () => {
    const input: Record<string, string> = {}
    for (const key of MODEL_ENV_KEY_SET) input[key] = 'model-x'
    const { modelEnv, restEnv } = splitEnv(JSON.stringify(input))
    expect(Object.keys(modelEnv)).toHaveLength(5)
    expect(JSON.parse(restEnv)).toEqual({})
  })
})

describe('mergeEnv', () => {
  it('merges model and internal env into rest', () => {
    const restEnv = JSON.stringify({ API_TIMEOUT_MS: '3000000' })
    const modelEnv = { ANTHROPIC_MODEL: 'glm-4.7' }
    const internalEnv = { ANTHROPIC_AUTH_TOKEN: '' }
    const result = JSON.parse(mergeEnv(restEnv, modelEnv, internalEnv))
    expect(result).toEqual({
      API_TIMEOUT_MS: '3000000',
      ANTHROPIC_MODEL: 'glm-4.7',
      ANTHROPIC_AUTH_TOKEN: '',
    })
  })

  it('removes model keys with empty values', () => {
    const restEnv = JSON.stringify({ ANTHROPIC_MODEL: 'old-value' })
    const result = JSON.parse(mergeEnv(restEnv, {}, {}))
    expect(result).not.toHaveProperty('ANTHROPIC_MODEL')
  })

  it('returns original string on invalid rest JSON', () => {
    expect(mergeEnv('bad-json', { ANTHROPIC_MODEL: 'x' }, {})).toBe('bad-json')
  })

  it('roundtrips with splitEnv', () => {
    const original = JSON.stringify({
      ANTHROPIC_MODEL: 'kimi-k2',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
      ANTHROPIC_AUTH_TOKEN: '',
      API_TIMEOUT_MS: '3000000',
    })
    const { modelEnv, internalEnv, restEnv } = splitEnv(original)
    const merged = mergeEnv(restEnv, modelEnv, internalEnv)
    expect(JSON.parse(merged)).toEqual(JSON.parse(original))
  })

  it('overwrites existing model keys in rest', () => {
    const restEnv = JSON.stringify({ ANTHROPIC_MODEL: 'old' })
    const result = JSON.parse(mergeEnv(restEnv, { ANTHROPIC_MODEL: 'new' }, {}))
    expect(result.ANTHROPIC_MODEL).toBe('new')
  })
})

describe('constant sets', () => {
  it('MODEL_ENV_KEY_SET contains expected keys', () => {
    expect(MODEL_ENV_KEY_SET.has('ANTHROPIC_MODEL')).toBe(true)
    expect(MODEL_ENV_KEY_SET.has('ANTHROPIC_DEFAULT_SONNET_MODEL')).toBe(true)
    expect(MODEL_ENV_KEY_SET.has('ANTHROPIC_DEFAULT_OPUS_MODEL')).toBe(true)
    expect(MODEL_ENV_KEY_SET.has('ANTHROPIC_DEFAULT_HAIKU_MODEL')).toBe(true)
    expect(MODEL_ENV_KEY_SET.has('CLAUDE_CODE_SUBAGENT_MODEL')).toBe(true)
    expect(MODEL_ENV_KEY_SET.size).toBe(5)
  })

  it('INTERNAL_ENV_KEYS contains auth keys only', () => {
    expect(INTERNAL_ENV_KEYS.has('ANTHROPIC_AUTH_TOKEN')).toBe(true)
    expect(INTERNAL_ENV_KEYS.has('ANTHROPIC_API_KEY')).toBe(true)
    expect(INTERNAL_ENV_KEYS.size).toBe(2)
  })
})
