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
    api_key: '',
    category: 'custom',
    supported_agents: '["claude"]',
    agent_configs: '{}',
    is_active_claude: 0,
    is_active_codex: 0,
    sort_order: 0,
    notes: '',
    created_at: '',
    updated_at: '',
    base_url: '',
    extra_env: '{}',
    is_active: 0,
    agent_type: 'claude',
    api_format: 'anthropic',
    ...overrides,
  }
}

function makeClaudeConfig(base_url: string, extra_env: string, model_env: string = '{}'): string {
  return JSON.stringify({ claude: { base_url, extra_env, model_env, api_format: 'anthropic' } })
}

describe('buildProviderEnv', () => {
  it('sets ANTHROPIC_API_KEY from provider api_key', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-test-123',
      agent_configs: makeClaudeConfig('', '{}'),
    }))
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-123')
  })

  it('sets ANTHROPIC_BASE_URL from agent_configs base_url', () => {
    const env = buildProviderEnv(makeProvider({
      agent_configs: makeClaudeConfig('https://example.com/api', '{}'),
    }))
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com/api')
  })

  it('does not set ANTHROPIC_BASE_URL when empty', () => {
    const env = buildProviderEnv(makeProvider({
      agent_configs: makeClaudeConfig('', '{}'),
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
  })

  it('injects ANTHROPIC_AUTH_TOKEN when extra_env contains the key', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-glm-key',
      agent_configs: makeClaudeConfig(
        'https://open.bigmodel.cn/api/anthropic',
        '{"ANTHROPIC_AUTH_TOKEN":"","API_TIMEOUT_MS":"3000000"}',
      ),
    }))
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-glm-key')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-glm-key')
    expect(env.API_TIMEOUT_MS).toBe('3000000')
  })

  it('does not inject ANTHROPIC_AUTH_TOKEN when extra_env lacks the key', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-kimi-key',
      agent_configs: makeClaudeConfig('', '{"ANTHROPIC_MODEL":"kimi-k2"}'),
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-kimi-key')
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2')
  })

  it('does not set any auth keys when api_key is empty', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: '',
      agent_configs: makeClaudeConfig('', '{"ANTHROPIC_AUTH_TOKEN":""}'),
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
  })

  it('merges all extra_env vars', () => {
    const env = buildProviderEnv(makeProvider({
      agent_configs: makeClaudeConfig('', '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1"}'),
    }))
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.AWS_REGION).toBe('us-east-1')
  })

  it('api_key overrides ANTHROPIC_API_KEY in extra_env', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-real',
      agent_configs: makeClaudeConfig('', '{"ANTHROPIC_API_KEY":"sk-override"}'),
    }))
    expect(env.ANTHROPIC_API_KEY).toBe('sk-real')
  })

  it('handles empty agent_configs gracefully', () => {
    const env = buildProviderEnv(makeProvider({ api_key: 'sk-key', agent_configs: '{}' }))
    expect(env).toEqual({})
  })

  it('handles Bedrock provider (no api_key, no base_url)', () => {
    const env = buildProviderEnv(makeProvider({
      provider_type: 'bedrock',
      api_key: '',
      agent_configs: makeClaudeConfig('', '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1"}'),
    }))
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
  })

  it('uses model_env and merges with extra_env', () => {
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-test',
      agent_configs: makeClaudeConfig(
        'https://example.com',
        '{"API_TIMEOUT_MS":"3000000"}',
        '{"ANTHROPIC_MODEL":"test-model"}',
      ),
    }))
    expect(env.ANTHROPIC_MODEL).toBe('test-model')
    expect(env.API_TIMEOUT_MS).toBe('3000000')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com')
  })

  it('builds env for codex agentType', () => {
    const configs = JSON.stringify({
      claude: { base_url: 'https://claude.example.com', extra_env: '{}', model_env: '{}', api_format: 'anthropic' },
      codex: { base_url: 'https://codex.example.com/v1', extra_env: '{"OPENAI_BASE_URL":"https://codex.example.com/v1"}', model_env: '{}', api_format: 'openai_chat' },
    })
    const env = buildProviderEnv(makeProvider({
      api_key: 'sk-shared',
      agent_configs: configs,
    }), 'codex')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-shared')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://codex.example.com/v1')
    expect(env.OPENAI_BASE_URL).toBe('https://codex.example.com/v1')
  })
})
