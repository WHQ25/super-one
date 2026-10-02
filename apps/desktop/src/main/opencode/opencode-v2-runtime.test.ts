import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeRuntimeOptions } from './opencode-runtime'
import type { OpenCodeServerHandle } from './opencode-client'
import type { OpenCodeV2Event, OpenCodeV2PermissionRule } from './opencode-v2-types'

const mocks = vi.hoisted(() => ({
  switchAgent: vi.fn(async () => undefined),
  switchModel: vi.fn(async () => undefined),
  prompt: vi.fn(async () => undefined),
  session: { id: 'ses_1', agent: undefined as string | undefined, permissions: [] as OpenCodeV2PermissionRule[], location: { directory: '/project' } },
  createSession: vi.fn(),
  updateSession: vi.fn(async () => undefined),
  pendingForms: [] as unknown[],
  liveEvents: [] as OpenCodeV2Event[],
  streamSignal: null as AbortSignal | null,
  permissions: vi.fn(async () => [] as unknown[]),
}))

vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpHttpConfig: () => null,
  getSuperoneMcpStdioConfig: () => null,
}))
vi.mock('./opencode-v2-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./opencode-v2-client')>()),
  OpenCodeV2Client: class {
    resources = async () => ({ models: [], agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }], commands: [] })
    createSession = mocks.createSession
    getSession = async () => mocks.session
    updateSession = mocks.updateSession
    putInstruction = async () => undefined
    permissions = mocks.permissions
    forms = async () => mocks.pendingForms
    switchAgent = mocks.switchAgent
    switchModel = mocks.switchModel
    prompt = mocks.prompt
    eventStream = async (signal: AbortSignal) => {
      mocks.streamSignal = signal
      return (async function* () {
        for (const event of mocks.liveEvents) yield event
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      })()
    }
  },
}))

import { createOpenCodeV2Runtime } from './opencode-v2-runtime'

const server: OpenCodeServerHandle = { url: 'http://h', protocol: 'v2', exited: null, close: async () => undefined }

function options(overrides: Partial<OpenCodeRuntimeOptions> = {}): OpenCodeRuntimeOptions {
  return { sessionId: 'superone', cwd: '/project', config: {}, permissionMode: 'default', onEvent: vi.fn(), ...overrides }
}

const form = { id: 'frm_1', sessionID: 'ses_1', title: 'Q', fields: [{ key: 'q0', type: 'string' as const }] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.agent = undefined
  mocks.session.permissions = []
  mocks.createSession.mockResolvedValue(mocks.session)
  mocks.pendingForms = []
  mocks.liveEvents = []
  mocks.streamSignal = null
  mocks.permissions.mockImplementation(async () => [])
})

describe('createOpenCodeV2Runtime', () => {
  it('keeps the native session agent and switches Build / Plan / custom agents independently', async () => {
    mocks.session.agent = 'reviewer'
    const runtime = await createOpenCodeV2Runtime(server, options({ providerSessionId: 'ses_1' }))

    await runtime.prompt('wake')
    expect(mocks.switchAgent).not.toHaveBeenCalled()

    await runtime.prompt('plan it', undefined, undefined, undefined, 'plan')
    expect(mocks.switchAgent).toHaveBeenLastCalledWith('ses_1', 'plan')

    await runtime.prompt('do it')
    expect(mocks.switchAgent).toHaveBeenCalledTimes(1)
    await runtime.prompt('again', undefined, undefined, undefined, 'build')
    expect(mocks.switchAgent).toHaveBeenLastCalledWith('ses_1', 'build')
    expect(mocks.switchAgent).toHaveBeenCalledTimes(2)
    expect(mocks.updateSession).toHaveBeenCalledTimes(1)
    await runtime.close()
  })

  it('inherits native permissions without the old blanket modes', async () => {
    mocks.session.permissions = [{ action: 'shell', resource: 'git push *', effect: 'deny' }]
    const runtime = await createOpenCodeV2Runtime(server, options({ providerSessionId: 'ses_1', permissionMode: 'bypassPermissions' }))
    expect(mocks.updateSession).toHaveBeenCalledWith('ses_1', { permissions: expect.arrayContaining(mocks.session.permissions) })
    const rules = (mocks.updateSession.mock.calls[0] as unknown as [string, { permissions: OpenCodeV2PermissionRule[] }])[1].permissions
    expect(rules.some((rule) => rule.action === '*')).toBe(false)
    await runtime.close()
  })

  it('migrates a legacy Plan launch once and lets an explicit agent override it', async () => {
    const runtime = await createOpenCodeV2Runtime(server, options({ permissionMode: 'plan' }))
    await runtime.prompt('legacy plan')
    expect(mocks.switchAgent).toHaveBeenLastCalledWith('ses_1', 'plan')
    await runtime.prompt('implement', undefined, undefined, undefined, 'reviewer')
    await runtime.prompt('continue')
    expect(mocks.switchAgent).toHaveBeenLastCalledWith('ses_1', 'reviewer')
    expect(mocks.switchAgent).toHaveBeenCalledTimes(2)
    await runtime.close()
  })

  it('leaves out of the snapshot an interaction resolved while starting', async () => {
    mocks.pendingForms = [form]
    mocks.liveEvents = [{ id: 'e1', type: 'form.cancelled', data: { sessionID: 'ses_1', id: 'frm_1' } }]
    const onEvent = vi.fn()
    const runtime = await createOpenCodeV2Runtime(server, options({ onEvent }))
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith({ type: 'v2', event: mocks.liveEvents[0] }))

    expect(runtime.snapshotEvents).toEqual([])
    await runtime.close()
  })

  it('closes the event subscription when startup is aborted after subscribing', async () => {
    const controller = new AbortController()
    mocks.permissions.mockImplementation(() => new Promise(() => undefined))
    const created = createOpenCodeV2Runtime(server, options({ signal: controller.signal }))
    await vi.waitFor(() => expect(mocks.streamSignal).not.toBeNull())
    controller.abort()

    await expect(created).rejects.toThrow(/aborted/)
    expect(mocks.streamSignal?.aborted).toBe(true)
  })
})
