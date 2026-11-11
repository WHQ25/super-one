import { describe, expect, it, vi } from 'vitest'
import { sessionKey as toSessionKey, sessionRef } from '@superone/shared/environment/refs'
import { McpAppToolsRegistry } from '../mcp-apps/app-tools-registry'
import { executeMcpAppToolsCall, executeMcpAppToolsList } from './mcp-app-tools-mcp'

describe('mcp-app-tools-mcp handlers', () => {
  it('lists open Views in compact form and returns full JSON schemas when viewId is specified', async () => {
    const registry = new McpAppToolsRegistry()
    const localKey = toSessionKey(sessionRef('local', 's1'))
    registry.syncView({
      sessionKey: localKey,
      projectScope: '/work',
      requester: { kind: 'desktop' },
      catalog: {
        viewId: 'v-canvas',
        server: 'excalidraw',
        viewTitle: 'Diagram Canvas',
        tools: [{
          name: 'add_node',
          title: 'Add Node',
          description: 'Insert a rectangle node\nDetailed second line',
          inputSchema: {
            type: 'object',
            properties: { label: { type: 'string' } },
            required: ['label'],
          },
          annotations: { readOnlyHint: false, idempotentHint: true },
        }],
      },
      dispatch: {
        requestApproval: vi.fn(async () => ({ approved: true })),
        callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] })),
      },
    })

    const overview = await executeMcpAppToolsList('s1', {}, { registry })
    const overviewJson = JSON.parse((overview.content[0] as { text: string }).text) as {
      count: number
      views: Array<{ viewId: string; tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>
    }
    expect(overviewJson.count).toBe(1)
    expect(overviewJson.views[0]?.tools[0]).toMatchObject({
      name: 'add_node',
      description: 'Insert a rectangle node',
    })
    expect(overviewJson.views[0]?.tools[0]?.inputSchema).toBeUndefined()

    const detailed = await executeMcpAppToolsList('s1', { viewId: 'v-canvas' }, { registry })
    const detailedJson = JSON.parse((detailed.content[0] as { text: string }).text) as {
      tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    expect(detailedJson.tools[0]?.description).toContain('Detailed second line')
    expect(detailedJson.tools[0]?.inputSchema).toMatchObject({ required: ['label'] })
  })

  it('validates inputSchema with Zod, gates readOnlyHint tools in standard mode, and auto-allows in bypassPermissions', async () => {
    const registry = new McpAppToolsRegistry()
    const remoteConn = 'node-vensen-1'
    const remoteKey = toSessionKey(sessionRef(remoteConn, 's-remote'))
    const requestApproval = vi.fn(async () => ({ approved: false }))
    const callTool = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: `read:${String(args.filter)}` }],
      structuredContent: { filter: args.filter },
    }))

    registry.syncView({
      sessionKey: remoteKey,
      projectScope: '/remote/work',
      requester: { kind: 'desktop' },
      catalog: {
        viewId: 'v-table',
        server: 'analytics',
        tools: [{
          name: 'read_rows',
          description: 'Read filtered rows',
          inputSchema: {
            type: 'object',
            properties: { filter: { type: 'string' } },
            required: ['filter'],
          },
          annotations: { readOnlyHint: true },
        }],
      },
      dispatch: { requestApproval, callTool },
    })

    const badSchema = await executeMcpAppToolsCall(
      's-remote',
      { viewId: 'v-table', tool: 'read_rows', input: {} },
      { registry, resolvePermissionMode: () => 'default' },
      undefined,
      remoteConn,
    )
    expect(badSchema.isError).toBe(true)
    expect((badSchema.content[0] as { text: string }).text).toContain('filter')
    expect(requestApproval).not.toHaveBeenCalled()

    const deniedInStandard = await executeMcpAppToolsCall(
      's-remote',
      { viewId: 'v-table', tool: 'read_rows', input: { filter: 'active' } },
      { registry, resolvePermissionMode: () => 'default' },
      undefined,
      remoteConn,
    )
    expect(requestApproval).toHaveBeenCalledTimes(1)
    expect(callTool).not.toHaveBeenCalled()
    expect(JSON.parse((deniedInStandard.content[0] as { text: string }).text)).toMatchObject({
      status: 'denied',
      viewId: 'v-table',
      tool: 'read_rows',
    })

    const allowedInBypass = await executeMcpAppToolsCall(
      's-remote',
      { viewId: 'v-table', tool: 'read_rows', input: { filter: 'active' } },
      { registry, resolvePermissionMode: () => 'bypassPermissions' },
      undefined,
      remoteConn,
    )
    expect(requestApproval).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(allowedInBypass).toMatchObject({
      content: [{ type: 'text', text: 'read:active' }],
      structuredContent: { filter: 'active' },
    })
  })
})
