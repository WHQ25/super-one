import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRemove, mockRegisterTool, mockSendToolListChanged, mockIsConnected } = vi.hoisted(() => {
  const mockRemove = vi.fn()
  const mockRegisterTool = vi.fn((_name: string, _opts: unknown, handler: Function) => {
    const entry = { remove: mockRemove, handler }
    return entry
  })
  const mockSendToolListChanged = vi.fn()
  const mockIsConnected = vi.fn(() => true)
  return { mockRemove, mockRegisterTool, mockSendToolListChanged, mockIsConnected }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({}))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function(this: Record<string, unknown>) {
    this.tool = vi.fn()
    this.registerTool = mockRegisterTool
    this.sendToolListChanged = mockSendToolListChanged
    this.isConnected = mockIsConnected
  }),
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../miniapp/miniapp-service', () => ({
  createMiniApp: vi.fn(),
  cacheAppBasePath: vi.fn(),
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
} from './superone-mcp-server'
import type { MiniAppToolDefinition } from '../../shared/miniapp-types'

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
