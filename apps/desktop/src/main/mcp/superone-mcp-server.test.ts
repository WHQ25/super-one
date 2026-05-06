import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRemove, mockRegisterTool, mockBuiltInTool, mockSendToolListChanged, mockIsConnected } = vi.hoisted(() => {
  const mockRemove = vi.fn()
  const mockRegisterTool = vi.fn((_name: string, _opts: unknown, handler: Function) => {
    const entry = { remove: mockRemove, handler }
    return entry
  })
  const mockBuiltInTool = vi.fn()
  const mockSendToolListChanged = vi.fn()
  const mockIsConnected = vi.fn(() => true)
  return { mockRemove, mockRegisterTool, mockBuiltInTool, mockSendToolListChanged, mockIsConnected }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({}))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function(this: Record<string, unknown>) {
    this.tool = mockBuiltInTool
    this.registerTool = mockRegisterTool
    this.sendToolListChanged = mockSendToolListChanged
    this.isConnected = mockIsConnected
  }),
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const { mockCreateMiniApp, mockCacheAppEntry } = vi.hoisted(() => ({
  mockCreateMiniApp: vi.fn(),
  mockCacheAppEntry: vi.fn(),
}))
vi.mock('../miniapp/miniapp-service', () => ({
  createMiniApp: mockCreateMiniApp,
  cacheAppEntry: mockCacheAppEntry,
}))
vi.mock('../miniapp/miniapp-packager', () => ({
  packApp: vi.fn(),
  getPreapprovedByPath: vi.fn(() => []),
}))
vi.mock('./guides/overview.md?raw', () => ({ default: 'overview' }))
vi.mock('./guides/standard.md?raw', () => ({ default: 'standard' }))
vi.mock('./guides/inchat.md?raw', () => ({ default: 'inchat' }))
vi.mock('./guides/permissions.md?raw', () => ({ default: 'permissions' }))
vi.mock('./guides/api/fs.md?raw', () => ({ default: 'fs' }))
vi.mock('./guides/api/git.md?raw', () => ({ default: 'git' }))
vi.mock('./guides/api/db.md?raw', () => ({ default: 'db' }))
vi.mock('./guides/api/theme.md?raw', () => ({ default: 'theme' }))
vi.mock('./guides/api/agent.md?raw', () => ({ default: 'agent' }))
vi.mock('./guides/packaging.md?raw', () => ({ default: 'packaging' }))
vi.mock('./guides/icon.md?raw', () => ({ default: 'icon' }))

import {
  getSuperoneMcpServer,
  registerAppTools,
  unregisterAppTools,
  isToolPreapproved,
  notifyAppReady,
  resolveToolCall,
  rejectToolCall,
  initSuperoneMcpServer,
  registerAppTemplates,
  unregisterAppTemplates,
  submitToolIntercept,
  cancelToolIntercept,
} from './superone-mcp-server'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'

function makeTools(...names: string[]): MiniAppToolDefinition[] {
  return names.map((n) => ({
    name: n,
    description: `Tool ${n}`,
    inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
  }))
}

function getLastHandler(toolName: string): Function {
  const call = mockRegisterTool.mock.calls.find((c) => c[0] === toolName)
  if (!call) throw new Error(`Tool ${toolName} not registered`)
  return call[2]
}

beforeEach(() => {
  vi.clearAllMocks()
  unregisterAppTools('test-app')
  unregisterAppTools('other-app')
  getSuperoneMcpServer()
})

describe('registerAppTools / unregisterAppTools', () => {
  it('registers tools on active server', () => {
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))

    expect(mockRegisterTool).toHaveBeenCalledWith(
      'myapp__do_thing',
      expect.objectContaining({ description: 'Tool do_thing' }),
      expect.any(Function),
    )
    expect(mockSendToolListChanged).toHaveBeenCalled()
  })

  it('unregisters tools and calls sendToolListChanged', () => {
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    mockRemove.mockClear()
    mockSendToolListChanged.mockClear()

    unregisterAppTools('test-app')

    expect(mockRemove).toHaveBeenCalled()
    expect(mockSendToolListChanged).toHaveBeenCalled()
  })

  it('skips duplicate tool registration', () => {
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    const countAfterFirst = mockRegisterTool.mock.calls.filter((c) => c[0] === 'myapp__do_thing').length

    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    const countAfterSecond = mockRegisterTool.mock.calls.filter((c) => c[0] === 'myapp__do_thing').length

    expect(countAfterSecond).toBe(countAfterFirst)
  })

  it('caches tools when no active server', () => {
    unregisterAppTools('test-app')

    registerAppTools('test-app', 'myapp', makeTools('cached_tool'))

    getSuperoneMcpServer()

    expect(mockRegisterTool).toHaveBeenCalledWith(
      'myapp__cached_tool',
      expect.anything(),
      expect.any(Function),
    )
  })
})

describe('tool handler rejects closed app', () => {
  it('returns error when app has been unregistered', async () => {
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    const handler = getLastHandler('myapp__do_thing')

    unregisterAppTools('test-app')

    const result = await handler({ x: 'hello' })
    expect(result.content[0].text).toContain('has been closed')
  })

  it('works again after re-registering', async () => {
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    unregisterAppTools('test-app')

    getSuperoneMcpServer()
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    notifyAppReady('test-app')
    const handler = getLastHandler('myapp__do_thing')

    const result = await handler({ x: 'hello' }).catch((e: Error) => e)
    if (result?.content) {
      expect(result.content[0].text).not.toContain('has been closed')
    } else {
      expect(result).toBeInstanceOf(Error)
      expect(result.message).not.toContain('has been closed')
    }
  })
})

describe('isToolPreapproved', () => {
  it('returns false for non-superone tools', () => {
    expect(isToolPreapproved('some_random_tool')).toBe(false)
  })

  it('returns false when tool is not preapproved', () => {
    registerAppTools('test-app', 'myapp', makeTools('do_thing'))
    expect(isToolPreapproved('mcp__superone__myapp__do_thing')).toBe(false)
  })
})

describe('resolveToolCall / rejectToolCall', () => {
  it('resolveToolCall is no-op for unknown callId', () => {
    expect(() => resolveToolCall('unknown-id', 'result')).not.toThrow()
  })

  it('rejectToolCall is no-op for unknown callId', () => {
    expect(() => rejectToolCall('unknown-id', 'error')).not.toThrow()
  })
})

describe('executeAppTool with renderer.intercept', () => {
  const sentMessages: Array<{ channel: string; args: unknown[] }> = []
  const mockWebContents = { send: (channel: string, ...args: unknown[]) => sentMessages.push({ channel, args }) }
  const mockWin = { webContents: mockWebContents, isDestroyed: () => false } as unknown as import('electron').BrowserWindow

  function makeInterceptTool(name: string, opts: Partial<{ template: string; onCancel: 'reject' | 'resolve-empty'; timeoutMs: number; inputMerge: 'shallow-merge' | 'replace' }> = {}): MiniAppToolDefinition {
    return {
      name,
      description: `Tool ${name}`,
      inputSchema: { type: 'object', properties: { agent_field: { type: 'string' } } },
      renderer: {
        intercept: {
          template: opts.template ?? 'confirm',
          onCancel: opts.onCancel ?? 'reject',
          inputMerge: opts.inputMerge ?? 'shallow-merge',
          timeoutMs: opts.timeoutMs,
        },
      },
    }
  }

  beforeEach(() => {
    sentMessages.length = 0
    initSuperoneMcpServer(() => mockWin)
    registerAppTools('test-app', 'myapp', [makeInterceptTool('confirm_action')])
    registerAppTemplates('test-app', { confirm: 'popovers/confirm.html' })
    notifyAppReady('test-app')
  })

  it('submit path: merges agent + user input and dispatches MINIAPP_TOOL_CALL', async () => {
    const handler = getLastHandler('myapp__confirm_action')
    const pending = handler({ agent_field: 'from_agent' })

    await new Promise((r) => setTimeout(r, 10))

    const openMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)
    expect(openMsg).toBeTruthy()
    const openReq = openMsg!.args[0] as { callId: string; agentInput: Record<string, unknown>; templatePath: string }
    expect(openReq.agentInput).toEqual({ agent_field: 'from_agent' })
    expect(openReq.templatePath).toBe('popovers/confirm.html')

    submitToolIntercept(openReq.callId, { user_field: 'from_user' })

    await new Promise((r) => setTimeout(r, 10))

    const callMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
    expect(callMsg).toBeTruthy()
    const callReq = callMsg!.args[0] as { arguments: Record<string, unknown> }
    expect(callReq.arguments).toEqual({ agent_field: 'from_agent', user_field: 'from_user' })

    const resolveId = (callMsg!.args[0] as { callId: string }).callId
    resolveToolCall(resolveId, { ok: true })
    const result = await pending
    expect(result.content[0].text).toContain('"ok":true')
  })

  it('cancel with default onCancel=reject: tool handler reports error', async () => {
    const handler = getLastHandler('myapp__confirm_action')
    const pending = handler({ agent_field: 'x' })
    await new Promise((r) => setTimeout(r, 10))
    const openReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as { callId: string }
    cancelToolIntercept(openReq.callId, 'user_cancelled')

    const result = await pending
    expect(result.content[0].text).toContain('[Error]')
    expect(result.content[0].text).toContain('user_cancelled')
  })

  it('cancel with onCancel=resolve-empty: tool returns cancelled payload', async () => {
    unregisterAppTools('test-app')
    registerAppTools('test-app', 'myapp', [makeInterceptTool('confirm_action', { onCancel: 'resolve-empty' })])
    registerAppTemplates('test-app', { confirm: 'popovers/confirm.html' })
    notifyAppReady('test-app')

    const handler = getLastHandler('myapp__confirm_action')
    const pending = handler({ agent_field: 'x' })
    await new Promise((r) => setTimeout(r, 10))
    const openReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as { callId: string }
    cancelToolIntercept(openReq.callId, 'user_cancelled')

    const result = await pending
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toMatchObject({ cancelled: true })
    expect(parsed.reason).toContain('user_cancelled')
  })

  it('inputMerge=replace: user input overrides agent input entirely', async () => {
    unregisterAppTools('test-app')
    registerAppTools('test-app', 'myapp', [makeInterceptTool('confirm_action', { inputMerge: 'replace' })])
    registerAppTemplates('test-app', { confirm: 'popovers/confirm.html' })
    notifyAppReady('test-app')

    const handler = getLastHandler('myapp__confirm_action')
    const pending = handler({ agent_field: 'from_agent' })
    await new Promise((r) => setTimeout(r, 10))
    const openReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as { callId: string }
    submitToolIntercept(openReq.callId, { only_user: 'yes' })

    await new Promise((r) => setTimeout(r, 10))
    const callMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)!
    const callReq = callMsg.args[0] as { arguments: Record<string, unknown>; callId: string }
    expect(callReq.arguments).toEqual({ only_user: 'yes' })

    resolveToolCall(callReq.callId, { ok: true })
    await pending
  })

  it('missing template: handler errors out immediately', async () => {
    unregisterAppTemplates('test-app')
    const handler = getLastHandler('myapp__confirm_action')
    const result = await handler({ agent_field: 'x' })
    expect(result.content[0].text).toContain('[Error]')
    expect(result.content[0].text).toContain('Template "confirm" not found')
  })
})

describe('setup_mini_app_dev tool handler', () => {
  function getBuiltInHandler(toolName: string): Function {
    const call = mockBuiltInTool.mock.calls.find((c) => c[0] === toolName)
    if (!call) throw new Error(`Built-in tool ${toolName} not registered`)
    return call[3] as Function
  }

  const sentMessages: Array<{ channel: string; args: unknown[] }> = []
  const mockWebContents = {
    send: (channel: string, ...args: unknown[]) => sentMessages.push({ channel, args }),
  }
  const mockWin = {
    webContents: mockWebContents,
    isDestroyed: () => false,
  } as unknown as import('electron').BrowserWindow

  beforeEach(() => {
    sentMessages.length = 0
    initSuperoneMcpServer(() => mockWin)
    getSuperoneMcpServer()
  })

  it('returns status=created and notifies dev-app-ready with the new appId', async () => {
    mockCreateMiniApp.mockResolvedValueOnce({
      entry: {
        id: 'weather-1abc',
        manifest: { appId: 'weather-1abc', name: 'Weather', type: 'panel' },
        installDir: '/proj/.superone/apps/weather-1abc',
        distDir: '/proj/packages/weather/dist',
      },
      appPath: '/proj/packages/weather',
      buildRequired: true,
    })
    const handler = getBuiltInHandler('setup_mini_app_dev')

    const result = await handler({
      name: 'Weather',
      slug: 'weather',
      directory: '/proj/packages/weather',
      scope: 'project',
      projectDir: '/proj',
      template: 'react',
    })

    expect(mockCreateMiniApp).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Weather',
      slug: 'weather',
      directory: '/proj/packages/weather',
      scope: 'project',
      projectDir: '/proj',
      template: 'react',
    }))
    expect(mockCacheAppEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'weather-1abc' }))

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toMatchObject({
      status: 'created',
      appId: 'weather-1abc',
      name: 'Weather',
      installDir: '/proj/.superone/apps/weather-1abc',
      template: 'react',
      scope: 'project',
      buildRequired: true,
    })

    const readyMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_DEV_APP_READY)
    expect(readyMsg).toBeTruthy()
    expect(readyMsg!.args).toEqual(['/proj', 'weather-1abc'])
  })

  it('returns status=error (no throw) when createMiniApp throws — UI needs the structured payload', async () => {
    mockCreateMiniApp.mockRejectedValueOnce(new Error('directory must be an absolute path, got: foo'))
    const handler = getBuiltInHandler('setup_mini_app_dev')

    const result = await handler({
      name: 'Bad',
      slug: 'bad',
      directory: 'foo',
      scope: 'project',
      projectDir: '/proj',
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('error')
    expect(payload.message).toContain('absolute path')
    expect(mockCacheAppEntry).not.toHaveBeenCalled()
    expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_DEV_APP_READY)).toBeUndefined()
  })

  it('skips dev-app-ready notify when scope=user (no projectDir)', async () => {
    mockCreateMiniApp.mockResolvedValueOnce({
      entry: {
        id: 'notes-x',
        manifest: { appId: 'notes-x', name: 'Notes' },
        installDir: '/home/.superone/apps/notes-x',
        distDir: '/Users/me/notes',
      },
      appPath: '/Users/me/notes',
      buildRequired: false,
    })
    const handler = getBuiltInHandler('setup_mini_app_dev')

    const result = await handler({
      name: 'Notes',
      slug: 'notes',
      directory: '/Users/me/notes',
      scope: 'user',
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('created')
    expect(payload.scope).toBe('user')
    expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_DEV_APP_READY)).toBeUndefined()
  })

  it('still notifies dev-app-ready for an in-chat scaffold (no separate UI window opens, but list refreshes)', async () => {
    mockCreateMiniApp.mockResolvedValueOnce({
      entry: {
        id: 'card-y',
        manifest: {
          appId: 'card-y',
          name: 'Card',
          type: 'in-chat',
          inChat: { toolName: 'render_card', description: 'Render a card', inputSchema: { type: 'object', properties: {} } },
        },
        installDir: '/proj/.superone/apps/card-y',
        distDir: '/proj/packages/card/dist',
      },
      appPath: '/proj/packages/card',
      buildRequired: true,
    })
    const handler = getBuiltInHandler('setup_mini_app_dev')

    const result = await handler({
      name: 'Card',
      slug: 'card',
      directory: '/proj/packages/card',
      scope: 'project',
      projectDir: '/proj',
      template: 'react',
      type: 'in-chat',
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('created')

    const readyMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_DEV_APP_READY)
    expect(readyMsg).toBeTruthy()
    expect(readyMsg!.args).toEqual(['/proj', 'card-y'])
  })
})
