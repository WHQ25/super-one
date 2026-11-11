import { describe, expect, it, vi } from 'vitest'
import { sessionKey as toSessionKey, sessionRef } from '@superone/shared/environment/refs'
import { McpAppsError } from '@superone/shared/mcp-apps'
import { McpAppToolsRegistry, type McpAppViewToolSurfaceDispatch } from './app-tools-registry'

const SESSION_A = toSessionKey(sessionRef('local', 'sess-a'))
const SESSION_B = toSessionKey(sessionRef('local', 'sess-b'))

function makeDispatch(overrides: Partial<McpAppViewToolSurfaceDispatch> = {}): McpAppViewToolSurfaceDispatch {
  return {
    requestApproval: vi.fn(async () => ({ approved: true })),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    ...overrides,
  }
}

describe('McpAppToolsRegistry', () => {
  it('deduplicates Views across surfaces and routes to the preferred control-lease holder', async () => {
    let preferred: string | undefined = 'mobile:phone-1'
    const registry = new McpAppToolsRegistry({
      resolvePreferredRequester: () => preferred,
    })
    const desktopDispatch = makeDispatch({
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'from-desktop' }] })),
    })
    const mobileDispatch = makeDispatch({
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'from-mobile' }] })),
    })

    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'desktop' },
      ownerId: 10,
      catalog: {
        viewId: 'view-1',
        server: 'board',
        tools: [{ name: 'draw', description: 'desktop copy', inputSchema: { type: 'object' } }],
      },
      dispatch: desktopDispatch,
    })
    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'mobile', deviceId: 'phone-1' },
      catalog: {
        viewId: 'view-1',
        server: 'board',
        tools: [{ name: 'draw', description: 'mobile copy', inputSchema: { type: 'object' } }],
      },
      dispatch: mobileDispatch,
    })

    expect(registry.listSessionViews(SESSION_A)).toHaveLength(1)
    expect(registry.listSessionViews(SESSION_A)[0]?.tools[0]?.description).toBe('mobile copy')

    const mobileResult = await registry.invokeTool({
      sessionKey: SESSION_A,
      viewId: 'view-1',
      toolName: 'draw',
      args: {},
      argsPreview: '{}',
      bypassApproval: true,
    })
    expect(mobileResult).toMatchObject({
      status: 'executed',
      result: { content: [{ type: 'text', text: 'from-mobile' }] },
    })
    expect(desktopDispatch.callTool).not.toHaveBeenCalled()

    preferred = 'desktop'
    const desktopResult = await registry.invokeTool({
      sessionKey: SESSION_A,
      viewId: 'view-1',
      toolName: 'draw',
      args: {},
      argsPreview: '{}',
      bypassApproval: true,
    })
    expect(desktopResult).toMatchObject({
      status: 'executed',
      result: { content: [{ type: 'text', text: 'from-desktop' }] },
    })
  })

  it('pins standing Always Allow to definitionHash and invalidates when tool metadata mutates', async () => {
    const registry = new McpAppToolsRegistry()
    const dispatch = makeDispatch({
      requestApproval: vi.fn(async () => ({ approved: true, alwaysAllow: true })),
    })

    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'desktop' },
      catalog: {
        viewId: 'view-1',
        server: 'board',
        originToolName: 'open_board',
        tools: [{ name: 'inspect', description: 'Read selection', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
      },
      dispatch,
    })

    await registry.invokeTool({
      sessionKey: SESSION_A,
      viewId: 'view-1',
      toolName: 'inspect',
      args: {},
      argsPreview: '{}',
    })
    expect(dispatch.requestApproval).toHaveBeenCalledTimes(1)

    await registry.invokeTool({
      sessionKey: SESSION_A,
      viewId: 'view-1',
      toolName: 'inspect',
      args: {},
      argsPreview: '{}',
    })
    expect(dispatch.requestApproval).toHaveBeenCalledTimes(1)

    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'desktop' },
      catalog: {
        viewId: 'view-1',
        server: 'board',
        originToolName: 'open_board',
        tools: [{ name: 'inspect', description: 'Mutated description', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
      },
      dispatch,
    })

    await registry.invokeTool({
      sessionKey: SESSION_A,
      viewId: 'view-1',
      toolName: 'inspect',
      args: {},
      argsPreview: '{}',
    })
    expect(dispatch.requestApproval).toHaveBeenCalledTimes(2)
  })

  it('disables standing approval for schemaFallback tools and rejects TOCTOU definition mutations during approval', async () => {
    const registry = new McpAppToolsRegistry()
    let deep: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 35; i++) deep = { type: 'object', properties: { n: deep } }

    const fallbackDispatch = makeDispatch({
      requestApproval: vi.fn(async (prompt) => {
        expect(prompt.allowAlwaysAllow).toBe(false)
        expect(prompt.schemaFallback).toBe(true)
        return { approved: true, alwaysAllow: true }
      }),
    })
    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'desktop' },
      catalog: {
        viewId: 'fallback-view',
        server: 'board',
        tools: [{ name: 'complex', inputSchema: deep }],
      },
      dispatch: fallbackDispatch,
    })

    await registry.invokeTool({ sessionKey: SESSION_A, viewId: 'fallback-view', toolName: 'complex', args: {}, argsPreview: '{}' })
    await registry.invokeTool({ sessionKey: SESSION_A, viewId: 'fallback-view', toolName: 'complex', args: {}, argsPreview: '{}' })
    expect(fallbackDispatch.requestApproval).toHaveBeenCalledTimes(2)

    const toctouDispatch = makeDispatch({
      requestApproval: vi.fn(async () => {
        registry.syncView({
          sessionKey: SESSION_A,
          projectScope: '/proj',
          requester: { kind: 'desktop' },
          catalog: {
            viewId: 'toctou-view',
            server: 'board',
            tools: [{ name: 'act', description: 'swapped after prompt', inputSchema: { type: 'object' } }],
          },
          dispatch: toctouDispatch,
        })
        return { approved: true }
      }),
    })
    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'desktop' },
      catalog: {
        viewId: 'toctou-view',
        server: 'board',
        tools: [{ name: 'act', description: 'benign before prompt', inputSchema: { type: 'object' } }],
      },
      dispatch: toctouDispatch,
    })

    await expect(
      registry.invokeTool({ sessionKey: SESSION_A, viewId: 'toctou-view', toolName: 'act', args: {}, argsPreview: '{}' }),
    ).rejects.toMatchObject({ code: 'denied' })
    expect(toctouDispatch.callTool).not.toHaveBeenCalled()
  })

  it('enforces post-approval execution timeout and cleans up across session, window, and requester lifecycles', async () => {
    const registry = new McpAppToolsRegistry({ executionTimeoutMs: 40 })
    const slowDispatch = makeDispatch({
      callTool: vi.fn((_name, _args, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })),
    })

    registry.syncView({
      sessionKey: SESSION_A,
      projectScope: '/proj',
      requester: { kind: 'desktop' },
      ownerId: 99,
      catalog: {
        viewId: 'slow-view',
        server: 'board',
        tools: [{ name: 'hang', inputSchema: { type: 'object' } }],
      },
      dispatch: slowDispatch,
    })

    await expect(
      registry.invokeTool({
        sessionKey: SESSION_A,
        viewId: 'slow-view',
        toolName: 'hang',
        args: {},
        argsPreview: '{}',
        bypassApproval: true,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'timeout' } satisfies Partial<McpAppsError>))

    expect(registry.listSessionViews(SESSION_B)).toEqual([])

    registry.syncView({
      sessionKey: SESSION_B,
      projectScope: '/proj',
      requester: { kind: 'mobile', deviceId: 'dev-2' },
      catalog: {
        viewId: 'mobile-view',
        server: 'board',
        tools: [{ name: 'ping', inputSchema: { type: 'object' } }],
      },
      dispatch: makeDispatch(),
    })

    registry.releaseWindowOwner(99)
    expect(registry.listSessionViews(SESSION_A)).toEqual([])
    expect(registry.listSessionViews(SESSION_B)).toHaveLength(1)

    registry.releaseRequester({ kind: 'mobile', deviceId: 'dev-2' })
    expect(registry.listSessionViews(SESSION_B)).toEqual([])
  })
})
