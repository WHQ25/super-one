import { describe, expect, it, vi } from 'vitest'
import type { ApiProvider } from '../../shared/agent-types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../database', () => ({ getActiveProviderRaw: vi.fn() }))
vi.mock('./claude-permissions', () => ({}))
vi.mock('./message-bridge', () => ({}))
vi.mock('./claude-query', () => ({}))
vi.mock('./discover-resources', () => ({}))

import { buildProviderEnv } from './claude-agent'

function makeProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'test-id',
    name: 'Test',
    provider_type: 'custom',
    base_url: '',
    api_key: '',
    is_active: 1,
    sort_order: 0,
    extra_env: '{}',
    notes: '',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('buildProviderEnv', () => {
  it('sets ANTHROPIC_API_KEY from provider api_key', () => {
    const env = buildProviderEnv(makeProvider({ api_key: 'sk-test-123' }))
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-123')
  })

  it('sets ANTHROPIC_BASE_URL from provider base_url', () => {
    const env = buildProviderEnv(makeProvider({ base_url: 'https://example.com/api' }))
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com/api')
  })

  it('does not set ANTHROPIC_BASE_URL when empty', () => {
    const env = buildProviderEnv(makeProvider({ base_url: '' }))
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
  })

  it('injects ANTHROPIC_AUTH_TOKEN when extra_env contains the key', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-glm-key',
      extra_env: '{"ANTHROPIC_AUTH_TOKEN":"","API_TIMEOUT_MS":"3000000"}',
    }))
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-glm-key')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-glm-key')
    expect(env.API_TIMEOUT_MS).toBe('3000000')
  })

  it('does not inject ANTHROPIC_AUTH_TOKEN when extra_env lacks the key', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-kimi-key',
      extra_env: '{"ANTHROPIC_MODEL":"kimi-k2"}',
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-kimi-key')
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2')
  })

  it('does not set any auth keys when api_key is empty', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: '',
      extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
  })

  it('merges all extra_env vars', () => {
    const env = buildProviderEnv(makeProvider({
      extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1"}',
    }))
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.AWS_REGION).toBe('us-east-1')
  })

  it('api_key overrides ANTHROPIC_API_KEY in extra_env', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-real',
      extra_env: '{"ANTHROPIC_API_KEY":"sk-override"}',
    }))
    expect(env.ANTHROPIC_API_KEY).toBe('sk-real')
  })

  it('handles empty extra_env gracefully', () => {
    const env = buildProviderEnv(makeProvider({ api_key: 'sk-key', extra_env: '' }))
    expect(env.ANTHROPIC_API_KEY).toBe('sk-key')
  })

  it('handles Bedrock provider (no api_key, no base_url)', () => {
    const env = buildProviderEnv(makeProvider({
      provider_type: 'bedrock',
      api_key: '',
      base_url: '',
      extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1"}',
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
  })
})
