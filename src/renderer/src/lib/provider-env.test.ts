import { describe, expect, it } from 'vitest'
import { parseEnvString, RESERVED_ENV_KEYS } from './provider-env'

describe('parseEnvString', () => {
  it('parses simple key=value pairs', () => {
    expect(parseEnvString('FOO=bar\nBAZ=qux')).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ])
  })

  it('ignores empty lines and comments', () => {
    expect(parseEnvString('FOO=bar\n\n# comment\nBAZ=qux')).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ])
  })

  it('handles export prefix', () => {
    expect(parseEnvString('export FOO=bar\nexport BAZ=qux')).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ])
  })

  it('handles values containing equals sign', () => {
    expect(parseEnvString('FOO=bar=baz')).toEqual([{ key: 'FOO', value: 'bar=baz' }])
  })

  it('strips surrounding quotes from values', () => {
    expect(parseEnvString('FOO="bar"\nBAZ=\'qux\'')).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ])
  })

  it('skips lines without equals sign', () => {
    expect(parseEnvString('INVALID_LINE\nFOO=bar')).toEqual([{ key: 'FOO', value: 'bar' }])
  })

  it('deduplicates by key, keeping first occurrence', () => {
    expect(parseEnvString('FOO=first\nFOO=second')).toEqual([{ key: 'FOO', value: 'first' }])
  })

  it('trims whitespace around keys and values', () => {
    expect(parseEnvString('  FOO  =  bar  ')).toEqual([{ key: 'FOO', value: 'bar' }])
  })
})

describe('RESERVED_ENV_KEYS', () => {
  it('covers all bucket id/name/description env vars', () => {
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_MODEL')).toBe(true)
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_DEFAULT_OPUS_MODEL')).toBe(true)
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_DEFAULT_SONNET_MODEL_NAME')).toBe(true)
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION')).toBe(true)
    expect(RESERVED_ENV_KEYS.has('CLAUDE_CODE_SUBAGENT_MODEL')).toBe(true)
  })

  it('covers auth and base url keys', () => {
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_API_KEY')).toBe(true)
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_AUTH_TOKEN')).toBe(true)
    expect(RESERVED_ENV_KEYS.has('ANTHROPIC_BASE_URL')).toBe(true)
  })

  it('does not include unrelated keys', () => {
    expect(RESERVED_ENV_KEYS.has('API_TIMEOUT_MS')).toBe(false)
    expect(RESERVED_ENV_KEYS.has('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')).toBe(false)
  })
})
