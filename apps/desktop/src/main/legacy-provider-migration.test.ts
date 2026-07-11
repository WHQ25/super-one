import { describe, expect, it, vi } from 'vitest'
import { buildLegacyProviderMigration, type LegacyApiProviderRow } from './database-migrations'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

function row(overrides: Partial<LegacyApiProviderRow>): LegacyApiProviderRow {
  return {
    id: 'prov-1',
    name: 'My Provider',
    api_key: 'sk-legacy',
    notes: '',
    sort_order: 0,
    supported_agents: '["claude"]',
    agent_configs: '{}',
    is_active_claude: 0,
    is_active_codex: 0,
    agent_type: 'claude',
    base_url: '',
    api_format: 'anthropic',
    extra_env: '{}',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildLegacyProviderMigration', () => {
  it('maps a claude preset provider to a custom platform with an anthropic-messages endpoint carrying model mapping + env', () => {
    const result = buildLegacyProviderMigration(
      row({
        name: 'GLM (CN)',
        supported_agents: '["claude"]',
        is_active_claude: 1,
        agent_configs: JSON.stringify({
          claude: {
            base_url: 'https://open.bigmodel.cn/api/anthropic',
            api_format: 'anthropic',
            model_env: { default: { id: 'glm-5.2[1m]', name: 'GLM-5.2 (1M)' }, haiku: { id: 'glm-4.5-air' } },
            extra_env: '{"API_TIMEOUT_MS":"3000000"}',
          },
        }),
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.platform.id).toBe('custom:prov-1')
    expect(result!.platform.brand).toBe('custom')
    const plan = result!.platform.plans[0]
    expect(plan.id).toBe('api')
    expect(plan.endpoints).toHaveLength(1)
    const endpoint = plan.endpoints[0]
    expect(endpoint).toMatchObject({ id: 'messages', protocols: ['anthropic-messages'], baseUrl: 'https://open.bigmodel.cn/api/anthropic' })
    expect(endpoint.defaults?.modelMapping?.default).toEqual({ id: 'glm-5.2[1m]', name: 'GLM-5.2 (1M)' })
    expect(endpoint.defaults?.extraEnv).toEqual({ API_TIMEOUT_MS: '3000000' })
    expect(result!.bindings).toEqual([{ consumer: 'chat:claude', endpointId: 'messages' }])
  })

  it('emits one endpoint per supported harness and a binding for each active one', () => {
    const result = buildLegacyProviderMigration(
      row({
        supported_agents: '["claude","codex"]',
        is_active_claude: 1,
        is_active_codex: 1,
        agent_configs: JSON.stringify({
          claude: { base_url: 'https://relay/anthropic', api_format: 'anthropic', model_env: {}, extra_env: '{}' },
          codex: { base_url: 'https://relay/v1', api_format: 'openai_chat', model_env: {}, extra_env: '{"OPENAI_BASE_URL":"https://relay/v1"}' },
        }),
      }),
    )

    const endpoints = result!.platform.plans[0].endpoints
    expect(endpoints.map((e) => [e.id, e.protocols])).toEqual([
      ['messages', ['anthropic-messages']],
      ['chat', ['openai-chat']],
    ])
    expect(result!.bindings).toEqual([
      { consumer: 'chat:claude', endpointId: 'messages' },
      { consumer: 'chat:codex', endpointId: 'chat' },
    ])
  })

  it('does not emit a binding for a supported-but-inactive harness', () => {
    const result = buildLegacyProviderMigration(
      row({ supported_agents: '["claude"]', is_active_claude: 0, agent_configs: JSON.stringify({ claude: { base_url: 'https://x', api_format: 'anthropic' } }) }),
    )
    expect(result!.bindings).toEqual([])
  })

  it('falls back to legacy top-level columns when agent_configs is empty', () => {
    const result = buildLegacyProviderMigration(
      row({ supported_agents: '[]', agent_type: 'claude', base_url: 'https://legacy.example.com', api_format: 'anthropic', extra_env: '{"K":"V"}', is_active_claude: 1 }),
    )
    const endpoint = result!.platform.plans[0].endpoints[0]
    expect(endpoint).toMatchObject({ protocols: ['anthropic-messages'], baseUrl: 'https://legacy.example.com' })
    expect(endpoint.defaults?.extraEnv).toEqual({ K: 'V' })
    expect(result!.bindings).toEqual([{ consumer: 'chat:claude', endpointId: 'messages' }])
  })

  it('returns null when the supported agent has no matching config and no fallback columns apply', () => {
    const result = buildLegacyProviderMigration(
      row({ supported_agents: '["codex"]', agent_configs: JSON.stringify({ claude: { base_url: 'https://x', api_format: 'anthropic' } }) }),
    )
    expect(result).toBeNull()
  })

  it('reads a model_env stored as a nested object (not a JSON string)', () => {
    const result = buildLegacyProviderMigration(
      row({
        is_active_claude: 1,
        agent_configs: JSON.stringify({
          claude: { base_url: 'https://x', api_format: 'anthropic', model_env: { default: { id: 'm1' } }, extra_env: {} },
        }),
      }),
    )
    expect(result!.platform.plans[0].endpoints[0].defaults?.modelMapping?.default).toEqual({ id: 'm1' })
  })
})
