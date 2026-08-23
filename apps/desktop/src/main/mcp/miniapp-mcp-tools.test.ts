import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import {
  executeMiniappCall,
  executeMiniappList,
  getMiniappFixedToolDescriptors,
  registerMiniappTools,
  type MiniappToolDeps,
  type MiniappToolReply,
} from './miniapp-mcp-tools'

type Handler = (args: Record<string, unknown>) => Promise<MiniappToolReply>

function makeTool(name: string, overrides: Partial<MiniAppToolDefinition> = {}): MiniAppToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
    },
    ...overrides,
  }
}

function buildDeps(overrides: Partial<MiniappToolDeps> = {}): MiniappToolDeps {
  const tools = [makeTool('forecast')]
  const preapproved = new Set<string>(['weather::forecast'])
  return {
    getAuthorizedApps: () => [{ appId: 'weather', tools }],
    getAppEntry: (sessionId, appId) => {
      if (sessionId !== 'sid-1' || appId !== 'weather') return null
      return { projectDir: '/proj', tools }
    },
    dispatchAppToolCall: vi.fn(async () => ({ ok: true, temp: 22 })),
    isAppToolPreapproved: (appId, tool) => preapproved.has(`${appId}::${tool}`),
    markAppToolPreapproved: (appId, tool) => { preapproved.add(`${appId}::${tool}`) },
    getEmitHostEvent: () => null,
    ...overrides,
  }
}

function buildTools(deps: MiniappToolDeps = buildDeps()): Map<string, Handler> {
  const tools = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler)
      return {}
    },
  }
  registerMiniappTools(server as never, 'sid-1', deps)
  return tools
}

function text(reply: MiniappToolReply): string {
  return reply.content.map((c) => c.type === 'text' ? c.text : '').join('')
}

describe('miniapp fixed MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers only miniapp_list and miniapp_call', () => {
    const tools = buildTools()
    expect([...tools.keys()]).toEqual(['miniapp_list', 'miniapp_call'])
  })

  it('lists authorized apps with tool names when appId is omitted', async () => {
    const reply = await executeMiniappList('sid-1', {}, buildDeps())
    expect(reply.isError).toBeUndefined()
    const body = JSON.parse(text(reply))
    expect(body.count).toBe(1)
    expect(body.apps[0]).toMatchObject({
      appId: 'weather',
      tools: [{ name: 'forecast', description: 'Tool forecast' }],
    })
    expect(body.apps[0].toolSlug).toBeUndefined()
    expect(body.apps[0].tools[0].inputSchema).toBeUndefined()
  })

  it('returns full tool definitions including inputSchema for a specific appId', async () => {
    const reply = await executeMiniappList('sid-1', { appId: 'weather' }, buildDeps())
    const body = JSON.parse(text(reply))
    expect(body.tools[0].inputSchema).toEqual(expect.objectContaining({
      type: 'object',
      required: ['city'],
    }))
  })

  it('dispatches miniapp_call through dispatchAppToolCall with validated input', async () => {
    const deps = buildDeps()
    const reply = await executeMiniappCall('sid-1', {
      appId: 'weather',
      tool: 'forecast',
      input: { city: 'Tokyo' },
    }, deps)
    expect(reply.isError).toBeUndefined()
    expect(JSON.parse(text(reply))).toEqual({ ok: true, temp: 22 })
    expect(deps.dispatchAppToolCall).toHaveBeenCalledWith(
      'sid-1',
      '/proj',
      'weather',
      'forecast',
      false,
      { city: 'Tokyo' },
    )
  })

  it('rejects invalid input with a correctable schema error', async () => {
    const deps = buildDeps()
    const reply = await executeMiniappCall('sid-1', {
      appId: 'weather',
      tool: 'forecast',
      input: {},
    }, deps)
    expect(reply.isError).toBe(true)
    const msg = text(reply)
    expect(msg).toMatch(/Invalid input/)
    expect(msg).toMatch(/city/)
    expect(deps.dispatchAppToolCall).not.toHaveBeenCalled()
  })

  it('errors when the app is not authorized for the session', async () => {
    const reply = await executeMiniappCall('sid-1', {
      appId: 'other',
      tool: 'forecast',
      input: { city: 'X' },
    }, buildDeps())
    expect(reply.isError).toBe(true)
    expect(text(reply)).toMatch(/not authorized/)
  })

  it('skips host prompt when the app tool is preapproved', async () => {
    const emit = vi.fn()
    const deps = buildDeps({
      getEmitHostEvent: () => emit,
    })
    const reply = await executeMiniappCall('sid-1', {
      appId: 'weather',
      tool: 'forecast',
      input: { city: 'Tokyo' },
    }, deps)
    expect(reply.isError).toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
    expect(deps.dispatchAppToolCall).toHaveBeenCalled()
  })

  it('raises host permission_request when not preapproved and respects accept/deny', async () => {
    const { resolveMiniappCallConfirm } = await import('./miniapp-call-confirm')
    const tools = [makeTool('forecast')]
    const deps = buildDeps({
      isAppToolPreapproved: () => false,
      getEmitHostEvent: () => (event) => {
        if (event.type !== 'permission_request') return
        // Decline on next tick so the pending promise is registered first
        queueMicrotask(() => {
          resolveMiniappCallConfirm(event.request.requestId, 'decline', false, 'nope')
        })
      },
      getAppEntry: () => ({ projectDir: '/proj', tools }),
    })

    const denied = await executeMiniappCall('sid-1', {
      appId: 'weather',
      tool: 'forecast',
      input: { city: 'Tokyo' },
    }, deps)
    expect(denied.isError).toBeUndefined()
    expect(JSON.parse(text(denied)).status).toBe('denied')
    expect(deps.dispatchAppToolCall).not.toHaveBeenCalled()
  })

  it('exposes fixed tool descriptors for the stdio surface', () => {
    const names = getMiniappFixedToolDescriptors().map((d) => d.name)
    expect(names).toEqual(['miniapp_list', 'miniapp_call'])
  })
})
