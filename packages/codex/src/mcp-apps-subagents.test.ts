import { describe, expect, it, vi } from 'vitest'
import type { CodexCollabToolCallItem, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'
import { attachCodexMcpAppTree, createCodexMcpAppsProvider, prewarmCodexMcpAppCatalog, type McpAppsRequest } from './mcp-apps'
import { ensureCodexMcpAppThread } from './mcp-app-thread'

const binding: McpAppsBinding = { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }
const call: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'fixture', tool: 'next', arguments: { page: 1 }, status: 'completed', mcpAppUi: { resourceUri: 'ui://fixture/view' }, result: { content: [], structuredContent: { page: 1 }, meta: { private: 'View only' } } }
const collab = (id: string, childItems: CodexCollabToolCallItem['childItems']): CodexCollabToolCallItem => ({ id, type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: Object.keys(childItems ?? {}), agentsStates: {}, childItems })

describe('Codex child MCP Apps', () => {
  it('binds every nested App to its own child thread and keeps metadata/result private', () => {
    const source = collab('spawn', { child: [call, collab('nested', { grandchild: [call] })], sibling: [call] })
    const attached = attachCodexMcpAppTree(source, () => binding, 'root') as CodexCollabToolCallItem
    const child = attached.childItems!.child![0] as CodexMcpToolCallItem
    const nested = attached.childItems!.child![1] as CodexCollabToolCallItem
    const grandchild = nested.childItems!.grandchild![0] as CodexMcpToolCallItem
    const sibling = attached.childItems!.sibling![0] as CodexMcpToolCallItem
    expect(child.app).toMatchObject({ origin: { providerSessionId: 'child' }, toolResult: { structuredContent: { page: 1 }, _meta: { private: 'View only' } } })
    expect(grandchild.app?.origin?.providerSessionId).toBe('grandchild')
    expect(new Set([child, grandchild, sibling].map(item => item.app?.appInstanceId)).size).toBe(3)
    expect(source.childItems!.child![0]).toBe(call)
    expect(call.app).toBeUndefined()
    const request = vi.fn<McpAppsRequest>(async () => ({ data: [] }))
    prewarmCodexMcpAppCatalog(attached, request, {})
    expect(request.mock.calls.map(([, params]) => params?.threadId).sort()).toEqual(['child', 'grandchild', 'sibling'])
  })

  it('validates provider ancestry, resumes once per connection, and uses the child for native reads/calls', async () => {
    const request = vi.fn<McpAppsRequest>(async (method, params = {}) => {
      if (method === 'thread/read') return { thread: { source: { subAgent: { thread_spawn: { parent_thread_id: params.threadId === 'grandchild' ? 'child' : 'root' } } } } }
      if (method === 'mcpServer/resource/read') return { contents: [{ uri: params.uri, mimeType: 'text/html;profile=mcp-app', text: '<p>child</p>', _meta: { ui: {} } }] }
      return { content: [] }
    })
    const connection = {}
    await Promise.all([ensureCodexMcpAppThread(request, 'root', 'grandchild', connection), ensureCodexMcpAppThread(request, 'root', 'grandchild', connection)])
    expect(request.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/read', 'thread/resume'])
    expect(request).toHaveBeenLastCalledWith('thread/resume', { threadId: 'grandchild' })
    const provider = createCodexMcpAppsProvider(binding, 'grandchild', request, connection)
    const origin = { providerSessionId: 'grandchild' }
    await provider.readResource({ uri: 'ui://fixture/view', origin }, new AbortController().signal)
    await provider.callTool({ tool: 'next', args: {}, origin }, new AbortController().signal)
    expect(request).toHaveBeenCalledWith('mcpServer/resource/read', expect.objectContaining({ threadId: 'grandchild', server: 'fixture' }))
    expect(request).toHaveBeenCalledWith('mcpServer/tool/call', expect.objectContaining({ threadId: 'grandchild', server: 'fixture' }))
    await ensureCodexMcpAppThread(request, 'root', 'grandchild', {})
    expect(request.mock.calls.filter(([method]) => method === 'thread/resume')).toHaveLength(2)
  })

  it('does not authorize unrelated threads, ancestry cycles, or resume them', async () => {
    for (const thread of [{ source: 'cli' }, { source: { subAgent: { thread_spawn: { parent_thread_id: 'child' } } } }]) {
      const request = vi.fn<McpAppsRequest>(async () => ({ thread }))
      await expect(ensureCodexMcpAppThread(request, 'root', 'child')).rejects.toMatchObject({ code: 'inactive' })
      expect(request.mock.calls.every(([method]) => method === 'thread/read')).toBe(true)
    }
  })

  it('accepts fork ancestry but forgets failed restores so explicit Retry can try again', async () => {
    const request = vi.fn<McpAppsRequest>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ thread: { forkedFromId: 'root' } })
    await expect(ensureCodexMcpAppThread(request, 'root', 'child')).rejects.toThrow('offline')
    await ensureCodexMcpAppThread(request, 'root', 'child')
    expect(request).toHaveBeenLastCalledWith('thread/resume', { threadId: 'child' })
    request.mockClear()
    await ensureCodexMcpAppThread(request, 'root', 'root')
    expect(request).not.toHaveBeenCalled()
  })
})
