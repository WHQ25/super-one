import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { closeCompatSession, getCompatSession, setCompatSession, type CompatSession } from '../mcp-apps/compat-registry'

const { createCore, prewarmCore, prepare, configs } = vi.hoisted(() => ({
  createCore: vi.fn(), prewarmCore: vi.fn(), prepare: vi.fn(), configs: [] as McpServerConfig[],
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cursor-test' } }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../logger', () => ({ default: { debug: vi.fn() } }))
vi.mock('./cursor-auth', () => ({ resolveCursorApiKey: () => 'test' }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => configs }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpHttpConfig: () => ({ url: 'http://localhost/mcp' }) }))
vi.mock('../mcp-apps/compat-session', () => ({ prepareCompatSession: prepare }))
vi.mock('@superone/cursor', async importOriginal => ({
  ...await importOriginal<typeof import('@superone/cursor')>(),
  createCursorRuntime: createCore, prewarmCursorLocalWorkspace: prewarmCore,
}))

import { createCursorRuntime, prewarmCursorWorkspace, type CursorRuntimeOptions } from './cursor-runtime'

const opts: CursorRuntimeOptions = {
  sessionId: 's', cwd: '/tmp/project', config: { mcpAppsCompatEnabled: true }, permissionMode: 'agent', onEvent: () => undefined,
}
function compat(): CompatSession {
  return { omittedServers: new Set(['fixture']), close: vi.fn(async () => undefined) } as unknown as CompatSession
}

describe('desktop Cursor compatibility opt-in and sandbox boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configs.push({ name: 'fixture', type: 'stdio', scope: 'project', command: 'node', args: ['fixture.ts'] })
    createCore.mockResolvedValue({ close: async () => undefined })
    prewarmCore.mockResolvedValue(undefined)
    prepare.mockImplementation(async (id: string) => {
      const session = compat()
      setCompatSession(id, session)
      return session
    })
  })
  afterEach(async () => { configs.length = 0; await closeCompatSession('s') })

  it.each([
    ['create', createCursorRuntime, createCore], ['prewarm', prewarmCursorWorkspace, prewarmCore],
  ] as const)('%s defaults to fully native routing without discovery', async (_name, run, core) => {
    await run({ ...opts, config: {} })
    expect(prepare).not.toHaveBeenCalled()
    expect(getCompatSession('s')).toBeUndefined()
    expect(core.mock.calls[0][0].buildMcpServers(opts.cwd, 's')).toHaveProperty('fixture')
  })

  it('closes an existing compat client and restores native routing when the opt-in flips off', async () => {
    await createCursorRuntime(opts)
    const previous = getCompatSession('s')!
    prepare.mockClear()
    await createCursorRuntime({ ...opts, config: { mcpAppsCompatEnabled: false } })
    expect(prepare).not.toHaveBeenCalled()
    expect(previous.close).toHaveBeenCalledOnce()
    expect(getCompatSession('s')).toBeUndefined()
    expect(createCore.mock.calls[1][0].buildMcpServers(opts.cwd, 's')).toHaveProperty('fixture')
  })

  it.each([
    ['create', createCursorRuntime, createCore], ['prewarm', prewarmCursorWorkspace, prewarmCore],
  ] as const)('%s skips discovery and restores native servers when sandbox is requested', async (_name, run, core) => {
    const previous = compat()
    setCompatSession('s', previous)
    await run({ ...opts, sandboxEnabled: true })
    expect(prepare).not.toHaveBeenCalled()
    expect(previous.close).toHaveBeenCalledOnce()
    expect(getCompatSession('s')).toBeUndefined()
    const injected = core.mock.calls[0][0]
    expect(injected.buildMcpServers(opts.cwd, 's')).toHaveProperty('fixture')
    expect(injected.sandboxEnabled).toBe(true)
  })

  it('honors config sandbox when the session does not override it', async () => {
    await createCursorRuntime({ ...opts, config: { mcpAppsCompatEnabled: true, sandboxEnabled: true } })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('matches SDK precedence when the session explicitly disables config sandbox', async () => {
    await createCursorRuntime({ ...opts, config: { mcpAppsCompatEnabled: true, sandboxEnabled: true }, sandboxEnabled: false })
    expect(prepare).toHaveBeenCalledWith('s', opts.cwd)
    const injected = createCore.mock.calls[0][0]
    expect(injected.buildMcpServers(opts.cwd, 's')).not.toHaveProperty('fixture')
  })
})
