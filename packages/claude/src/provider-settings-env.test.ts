import { describe, expect, it } from 'vitest'
import { providerSettingsEnv } from './provider-settings-env'

describe('providerSettingsEnv', () => {
  it('returns undefined for no provider overlay so user settings files apply as-is', () => {
    expect(providerSettingsEnv(undefined)).toBeUndefined()
    expect(providerSettingsEnv({})).toBeUndefined()
    expect(providerSettingsEnv({ X: undefined })).toBeUndefined()
  })

  it('mirrors defined keys and blanks a foreign ANTHROPIC_AUTH_TOKEN when an api key is set', () => {
    expect(providerSettingsEnv({
      ANTHROPIC_API_KEY: 'sk-abc',
      ANTHROPIC_BASE_URL: 'https://proxy.example.com',
      CUSTOM_VAR: 'x',
      SKIPPED: undefined,
    })).toEqual({
      ANTHROPIC_API_KEY: 'sk-abc',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://proxy.example.com',
      CUSTOM_VAR: 'x',
    })
  })

  it('keeps a provider-supplied ANTHROPIC_AUTH_TOKEN next to the api key', () => {
    expect(providerSettingsEnv({ ANTHROPIC_API_KEY: 'sk-abc', ANTHROPIC_AUTH_TOKEN: 'tok' }))
      .toEqual({ ANTHROPIC_API_KEY: 'sk-abc', ANTHROPIC_AUTH_TOKEN: 'tok' })
  })

  it('does not touch ANTHROPIC_AUTH_TOKEN when the provider has no api key (first-party OAuth)', () => {
    expect(providerSettingsEnv({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/d' }))
      .toEqual({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/d' })
  })
})
