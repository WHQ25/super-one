/**
 * Claude in-process MCP path: registerTool handlers receive AbortSignal on
 * `extra.signal` when the tool call is cancelled. Confirm-gated tools must
 * forward that into deps so HostConfirmRegistry dismisses the dialog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  sessionCleanupHandlerMock,
  configApplyHandlerMock,
  automationDeleteHandlerMock,
  automationApplyHandlerMock,
} = vi.hoisted(() => ({
  sessionCleanupHandlerMock: vi.fn(async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ok' }) }],
  })),
  configApplyHandlerMock: vi.fn(async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'applied' }) }],
  })),
  automationDeleteHandlerMock: vi.fn(async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ok' }) }],
  })),
  automationApplyHandlerMock: vi.fn(async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ok' }) }],
  })),
}))

vi.mock('./session-archive-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-archive-tools')>()
  return {
    ...actual,
    sessionCleanupHandler: sessionCleanupHandlerMock,
  }
})

vi.mock('./automation-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./automation-tools')>()
  return {
    ...actual,
    automationDeleteHandler: automationDeleteHandlerMock,
    automationApplyHandler: automationApplyHandlerMock,
  }
})

vi.mock('./media-tools', () => ({
  registerMediaTools: vi.fn(),
  generateImageToolHandler: vi.fn(),
  generateVideoToolHandler: vi.fn(),
  listMediaProvidersHandler: vi.fn(),
  videoStatusToolHandler: vi.fn(),
}))

vi.mock('./manual-tools', () => ({
  manualReadHandler: vi.fn(),
  registerManualTools: vi.fn(),
}))

vi.mock('./config-tools', () => ({
  configApplyHandler: configApplyHandlerMock,
  configReadHandler: vi.fn(),
}))

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../miniapp/miniapp-service', () => ({
  createMiniApp: vi.fn(),
  cacheAppEntry: vi.fn(),
  registerDevMiniApp: vi.fn(),
  installDevPointer: vi.fn(),
}))

vi.mock('../miniapp/miniapp-packager', () => ({
  packApp: vi.fn(),
}))

vi.mock('../miniapp/miniapp-templates', () => ({
  generateSuperoneDts: vi.fn(() => ''),
}))

vi.mock('../db-sessions', () => ({
  renameSession: vi.fn(),
  isSessionUserRenamed: vi.fn(() => false),
}))

import { registerSuperoneTools } from './superone-mcp-builtins'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

function makeServer() {
  const handlers = new Map<string, (args: unknown, extra?: { signal?: AbortSignal }) => unknown>()
  return {
    handlers,
    server: {
      // Older SDK surface used by miniapp_dev_* registrations
      tool: vi.fn(),
      registerTool: (
        name: string,
        _opts: unknown,
        handler: (args: unknown, extra?: { signal?: AbortSignal }) => unknown,
      ) => {
        handlers.set(name, handler)
        return { remove: vi.fn() }
      },
    },
  }
}

function makeDeps(): BuiltInSuperoneToolDeps {
  return {
    sessionId: 'claude-session',
    sessionHost: null,
    notifyDevAppReady: vi.fn(),
    applyAppSettings: vi.fn(),
  }
}

describe('confirm-gated tools Claude MCP extra.signal forwarding', () => {
  beforeEach(() => {
    sessionCleanupHandlerMock.mockClear()
    configApplyHandlerMock.mockClear()
    automationDeleteHandlerMock.mockClear()
    automationApplyHandlerMock.mockClear()
  })

  it('forwards registerTool extra.signal into session_cleanup deps', async () => {
    const { server, handlers } = makeServer()
    const deps = makeDeps()
    registerSuperoneTools(server as never, deps)

    const handler = handlers.get('session_cleanup')
    expect(handler, 'session_cleanup must be registered on the Claude MCP server').toBeTruthy()

    const controller = new AbortController()
    await handler!(
      { action: 'hide', sessionIds: ['sess-1'] },
      { signal: controller.signal },
    )

    expect(sessionCleanupHandlerMock).toHaveBeenCalledTimes(1)
    const [, calledDeps] = sessionCleanupHandlerMock.mock.calls[0]!
    expect(calledDeps).toMatchObject({
      sessionId: 'claude-session',
      signal: controller.signal,
    })
  })

  it('keeps static deps.signal when extra.signal is omitted', async () => {
    const { server, handlers } = makeServer()
    const staticSignal = new AbortController().signal
    const deps = { ...makeDeps(), signal: staticSignal }
    registerSuperoneTools(server as never, deps)

    await handlers.get('session_cleanup')!(
      { action: 'hide', sessionIds: ['sess-1'] },
      {},
    )

    const [, calledDeps] = sessionCleanupHandlerMock.mock.calls[0]!
    expect(calledDeps.signal).toBe(staticSignal)
  })

  it('forwards registerTool extra.signal into config_apply deps', async () => {
    const { server, handlers } = makeServer()
    const deps = makeDeps()
    registerSuperoneTools(server as never, deps)

    const handler = handlers.get('config_apply')
    expect(handler, 'config_apply must be registered on the Claude MCP server').toBeTruthy()

    const controller = new AbortController()
    await handler!(
      { changes: [{ key: 'theme', value: 'dark' }] },
      { signal: controller.signal },
    )

    expect(configApplyHandlerMock).toHaveBeenCalledTimes(1)
    const [, calledDeps] = configApplyHandlerMock.mock.calls[0]!
    expect(calledDeps).toMatchObject({
      sessionId: 'claude-session',
      signal: controller.signal,
    })
  })

  it('forwards registerTool extra.signal into automation_delete deps', async () => {
    const { server, handlers } = makeServer()
    const deps = makeDeps()
    registerSuperoneTools(server as never, deps)

    const handler = handlers.get('automation_delete')
    expect(handler, 'automation_delete must be registered on the Claude MCP server').toBeTruthy()

    const controller = new AbortController()
    await handler!(
      { ids: ['auto-1'] },
      { signal: controller.signal },
    )

    expect(automationDeleteHandlerMock).toHaveBeenCalledTimes(1)
    const [, calledDeps] = automationDeleteHandlerMock.mock.calls[0]!
    expect(calledDeps).toMatchObject({
      sessionId: 'claude-session',
      signal: controller.signal,
    })
  })

  it('forwards registerTool extra.signal into automation_apply deps', async () => {
    const { server, handlers } = makeServer()
    const deps = makeDeps()
    registerSuperoneTools(server as never, deps)

    const handler = handlers.get('automation_apply')
    expect(handler, 'automation_apply must be registered on the Claude MCP server').toBeTruthy()

    const controller = new AbortController()
    await handler!(
      { action: 'create', name: 'X', prompt: 'Y', schedule: { type: 'recurring', cron: '0 9 * * *' } },
      { signal: controller.signal },
    )

    expect(automationApplyHandlerMock).toHaveBeenCalledTimes(1)
    const [, calledDeps] = automationApplyHandlerMock.mock.calls[0]!
    expect(calledDeps).toMatchObject({
      sessionId: 'claude-session',
      signal: controller.signal,
    })
  })
})
