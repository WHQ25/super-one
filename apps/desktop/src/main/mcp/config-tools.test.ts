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
import { configApplyHandler, configReadGuideHandler, resolveConfigConfirm } from './config-tools'
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

  it('creates a custom platform with no active project', async () => {
    const { getMock } = createMockDb()
    const definition = { id: 'custom:my-provider', brand: 'my-provider', name: 'My Provider', plans: [] }
    getMock.mockReturnValue({ id: definition.id, definition_json: JSON.stringify(definition) })

    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const handlerPromise = configApplyHandler(
      { resource: { resource: 'custom-platform', operation: 'create', values: definition } },
      deps,
    )

    const requestId = capturedRequestId(emitHostEvent)
    resolveConfigConfirm(requestId, 'accept', { [CONFIG_APPLY_FIELD]: JSON.stringify(definition) })

    const result = parseResult(await handlerPromise)
    expect(result.status).toBe('applied')
    expect((result.record as Record<string, unknown>).id).toBe('custom:my-provider')
  })

  it('rejects a custom-platform id that does not start with "custom:" after the user confirms', async () => {
    const emitHostEvent = vi.fn()
    const deps = makeDepsNoProject(emitHostEvent)

    const handlerPromise = configApplyHandler(
      { resource: { resource: 'custom-platform', operation: 'create', values: { id: 'zhipu-cn', brand: 'b', name: 'n', plans: [] } } },
      deps,
    )

    const requestId = capturedRequestId(emitHostEvent)
    resolveConfigConfirm(requestId, 'accept', {
      [CONFIG_APPLY_FIELD]: JSON.stringify({ id: 'zhipu-cn', brand: 'b', name: 'n', plans: [] }),
    })

    const result = parseResult(await handlerPromise)
    expect(result.status).toBe('error')
    expect(String(result.message)).toContain('custom:')
  })

  it('lists the ai-provider resource via config_read_guide with no active project', () => {
    const { allMock } = createMockDb()
    allMock.mockReturnValue([])
    const deps = makeDepsNoProject(vi.fn())

    const result = parseResult(configReadGuideHandler({ domain: 'ai-provider' }, deps))
    expect(result.resource).toBe('ai-provider')
    expect(result.records).toEqual([])
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
