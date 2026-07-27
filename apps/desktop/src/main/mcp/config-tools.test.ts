import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('../database', () => ({
  getDb: getDbMock,
  maskApiKey: (key: string) => (key.length <= 6 ? '***' : '***' + key.slice(-6)),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

import { CONFIG_APPLY_FIELD, type AgentEvent } from '@superone/shared/agent-types'
import { configApplyHandler, configReadHandler, resolveConfigConfirm } from './config-tools'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

function createMockDb() {
  const runMock = vi.fn().mockReturnValue({ changes: 1 })
  const getMock = vi.fn()
  const allMock = vi.fn().mockReturnValue([])
  const prepareMock = vi.fn().mockReturnValue({ run: runMock, get: getMock, all: allMock })
  getDbMock.mockReturnValue({ prepare: prepareMock })
  return { prepareMock, runMock, getMock, allMock }
}

function makeDepsNoProject(emitHostEvent: (event: AgentEvent) => void): BuiltInSuperoneToolDeps {
  return {
    notifyDevAppReady: vi.fn(),
    sessionId: 'sess-1',
    sessionHost: {
      getSession: () => ({ setTitle: vi.fn(), projectPath: null, emitHostEvent }),
    },
    applyAppSettings: vi.fn(),
  }
}

function parseResult(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>
}

function capturedRequestId(emitHostEvent: ReturnType<typeof vi.fn>): string {
  const event = emitHostEvent.mock.calls[0][0] as { request: { requestId: string } }
  return event.request.requestId
}

describe('config_apply — ai-provider / custom-platform resources (global, not project-scoped)', () => {
  beforeEach(() => {
    getDbMock.mockReset()
  })

  it('creates a credential with no active project and masks the secret in the result', async () => {
    const { runMock, getMock } = createMockDb()
    getMock.mockReturnValue({
      id: 'cred-1',
      platform_id: 'zhipu-cn',
      plan_id: 'default',
      name: 'My Key',
      secret: 'sk-abcdef123456',
      secret_env: '',
      overrides_json: '{}',
      notes: '',
      sort_order: 0,
    })

    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const handlerPromise = configApplyHandler(
      {
        resource: {
          resource: 'ai-provider',
          operation: 'create',
          values: { platformId: 'zhipu-cn', planId: 'default', name: 'My Key', secret: 'sk-abcdef123456' },
        },
      },
      deps,
    )

    expect(emitHostEvent).toHaveBeenCalledTimes(1)
    const requestId = capturedRequestId(emitHostEvent)
    resolveConfigConfirm(requestId, 'accept', {
      [CONFIG_APPLY_FIELD]: JSON.stringify({ platformId: 'zhipu-cn', planId: 'default', name: 'My Key', secret: 'sk-abcdef123456' }),
    })

    const result = parseResult(await handlerPromise)
    expect(result.status).toBe('applied')
    const record = result.record as Record<string, unknown>
    expect(record.secret).toBe('***123456')
    expect(runMock.mock.calls[0]).toContain('sk-abcdef123456')
  })

  it('merges one model-mapping slot into a credential override, leaving the other overrides intact', async () => {
    const { allMock, getMock, runMock } = createMockDb()
    const row = {
      id: 'cred-1',
      platform_id: 'zhipu-cn',
      plan_id: 'coding',
      name: 'My Key',
      secret: 'sk-abcdef123456',
      secret_env: '',
      overrides_json: JSON.stringify({
        anthropic: { extraEnv: { KEEP_ME: '1' }, modelMapping: { opus: { id: 'glm-4.5' } } },
      }),
      notes: '',
      sort_order: 0,
    }
    allMock.mockReturnValue([row])
    getMock.mockReturnValue(row)

    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const handlerPromise = configApplyHandler(
      {
        resource: {
          resource: 'ai-provider',
          operation: 'update',
          recordId: 'cred-1',
          values: { modelMapping: { sonnet: { id: 'glm-4.6' } } },
        },
      },
      deps,
    )

    const event = emitHostEvent.mock.calls[0][0] as {
      request: { requestId: string; configConfirm: { resource: { context: { endpointId?: string }; fields: Array<{ key: string; type: string; currentValue: unknown }> } } }
    }
    // The plan has one endpoint, so the override target is resolved without the agent naming it.
    expect(event.request.configConfirm.resource.context.endpointId).toBe('anthropic')
    expect(event.request.configConfirm.resource.fields[0].type).toBe('model-mapping')
    expect(event.request.configConfirm.resource.fields[0].currentValue).toEqual({ opus: { id: 'glm-4.5' } })

    resolveConfigConfirm(event.request.requestId, 'accept', {
      [CONFIG_APPLY_FIELD]: JSON.stringify({ modelMapping: { sonnet: { id: 'glm-4.6' } } }),
    })

    const result = parseResult(await handlerPromise)
    expect(result.status).toBe('applied')
    const savedOverrides = JSON.parse(runMock.mock.calls.at(-1)![3] as string) as Record<string, Record<string, unknown>>
    expect(savedOverrides.anthropic.modelMapping).toEqual({ opus: { id: 'glm-4.5' }, sonnet: { id: 'glm-4.6' } })
    expect(savedOverrides.anthropic.extraEnv).toEqual({ KEEP_ME: '1' })
  })

  it('derives the endpoints of a new custom platform from a base URL and a capability selection', async () => {
    createMockDb()
    const values = {
      name: 'My Relay',
      baseUrl: 'https://relay.example.com',
      capabilities: { families: ['openai'], tasks: { openai: ['chat', 'image'] } },
    }

    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const handlerPromise = configApplyHandler(
      { resource: { resource: 'custom-platform', operation: 'create', values } },
      deps,
    )

    const requestId = capturedRequestId(emitHostEvent)
    resolveConfigConfirm(requestId, 'accept', { [CONFIG_APPLY_FIELD]: JSON.stringify(values) })

    const result = parseResult(await handlerPromise)
    expect(result.status).toBe('applied')
    const record = result.record as { id: string; plans: Array<{ endpoints: Array<{ baseUrl: string; protocols: string[] }> }> }
    expect(record.id.startsWith('custom:')).toBe(true)
    expect(record.plans[0].endpoints).toHaveLength(1)
    expect(record.plans[0].endpoints[0].baseUrl).toBe('https://relay.example.com/v1')
    expect(record.plans[0].endpoints[0].protocols).toEqual(['openai-chat', 'openai-images'])
  })

  it('merges a single env var into a custom platform without disturbing its other settings', async () => {
    const { allMock, runMock } = createMockDb()
    const existing = {
      id: 'custom:relay',
      brand: 'custom',
      name: 'My Relay',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [
            {
              id: 'openai',
              baseUrl: 'https://relay.example.com/v1',
              protocols: ['openai-chat'],
              defaults: { extraEnv: { KEEP_ME: '1', API_TIMEOUT_MS: '60000' } },
            },
          ],
        },
      ],
    }
    allMock.mockReturnValue([{ id: existing.id, definition_json: JSON.stringify(existing) }])

    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const handlerPromise = configApplyHandler(
      {
        resource: {
          resource: 'custom-platform',
          operation: 'update',
          recordId: 'custom:relay',
          values: { extraEnv: { API_TIMEOUT_MS: '120000' } },
        },
      },
      deps,
    )

    const confirmEvent = emitHostEvent.mock.calls[0][0] as {
      request: { requestId: string; configConfirm: { resource: { fields: Array<{ key: string; type: string; currentValue: unknown; proposedValue: unknown }> } } }
    }
    const field = confirmEvent.request.configConfirm.resource.fields[0]
    expect(field.key).toBe('extraEnv')
    expect(field.type).toBe('env')
    expect(field.currentValue).toEqual({ KEEP_ME: '1', API_TIMEOUT_MS: '60000' })
    expect(field.proposedValue).toEqual({ API_TIMEOUT_MS: '120000' })

    resolveConfigConfirm(confirmEvent.request.requestId, 'accept', {
      [CONFIG_APPLY_FIELD]: JSON.stringify({ extraEnv: { API_TIMEOUT_MS: '120000' } }),
    })

    const result = parseResult(await handlerPromise)
    expect(result.status).toBe('applied')
    const saved = JSON.parse(runMock.mock.calls.at(-1)![1] as string) as typeof existing
    expect(saved.plans[0].endpoints[0].defaults.extraEnv).toEqual({ KEEP_ME: '1', API_TIMEOUT_MS: '120000' })
    expect(saved.plans[0].endpoints[0].baseUrl).toBe('https://relay.example.com/v1')
  })

  it('rejects a field key that is not part of the resource schema', async () => {
    createMockDb()
    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const result = parseResult(
      await configApplyHandler(
        { resource: { resource: 'custom-platform', operation: 'create', values: { name: 'x', plans: [] } } },
        deps,
      ),
    )

    expect(result.status).toBe('error')
    expect(String(result.message)).toContain('plans')
    expect(emitHostEvent).not.toHaveBeenCalled()
  })

  it('lists ai-provider records as an identity index rather than dumping every record', () => {
    const { allMock } = createMockDb()
    allMock.mockReturnValue([])
    const deps = makeDepsNoProject(vi.fn())

    const result = parseResult(configReadHandler({ domain: 'ai-provider' }, deps))
    expect(result.resource).toBe('ai-provider')
    expect(result.records).toEqual([])
    expect(String(result.hint)).toContain('recordId')
  })
})

describe('config_apply — unknown resource', () => {
  it('reports automation as no longer a valid resource domain', async () => {
    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const result = parseResult(
      await configApplyHandler(
        { resource: { resource: 'automation', operation: 'create', values: {} } },
        deps,
      ),
    )

    expect(result.status).toBe('error')
    expect(String(result.message)).toContain('Unknown resource')
    expect(emitHostEvent).not.toHaveBeenCalled()
  })
})
