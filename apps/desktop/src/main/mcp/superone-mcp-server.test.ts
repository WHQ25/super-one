import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({}),
}))
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
vi.mock('./guides/manifest.md?raw', () => ({ default: 'manifest' }))
vi.mock('./guides/permissions.md?raw', () => ({ default: 'permissions' }))
vi.mock('./guides/api/fs.md?raw', () => ({ default: 'fs' }))
vi.mock('./guides/api/git.md?raw', () => ({ default: 'git' }))
vi.mock('./guides/api/db.md?raw', () => ({ default: 'db' }))
vi.mock('./guides/api/theme.md?raw', () => ({ default: 'theme' }))
vi.mock('./guides/api/locale.md?raw', () => ({ default: 'locale' }))
vi.mock('./guides/api/agent.md?raw', () => ({ default: 'agent' }))
vi.mock('./guides/api/system.md?raw', () => ({ default: 'system' }))
vi.mock('./guides/api/ui.md?raw', () => ({ default: 'ui' }))
vi.mock('./guides/api/worker.md?raw', () => ({ default: 'worker' }))
vi.mock('./guides/packaging.md?raw', () => ({ default: 'packaging' }))
vi.mock('./guides/icon.md?raw', () => ({ default: 'icon' }))
vi.mock('./guides/recipes.md?raw', () => ({ default: 'recipes' }))
vi.mock('./guides/tools.md?raw', () => ({ default: 'tools' }))

import {
  createSuperoneMcpServer,
  disposeSuperoneMcpServer,
  registerAppTools,
  unregisterAppTools,
  isToolPreapproved,
  markAppToolPreapproved,
  notifyAppReady,
  resolveToolCall,
  rejectToolCall,
  initSuperoneMcpServer,
  registerAppTemplates,
  unregisterAppTemplates,
  submitToolIntercept,
  cancelToolIntercept,
  setToolSyncCallbacks,
  setSessionHostProvider,
  addToolsChangedListener,
  clearSessionPendingCalls,
  executeAppTool,
} from './superone-mcp-server'
import { resolveMiniappCallConfirm } from './miniapp-call-confirm'
import { executeSuperoneMcpTool, listSuperoneMcpTools } from './superone-mcp-tool-surface'
import { LAUNCH_PERMISSION_MODE_DESCRIPTION } from './superone-mcp-builtin-defs'
import type { ZodArray, ZodObject, ZodOptional, ZodRawShape, ZodTypeAny } from 'zod'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { MiniAppToolDefinition, MiniAppToolCallRequest, MiniAppToolInterceptOpenRequest } from '@superone/shared/miniapp-types'

const PROJ_A = '/proj-a'
const PROJ_B = '/proj-b'

function makeTools(...names: string[]): MiniAppToolDefinition[] {
  return names.map((n) => ({
    name: n,
    description: `Tool ${n}`,
    inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
  }))
}

/** Register app tools and preapprove them so executor permission gate does not block unit tests. */
function registerAppToolsPreapproved(
  sessionId: string,
  projectDir: string,
  appId: string,
  toolSlug: string,
  tools: MiniAppToolDefinition[],
): void {
  registerAppTools(sessionId, projectDir, appId, toolSlug, tools)
  for (const t of tools) markAppToolPreapproved(appId, t.name)
}

function getLastHandler(toolName: string): Function {
  const call = mockRegisterTool.mock.calls.find((c) => c[0] === toolName)
  if (!call) throw new Error(`Tool ${toolName} not registered`)
  return call[2]
}

/** Invoke the fixed miniapp_call tool for an authorized app. */
function callMiniapp(
  appId: string,
  tool: string,
  input: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handler = getLastHandler('miniapp_call')
  return handler({ appId, tool, input })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Clear residual authorizations from any session id used in this file
  for (const sid of [PROJ_A, PROJ_B, 'sess-a', 'sess-b', 'perm-path-session']) {
    for (const app of [
      'test-app', 'other-app', 'shared-app', 'weather', 'standalone-app', 'bad',
      'hitl-app', 'no-tpl-app', 'lazy-codex-app', 'hello',
    ]) {
      unregisterAppTools(sid, app)
    }
    disposeSuperoneMcpServer(sid)
  }
  setToolSyncCallbacks(null)
  createSuperoneMcpServer(PROJ_A)
})

describe('session collaboration tools', () => {
  it('always lists collaboration tools', () => {
    const names = listSuperoneMcpTools(PROJ_A).map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'session_collab_list_agents',
      'session_collab_request',
      'session_collab_start',
      'session_collab_send',
      'session_collab_retrieve',
    ]))
  })

  // The launch-autonomy guidance lives on the schema field, not the 700-char tool
  // description, so it has to be repeated on the Zod surface the in-process Claude
  // server registers — the JSON-Schema half alone would leave Claude without it.
  it('describes launch permissionMode on the Zod surface, not just the stdio descriptors', () => {
    disposeSuperoneMcpServer(PROJ_A)
    mockRegisterTool.mockClear()
    createSuperoneMcpServer(PROJ_A)

    const call = mockRegisterTool.mock.calls.find(([name]) => name === 'session_collab_request')
    expect(call, 'session_collab_request was never registered').toBeTruthy()
    const inputSchema = (call![1] as { inputSchema: Record<string, ZodTypeAny> }).inputSchema
    const launch = (inputSchema.launches as ZodArray<ZodObject<ZodRawShape>>).element
    const config = (launch.shape.config as ZodOptional<ZodObject<ZodRawShape>>).unwrap()
    expect(config.shape.permissionMode.description).toBe(LAUNCH_PERMISSION_MODE_DESCRIPTION)
  })
})

describe('registerAppTools / unregisterAppTools', () => {
  it('authorizes apps without registering per-app MCP tools (fixed miniapp_list/call surface)', () => {
    // Fixed tools come from createSuperoneMcpServer in beforeEach
    expect(mockRegisterTool.mock.calls.some((c) => c[0] === 'miniapp_list')).toBe(true)
    expect(mockRegisterTool.mock.calls.some((c) => c[0] === 'miniapp_call')).toBe(true)

    mockRegisterTool.mockClear()
    mockSendToolListChanged.mockClear()
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))

    expect(mockRegisterTool.mock.calls.some((c) => c[0] === 'myapp__do_thing')).toBe(false)
    // Authorizing an app must not register tools or churn tools/list
    expect(mockRegisterTool).not.toHaveBeenCalled()
    expect(mockSendToolListChanged).not.toHaveBeenCalled()
  })

  it('does not notify tools-changed listeners when mini-apps authorize/unauthorize', () => {
    const listener = vi.fn()
    const unsubscribe = addToolsChangedListener(listener)

    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    expect(listener).not.toHaveBeenCalled()

    unregisterAppTools(PROJ_A, 'test-app')
    expect(listener).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('registers fixed miniapp tools on createSuperoneMcpServer even with no authorized apps', () => {
    disposeSuperoneMcpServer(PROJ_A)
    mockRegisterTool.mockClear()
    createSuperoneMcpServer(PROJ_A)

    expect(mockRegisterTool).toHaveBeenCalledWith(
      'miniapp_list',
      expect.anything(),
      expect.any(Function),
    )
    expect(mockRegisterTool).toHaveBeenCalledWith(
      'miniapp_call',
      expect.anything(),
      expect.any(Function),
    )
  })

  it('caches authorization when no server; miniapp_call sees it after create', async () => {
    disposeSuperoneMcpServer(PROJ_A)
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('cached_tool'))
    createSuperoneMcpServer(PROJ_A)

    const names = listSuperoneMcpTools(PROJ_A).map((t) => t.name)
    expect(names).toContain('miniapp_list')
    expect(names).toContain('miniapp_call')
    expect(names).not.toContain('myapp__cached_tool')
  })
})

describe('standalone tool dispatch', () => {
  function makeStandaloneTool(name: string, overrides: Partial<MiniAppToolDefinition> = {}): MiniAppToolDefinition {
    return {
      name,
      description: `Tool ${name}`,
      inputSchema: { type: 'object', properties: {} },
      standalone: true,
      ...overrides,
    }
  }

  const sentMessages: Array<{ channel: string; args: unknown[] }> = []
  const mockWebContents = { send: (channel: string, ...args: unknown[]) => sentMessages.push({ channel, args }) }
  const mockWin = { webContents: mockWebContents, isDestroyed: () => false } as unknown as import('electron').BrowserWindow

  beforeEach(() => {
    sentMessages.length = 0
    initSuperoneMcpServer(() => mockWin)
  })

  afterEach(() => {
    // Reset window getter so subsequent describe blocks that don't init their own window
    // don't accidentally dispatch IPC to this mock and hang waiting for a response.
    initSuperoneMcpServer(() => null)
  })

  it('miniapp_list notes panel requirement for non-standalone tools', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('ui_tool'))
    const list = getLastHandler('miniapp_list')
    const reply = await list({})
    const body = JSON.parse(reply.content[0].text)
    const tool = body.apps[0].tools.find((t: { name: string }) => t.name === 'ui_tool')
    expect(tool.description).toContain('Tool ui_tool')
  })

  it('miniapp_list marks standalone tools without panel note in one-line description', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', [makeStandaloneTool('bg_tool')])
    const list = getLastHandler('miniapp_list')
    const reply = await list({})
    const body = JSON.parse(reply.content[0].text)
    const tool = body.apps[0].tools.find((t: { name: string }) => t.name === 'bg_tool')
    expect(tool.description).toBe('Tool bg_tool')
    expect(tool.standalone).toBe(true)
  })

  it('standalone tool dispatches MINIAPP_TOOL_CALL immediately without waitForAppReady', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'weather', 'wx', [makeStandaloneTool('forecast')])

    // Don't await: handler waits for tool result IPC. Verify the dispatch happened without app-ready gate.
    const pending = callMiniapp('weather', 'forecast', { city: 'Tokyo' })
    await new Promise((r) => setImmediate(r))

    const toolCall = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
    expect(toolCall).toBeTruthy()
    const req = toolCall!.args[0] as MiniAppToolCallRequest
    expect(req.appId).toBe('weather')
    expect(req.toolName).toBe('forecast')
    expect(req.arguments).toEqual({ city: 'Tokyo' })

    // Resolve so handler cleans up
    resolveToolCall(req.callId, { ok: true, temp: 22 })
    const result = await pending
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, temp: 22 })
  })

  it('standalone tool does NOT trigger lazy-open IPC', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'standalone-app', 'sa', [makeStandaloneTool('do_thing')])
    const pending = callMiniapp('standalone-app', 'do_thing', {})
    await new Promise((r) => setImmediate(r))

    const lazyOpen = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_LAZY_OPEN_REQUEST)
    expect(lazyOpen).toBeUndefined()

    const toolCall = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)!
    resolveToolCall((toolCall.args[0] as MiniAppToolCallRequest).callId, {})
    void pending
  })

  it('standalone error surface returned as [Error] result', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'bad', 'bd', [makeStandaloneTool('boom_tool')])
    const pending = callMiniapp('bad', 'boom_tool', {})
    await new Promise((r) => setImmediate(r))

    const toolCall = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)!
    rejectToolCall((toolCall.args[0] as MiniAppToolCallRequest).callId, 'iframe crashed')

    const result = await pending
    expect(result.content[0].text).toBe('[Error] iframe crashed')
  })

  describe('standalone + intercept', () => {
    function makeStandaloneInterceptTool(
      name: string,
      onCancel: 'reject' | 'resolve-empty' = 'reject',
    ): MiniAppToolDefinition {
      return {
        name,
        description: `Tool ${name}`,
        inputSchema: { type: 'object', properties: {} },
        standalone: true,
        renderer: {
          intercept: { template: 'confirm', onCancel },
          result: { template: 'card' },
        },
      }
    }

    it('opens intercept renderer first, then dispatches MINIAPP_TOOL_CALL with merged args', async () => {
      registerAppTemplates(PROJ_A, 'hitl-app', { confirm: 'confirm.html', card: 'card.html' })
      registerAppToolsPreapproved(PROJ_A, PROJ_A, 'hitl-app', 'hitl', [makeStandaloneInterceptTool('confirm_increment')])

      const pending = callMiniapp('hitl-app', 'confirm_increment', { by: 1 })
      await new Promise((r) => setImmediate(r))

      const intercept = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)
      expect(intercept).toBeTruthy()
      const interceptReq = intercept!.args[0] as MiniAppToolInterceptOpenRequest
      expect(interceptReq.appId).toBe('hitl-app')
      expect(interceptReq.toolName).toBe('confirm_increment')
      expect(interceptReq.template).toBe('confirm')
      expect(interceptReq.templatePath).toBe('confirm.html')
      expect(interceptReq.agentInput).toEqual({ by: 1 })

      // No MINIAPP_TOOL_CALL yet — we're still gated on user input
      expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)).toBeUndefined()

      submitToolIntercept(interceptReq.callId, { by: 5 })
      await new Promise((r) => setImmediate(r))

      const toolCall = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
      expect(toolCall).toBeTruthy()
      const callReq = toolCall!.args[0] as MiniAppToolCallRequest
      // shallow-merge default: userInput overrides agentInput
      expect(callReq.arguments).toEqual({ by: 5 })
      // Same callId across intercept and the resulting tool call
      expect(callReq.callId).toBe(interceptReq.callId)

      resolveToolCall(callReq.callId, { ok: true, value: 5 })
      const result = await pending
      expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, value: 5 })
    })

    it('honors onCancel: reject — never dispatches MINIAPP_TOOL_CALL and surfaces error', async () => {
      registerAppTemplates(PROJ_A, 'hitl-app', { confirm: 'confirm.html', card: 'card.html' })
      registerAppToolsPreapproved(PROJ_A, PROJ_A, 'hitl-app', 'hitl', [makeStandaloneInterceptTool('strict_tool', 'reject')])

      const pending = callMiniapp('hitl-app', 'strict_tool', {})
      await new Promise((r) => setImmediate(r))

      const interceptReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as MiniAppToolInterceptOpenRequest
      cancelToolIntercept(interceptReq.callId, 'user said no')

      const result = await pending
      expect(result.content[0].text).toBe('[Error] user said no')
      expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)).toBeUndefined()
    })

    it('honors onCancel: resolve-empty — returns { cancelled: true } without dispatching MINIAPP_TOOL_CALL', async () => {
      registerAppTemplates(PROJ_A, 'hitl-app', { confirm: 'confirm.html', card: 'card.html' })
      registerAppToolsPreapproved(PROJ_A, PROJ_A, 'hitl-app', 'hitl', [makeStandaloneInterceptTool('graceful_tool', 'resolve-empty')])

      const pending = callMiniapp('hitl-app', 'graceful_tool', {})
      await new Promise((r) => setImmediate(r))

      const interceptReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as MiniAppToolInterceptOpenRequest
      cancelToolIntercept(interceptReq.callId, 'dismissed')

      const result = await pending
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toEqual({ cancelled: true, reason: 'dismissed' })
      expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)).toBeUndefined()
    })

    it('throws when intercept.template is not registered in manifest.templates', async () => {
      // Use a fresh appId so leftover registerAppTemplates from prior tests cannot satisfy the lookup
      registerAppToolsPreapproved(PROJ_A, PROJ_A, 'no-tpl-app', 'notpl', [makeStandaloneInterceptTool('missing_template')])

      const result = await callMiniapp('no-tpl-app', 'missing_template', {})
      expect(result.content[0].text).toMatch(/Template "confirm" not found/)
      expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)).toBeUndefined()
      expect(sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)).toBeUndefined()
    })
  })
})

describe('multi-project tool routing', () => {
  it('keeps authorization isolated between sessions (fixed tools still registered per session)', async () => {
    createSuperoneMcpServer(PROJ_B)
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'shared-app', 'shared', makeTools('a_only'))
    registerAppToolsPreapproved(PROJ_B, PROJ_B, 'shared-app', 'shared', makeTools('b_only'))

    const listA = await executeSuperoneMcpTool(PROJ_A, 'miniapp_list', {})
    const listB = await executeSuperoneMcpTool(PROJ_B, 'miniapp_list', {})
    const appsA = JSON.parse(listA.content[0].text).apps.map((a: { tools: Array<{ name: string }> }) => a.tools.map((t) => t.name))
    const appsB = JSON.parse(listB.content[0].text).apps.map((a: { tools: Array<{ name: string }> }) => a.tools.map((t) => t.name))
    expect(appsA.flat()).toContain('a_only')
    expect(appsA.flat()).not.toContain('b_only')
    expect(appsB.flat()).toContain('b_only')
    expect(appsB.flat()).not.toContain('a_only')
  })

  it('unregistering one session does not affect the other', async () => {
    createSuperoneMcpServer(PROJ_B)
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'shared-app', 'shared', makeTools('common'))
    registerAppToolsPreapproved(PROJ_B, PROJ_B, 'shared-app', 'shared', makeTools('common'))

    unregisterAppTools(PROJ_A, 'shared-app')

    const listA = await executeSuperoneMcpTool(PROJ_A, 'miniapp_list', {})
    const listB = await executeSuperoneMcpTool(PROJ_B, 'miniapp_list', {})
    expect(JSON.parse(listA.content[0].text).count).toBe(0)
    expect(JSON.parse(listB.content[0].text).count).toBe(1)
  })
})

describe('tool handler rejects closed app', () => {
  it('returns error when app has been unregistered', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    notifyAppReady(PROJ_A, 'test-app')

    unregisterAppTools(PROJ_A, 'test-app')

    const result = await callMiniapp('test-app', 'do_thing', { x: 'hello' })
    expect(result.content[0].text).toMatch(/not authorized/)
  })

  it('works again after re-registering', async () => {
    const sent: Array<{ channel: string; args: unknown[] }> = []
    const win = {
      webContents: { send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) },
      isDestroyed: () => false,
    } as unknown as import('electron').BrowserWindow
    initSuperoneMcpServer(() => win)

    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    unregisterAppTools(PROJ_A, 'test-app')

    createSuperoneMcpServer(PROJ_A)
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    notifyAppReady(PROJ_A, 'test-app')

    const pending = callMiniapp('test-app', 'do_thing', { x: 'hello' })
    await new Promise((r) => setImmediate(r))
    const toolCall = sent.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
    expect(toolCall).toBeTruthy()
    resolveToolCall((toolCall!.args[0] as MiniAppToolCallRequest).callId, { ok: true })
    const result = await pending
    expect(result.content[0].text).toContain('"ok":true')
    initSuperoneMcpServer(() => null)
  })
})

describe('stdio SuperOne MCP tool surface', () => {
  const sentMessages: Array<{ channel: string; args: unknown[] }> = []
  const mockWebContents = { send: (channel: string, ...args: unknown[]) => sentMessages.push({ channel, args }) }
  const mockWin = { webContents: mockWebContents, isDestroyed: () => false } as unknown as import('electron').BrowserWindow

  beforeEach(() => {
    sentMessages.length = 0
    initSuperoneMcpServer(() => mockWin)
    createSuperoneMcpServer(PROJ_A)
  })

  it('lists built-in tools and fixed miniapp tools (not per-app tools)', () => {
    createSuperoneMcpServer(PROJ_B)
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('a_tool'))
    registerAppToolsPreapproved(PROJ_B, PROJ_B, 'other-app', 'other', makeTools('b_tool'))

    const names = listSuperoneMcpTools(PROJ_A).map((tool) => tool.name)

    expect(names).toContain('read_manual')
    expect(names).toContain('config_read')
    expect(names).not.toContain('miniapp_dev_read_guide')
    expect(names).not.toContain('config_read_guide')
    expect(names).toContain('miniapp_list')
    expect(names).toContain('miniapp_call')
    expect(names).not.toContain('myapp__a_tool')
    expect(names).not.toContain('other__b_tool')
    expect(names).toContain('browser_snapshot')
    expect(names).toContain('browser_click')
    expect(names).toContain('browser_action_list')
    expect(names).toContain('browser_action_save')
    expect(names).toContain('browser_action_do')
  })

  it('does not notify stdio clients when mini-app authorization changes', () => {
    const toolsChanged = vi.fn()
    setToolSyncCallbacks({ toolsChanged })

    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('a_tool'))
    unregisterAppTools(PROJ_A, 'test-app')

    expect(toolsChanged).not.toHaveBeenCalled()
  })

  it('executes miniapp_call through the shared dispatcher scoped to projectDir', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    notifyAppReady(PROJ_A, 'test-app')

    const pending = executeSuperoneMcpTool(PROJ_A, 'miniapp_call', {
      appId: 'test-app',
      tool: 'do_thing',
      input: { x: 'hello' },
    })
    await new Promise((r) => setTimeout(r, 10))

    const callReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)!.args[0] as MiniAppToolCallRequest
    expect(callReq.projectDir).toBe(PROJ_A)
    expect(callReq.toolName).toBe('do_thing')
    expect(callReq.arguments).toEqual({ x: 'hello' })

    resolveToolCall(callReq.callId, { ok: true })
    const result = await pending
    expect(result.content[0].text).toContain('"ok":true')
  })

  it('lazy-opens the panel for a codex tool call when the app is @-mentioned but not open', async () => {
    // Regression: the codex bridge path (executeSuperoneMcpTool) used to call
    // executeAppTool directly, so waitForAppReady blocked forever when the panel
    // was never opened. It must trigger lazy-open like the Claude SDK path.
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'lazy-codex-app', 'lz', makeTools('do_thing'))
    // NOTE: deliberately NO notifyAppReady — the panel is not open.

    const pending = executeSuperoneMcpTool(PROJ_A, 'miniapp_call', {
      appId: 'lazy-codex-app',
      tool: 'do_thing',
      input: { x: 'hi' },
    })
    await new Promise((r) => setTimeout(r, 10))

    const lazyOpen = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_LAZY_OPEN_REQUEST)
    expect(lazyOpen).toBeTruthy()
    expect((lazyOpen!.args[0] as { appId: string }).appId).toBe('lazy-codex-app')

    // Renderer opens the panel → gate resolves → the tool call dispatches.
    notifyAppReady(PROJ_A, 'lazy-codex-app')
    await new Promise((r) => setTimeout(r, 10))
    const callReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)!.args[0] as MiniAppToolCallRequest
    resolveToolCall(callReq.callId, { ok: true })
    const result = await pending
    expect(result.content[0].text).toContain('"ok":true')

    unregisterAppTools(PROJ_A, 'lazy-codex-app')
  })
})

describe('clearSessionPendingCalls — cross-project isolation', () => {
  const sentMessages: Array<{ channel: string; args: unknown[] }> = []
  const mockWebContents = { send: (channel: string, ...args: unknown[]) => sentMessages.push({ channel, args }) }
  const mockWin = { webContents: mockWebContents, isDestroyed: () => false } as unknown as import('electron').BrowserWindow

  beforeEach(() => {
    sentMessages.length = 0
    initSuperoneMcpServer(() => mockWin)
    createSuperoneMcpServer(PROJ_A)
    createSuperoneMcpServer(PROJ_B)
  })

  it('rejects only same-project pending calls when one project interrupts', async () => {
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    registerAppToolsPreapproved(PROJ_B, PROJ_B, 'test-app', 'myapp', makeTools('do_thing'))
    notifyAppReady(PROJ_A, 'test-app')
    notifyAppReady(PROJ_B, 'test-app')

    const pendingA = executeAppTool(PROJ_A, 'test-app', 'do_thing', { x: 'a' })
    const pendingB = executeAppTool(PROJ_B, 'test-app', 'do_thing', { x: 'b' })
    await new Promise((r) => setTimeout(r, 10))

    const callsByProject = sentMessages
      .filter((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
      .map((m) => m.args[0] as MiniAppToolCallRequest)
    const callA = callsByProject.find((c) => c.projectDir === PROJ_A)!
    const callB = callsByProject.find((c) => c.projectDir === PROJ_B)!
    expect(callA).toBeTruthy()
    expect(callB).toBeTruthy()

    clearSessionPendingCalls(PROJ_A)

    await expect(pendingA).rejects.toThrow(/Pending calls cleared/)

    resolveToolCall(callB.callId, { still: 'alive' })
    await expect(pendingB).resolves.toMatchObject({ still: 'alive' })
  })

  it('emits MINIAPP_TOOL_INTERCEPT_CLEAR with only this project\'s callIds', async () => {
    const interceptTool = [{
      name: 'confirm_action',
      description: 'requires intercept',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
      renderer: { intercept: { template: 'popovers/confirm' } },
    }]
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', interceptTool)
    registerAppToolsPreapproved(PROJ_B, PROJ_B, 'test-app', 'myapp', interceptTool)
    registerAppTemplates(PROJ_A, 'test-app', { 'popovers/confirm': 'popovers/confirm.html' })
    registerAppTemplates(PROJ_B, 'test-app', { 'popovers/confirm': 'popovers/confirm.html' })
    notifyAppReady(PROJ_A, 'test-app')
    notifyAppReady(PROJ_B, 'test-app')

    const pendingA = executeAppTool(PROJ_A, 'test-app', 'confirm_action', { x: 'a' })
    const pendingB = executeAppTool(PROJ_B, 'test-app', 'confirm_action', { x: 'b' })
    await new Promise((r) => setTimeout(r, 10))

    const opens = sentMessages
      .filter((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)
      .map((m) => m.args[0] as MiniAppToolInterceptOpenRequest)
    const openA = opens.find((o) => o.projectDir === PROJ_A)!
    const openB = opens.find((o) => o.projectDir === PROJ_B)!
    expect(openA).toBeTruthy()
    expect(openB).toBeTruthy()

    sentMessages.length = 0
    clearSessionPendingCalls(PROJ_A)

    const clearMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR)
    expect(clearMsg).toBeTruthy()
    expect(clearMsg!.args[0]).toBe(PROJ_A)
    expect(clearMsg!.args[1]).toEqual([openA.callId])
    expect((clearMsg!.args[1] as string[])).not.toContain(openB.callId)

    await expect(pendingA).rejects.toThrow(/Pending calls cleared/)

    submitToolIntercept(openB.callId, { user: 'ok' })
    await new Promise((r) => setTimeout(r, 10))
    const followUp = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
    expect(followUp).toBeTruthy()
    const followCall = followUp!.args[0] as MiniAppToolCallRequest
    resolveToolCall(followCall.callId, { still: 'alive' })
    await expect(pendingB).resolves.toBeTruthy()
  })
})

describe('isToolPreapproved', () => {
  it('returns false for non-superone tools', () => {
    expect(isToolPreapproved('some_random_tool')).toBe(false)
  })

  it('returns false when tool is not preapproved (legacy name or miniapp_call args)', () => {
    // Deliberately not preapproved — registerAppTools only, no markAppToolPreapproved
    registerAppTools(PROJ_A, PROJ_A, 'test-app', 'myapp', makeTools('do_thing'))
    expect(isToolPreapproved('mcp__superone__myapp__do_thing')).toBe(false)
    expect(isToolPreapproved('mcp__superone__miniapp_call', {
      appId: 'test-app',
      tool: 'do_thing',
      input: {},
    })).toBe(false)
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
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', [makeInterceptTool('confirm_action')])
    registerAppTemplates(PROJ_A, 'test-app', { confirm: 'popovers/confirm.html' })
    notifyAppReady(PROJ_A, 'test-app')
  })

  it('submit path: merges agent + user input, dispatches MINIAPP_TOOL_CALL with projectDir', async () => {
    const pending = callMiniapp('test-app', 'confirm_action', { agent_field: 'from_agent' })

    await new Promise((r) => setTimeout(r, 10))

    const openMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)
    expect(openMsg).toBeTruthy()
    const openReq = openMsg!.args[0] as MiniAppToolInterceptOpenRequest
    expect(openReq.agentInput).toEqual({ agent_field: 'from_agent' })
    expect(openReq.templatePath).toBe('popovers/confirm.html')
    expect(openReq.projectDir).toBe(PROJ_A)

    submitToolIntercept(openReq.callId, { user_field: 'from_user' })

    await new Promise((r) => setTimeout(r, 10))

    const callMsg = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_CALL)
    expect(callMsg).toBeTruthy()
    const callReq = callMsg!.args[0] as MiniAppToolCallRequest
    expect(callReq.arguments).toEqual({ agent_field: 'from_agent', user_field: 'from_user' })
    expect(callReq.projectDir).toBe(PROJ_A)

    resolveToolCall(callReq.callId, { ok: true })
    const result = await pending
    expect(result.content[0].text).toContain('"ok":true')
  })

  it('cancel with default onCancel=reject: tool handler reports error', async () => {
    const pending = callMiniapp('test-app', 'confirm_action', { agent_field: 'x' })
    await new Promise((r) => setTimeout(r, 10))
    const openReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as { callId: string }
    cancelToolIntercept(openReq.callId, 'user_cancelled')

    const result = await pending
    expect(result.content[0].text).toContain('[Error]')
    expect(result.content[0].text).toContain('user_cancelled')
  })

  it('cancel with onCancel=resolve-empty: tool returns cancelled payload', async () => {
    unregisterAppTools(PROJ_A, 'test-app')
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', [makeInterceptTool('confirm_action', { onCancel: 'resolve-empty' })])
    registerAppTemplates(PROJ_A, 'test-app', { confirm: 'popovers/confirm.html' })
    notifyAppReady(PROJ_A, 'test-app')

    const pending = callMiniapp('test-app', 'confirm_action', { agent_field: 'x' })
    await new Promise((r) => setTimeout(r, 10))
    const openReq = sentMessages.find((m) => m.channel === AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN)!.args[0] as { callId: string }
    cancelToolIntercept(openReq.callId, 'user_cancelled')

    const result = await pending
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toMatchObject({ cancelled: true })
    expect(parsed.reason).toContain('user_cancelled')
  })

  it('inputMerge=replace: user input overrides agent input entirely', async () => {
    unregisterAppTools(PROJ_A, 'test-app')
    registerAppToolsPreapproved(PROJ_A, PROJ_A, 'test-app', 'myapp', [makeInterceptTool('confirm_action', { inputMerge: 'replace' })])
    registerAppTemplates(PROJ_A, 'test-app', { confirm: 'popovers/confirm.html' })
    notifyAppReady(PROJ_A, 'test-app')

    const pending = callMiniapp('test-app', 'confirm_action', { agent_field: 'from_agent' })
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
    unregisterAppTemplates(PROJ_A, 'test-app')
    const result = await callMiniapp('test-app', 'confirm_action', { agent_field: 'x' })
    expect(result.content[0].text).toContain('[Error]')
    expect(result.content[0].text).toContain('Template "confirm" not found')
  })
})

describe('miniapp_dev_setup tool handler', () => {
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
    createSuperoneMcpServer(PROJ_A)
  })

  it('returns status=created and notifies dev-app-ready with the new appId', async () => {
    mockCreateMiniApp.mockResolvedValueOnce({
      entry: {
        id: 'weather-1abc',
        manifest: { appId: 'weather-1abc', name: 'Weather' },
        installDir: '/proj/.superone/apps/weather-1abc',
        distDir: '/proj/packages/weather/dist',
      },
      appPath: '/proj/packages/weather',
      buildRequired: true,
    })
    const handler = getBuiltInHandler('miniapp_dev_setup')

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
    const handler = getBuiltInHandler('miniapp_dev_setup')

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
    const handler = getBuiltInHandler('miniapp_dev_setup')

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
})

describe('basic scenario: session authorization is per-session (fixed MCP tool list)', () => {
  const SID_A = 'sess-a'
  const SID_B = 'sess-b'
  const PROJ = '/proj'

  async function authorizedAppIds(sessionId: string): Promise<string[]> {
    const reply = await executeSuperoneMcpTool(sessionId, 'miniapp_list', {})
    const body = JSON.parse(reply.content[0].text) as { apps: Array<{ appId: string }> }
    return body.apps.map((a) => a.appId)
  }

  beforeEach(() => {
    initSuperoneMcpServer(() => null)
    unregisterAppTools(SID_A, 'weather')
    unregisterAppTools(SID_B, 'weather')
    disposeSuperoneMcpServer(SID_A)
    disposeSuperoneMcpServer(SID_B)
    createSuperoneMcpServer(SID_A)
    createSuperoneMcpServer(SID_B)
  })

  it('sessionA opens X: weather appears in miniapp_list for sessionA; MCP list stays fixed', async () => {
    expect(listSuperoneMcpTools(SID_A).map((t) => t.name)).toContain('miniapp_list')
    expect(listSuperoneMcpTools(SID_A).map((t) => t.name)).toContain('miniapp_call')
    expect(listSuperoneMcpTools(SID_A).map((t) => t.name)).not.toContain('weather__forecast')

    registerAppToolsPreapproved(SID_A, PROJ, 'weather', 'weather', makeTools('forecast'))

    expect(await authorizedAppIds(SID_A)).toContain('weather')
    expect(listSuperoneMcpTools(SID_A).map((t) => t.name)).not.toContain('weather__forecast')
  })

  it('sessionA closes X: weather disappears from miniapp_list', async () => {
    registerAppToolsPreapproved(SID_A, PROJ, 'weather', 'weather', makeTools('forecast'))
    expect(await authorizedAppIds(SID_A)).toContain('weather')

    unregisterAppTools(SID_A, 'weather')

    expect(await authorizedAppIds(SID_A)).not.toContain('weather')
  })

  it('sessionA opens X then closes X: authorization added then fully removed', async () => {
    expect(await authorizedAppIds(SID_A)).not.toContain('weather')

    registerAppToolsPreapproved(SID_A, PROJ, 'weather', 'weather', makeTools('forecast'))
    expect(await authorizedAppIds(SID_A)).toContain('weather')

    unregisterAppTools(SID_A, 'weather')
    expect(await authorizedAppIds(SID_A)).not.toContain('weather')
  })

  it('sessionA opens X never affects sessionB authorization (per-session isolation)', async () => {
    registerAppToolsPreapproved(SID_A, PROJ, 'weather', 'weather', makeTools('forecast'))

    expect(await authorizedAppIds(SID_A)).toContain('weather')
    expect(await authorizedAppIds(SID_B)).not.toContain('weather')
  })

  it('sessionA closes X never affects sessionB which had also opened X', async () => {
    registerAppToolsPreapproved(SID_A, PROJ, 'weather', 'weather', makeTools('forecast'))
    registerAppToolsPreapproved(SID_B, PROJ, 'weather', 'weather', makeTools('forecast'))

    unregisterAppTools(SID_A, 'weather')

    expect(await authorizedAppIds(SID_A)).not.toContain('weather')
    expect(await authorizedAppIds(SID_B)).toContain('weather')
  })
})
