import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import {
  executeMiniappCall,
  executeMiniappList,
  executeMiniappOpen,
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
    listInstalledApps: async () => [],
    authorizeApp: vi.fn(async () => false),
    openAppView: vi.fn(async () => ({ status: 'applied', tab: 'miniapp-weather:p1', name: 'Weather', presentation: 'panel' as const })),
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

  it('registers miniapp_list, miniapp_call and miniapp_open', () => {
    const tools = buildTools()
    expect([...tools.keys()]).toEqual(['miniapp_list', 'miniapp_call', 'miniapp_open'])
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

  it('errors when the app is not installed for the session\'s project', async () => {
    const deps = buildDeps()
    const reply = await executeMiniappCall('sid-1', {
      appId: 'other',
      tool: 'forecast',
      input: { city: 'X' },
    }, deps)
    expect(reply.isError).toBe(true)
    expect(text(reply)).toMatch(/not installed/)
    expect(deps.authorizeApp).toHaveBeenCalledWith('sid-1', 'other')
  })

  it('grants an installed app on its first call, without an @-mention', async () => {
    let granted = false
    const deps = buildDeps({
      getAppEntry: (_sid, appId) => (appId === 'notes' && granted ? { projectDir: '/proj', tools: [makeTool('add')] } : null),
      authorizeApp: vi.fn(async () => { granted = true; return true }),
      isAppToolPreapproved: () => true,
    })
    const reply = await executeMiniappCall('sid-1', { appId: 'notes', tool: 'add', input: { city: 'X' } }, deps)
    expect(reply.isError).toBeUndefined()
    expect(deps.dispatchAppToolCall).toHaveBeenCalledWith('sid-1', '/proj', 'notes', 'add', false, { city: 'X' })
  })

  it('lists installed apps that were never granted next to the granted ones', async () => {
    const deps = buildDeps({
      listInstalledApps: async () => [
        { appId: 'weather', tools: [makeTool('forecast')] },
        { appId: 'notes', tools: [makeTool('add')] },
      ],
    })
    const body = JSON.parse(text(await executeMiniappList('sid-1', {}, deps)))
    expect(body.apps.map((app: { appId: string }) => app.appId)).toEqual(['weather', 'notes'])
    const one = JSON.parse(text(await executeMiniappList('sid-1', { appId: 'notes' }, deps)))
    expect(one.tools[0].name).toBe('add')
  })

  it('opens an app UI and says when it landed in the background', async () => {
    const deps = buildDeps({
      openAppView: vi.fn(async () => ({ status: 'applied', tab: 'miniapp-notes:p1', name: 'Notes', presentation: 'pip' as const })),
    })
    const body = JSON.parse(text(await executeMiniappOpen('sid-1', { appId: 'notes' }, deps)))
    expect(body).toMatchObject({ status: 'applied', appId: 'notes', name: 'Notes', tab: 'miniapp-notes:p1', shown: 'pip' })
    expect(body.reveal).toContain('layout_act action=focus_tab tab="miniapp-notes:p1"')

    const shown = JSON.parse(text(await executeMiniappOpen('sid-1', { appId: 'weather' }, buildDeps())))
    expect(shown.shown).toBeUndefined()
  })

  it('reports an app that cannot be opened as an error', async () => {
    const deps = buildDeps({ openAppView: vi.fn(async () => { throw new Error('No mini-app ghost is installed for this project.') }) })
    const reply = await executeMiniappOpen('sid-1', { appId: 'ghost' }, deps)
    expect(reply.isError).toBe(true)
    expect(text(reply)).toMatch(/ghost/)
    expect((await executeMiniappOpen('sid-1', { appId: ' ' }, deps)).isError).toBe(true)
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
    expect(names).toEqual(['miniapp_list', 'miniapp_call', 'miniapp_open'])
  })
})
