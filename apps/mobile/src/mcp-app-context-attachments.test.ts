import { describe, expect, it, vi } from 'vitest'
import { McpAppContextAttachments } from './mcp-app-context-attachments'
import { ChatRuntime } from './runtime'
import { findMcpAppAttachment, type McpAppContextSource } from '@superone/shared/mcp-apps-state'

const source: McpAppContextSource = { messageId: 'old-message', app: { appInstanceId: 'view', status: 'result', resourceUri: 'ui://app', binding: { node: 'local', session: 's', server: 'CAD', configGeneration: 1, configFingerprint: 'config' }, modelContext: { updateId: 'r1', content: [{ type: 'text', text: 'Selected bolt', _meta: { 'openai/title': 'Bolt' } }], source: { appInstanceId: 'view', server: 'CAD' } } } }

describe('phone context independent of transcript pagination', () => {
  it('restores a chip for an unloaded old View, scopes removal, and waits for the durable clear', async () => {
    const state = new McpAppContextAttachments()
    state.restore([source])
    const [chip] = state.items([])
    const client = { request: vi.fn(async () => ({ response: { ok: true, value: null } })) }
    await state.remove(chip.id, client, { projectPath: '/p', sessionId: 's' }, [])
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/p', sessionId: 's', request: { operation: 'removeModelContext', appInstanceId: 'view', messageId: 'old-message', updateId: 'r1', blockIndex: 0 } }), 35_000)
    expect(state.items([])).toHaveLength(1)
    state.capture({ type: 'mcp_app_updated', messageId: 'old-message', appInstanceId: 'view', update: { modelContext: null } }, [])
    expect(state.items([])).toEqual([])
    expect(state.snapshot()).toEqual([])
  })

  it('keeps denied removal visible, and a clear snapshot overrides stale cached blocks', async () => {
    const state = new McpAppContextAttachments()
    state.restore([source])
    const client = { request: vi.fn(async () => ({ response: { ok: false, error: { code: 'denied', message: 'Disconnected' } } })) }
    await expect(state.remove(state.items([])[0].id, client, { projectPath: '/p', sessionId: 's' }, [])).rejects.toThrow('Disconnected')
    expect(state.items([])).toHaveLength(1)
    state.restore([])
    const old = [{ id: 'old-message', metadata: { codex: { items: [{ app: source.app }] } } }]
    expect(state.items(old)).toEqual([])
    expect(state.reconcile(old)[0].metadata.codex.items[0].app.modelContext).toBeNull()
  })

  it('never revives a cleared context from a delayed provider attachment delta', () => {
    const state = new McpAppContextAttachments()
    state.restore([])
    state.capture({ type: 'content_delta', messageId: 'old-message', delta: { type: 'tool_result', toolUseId: 'call', summary: '', app: source.app } }, [])
    expect(state.items([])).toEqual([])
    state.restore(undefined)
    state.capture({ type: 'content_delta', messageId: 'old-message', delta: { type: 'tool_result', toolUseId: 'call', summary: '', app: source.app } }, [{ id: 'old-message', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app: { ...source.app, modelContext: null } }] }])
    expect(state.snapshot()).toBeUndefined()
  })

  it('hydrates authoritative context on runtime open even when the old message is outside the history page', async () => {
    const client = {
      startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }),
      request: vi.fn(async (command: { type: string; cursor?: number }) => command.type === 'get_session_state'
        ? { status: 'idle', mcpAppContexts: [source] } : command.type === 'load_session_messages' ? command.cursor === 99
          ? { messages: [{ id: 'old-message', role: 'assistant', content: [], timestamp: 0, metadata: { codex: { items: [{ app: source.app }] } } }], hasMore: false }
          : { messages: [], hasMore: true, cursor: 99 } : { ok: true }),
    }
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 's')
    expect(runtime.messages).toEqual([])
    expect(runtime.contextAttachments[0]).toMatchObject({ title: 'Bolt', messageId: 'old-message' })
    runtime.ingest([{ type: 'mcp_app_updated', messageId: 'old-message', appInstanceId: 'view', update: { modelContext: null } }])
    expect(runtime.contextAttachments).toEqual([])
    const older = await runtime.loadEarlier()
    expect(findMcpAppAttachment(older, 'view')?.app.modelContext).toBeNull()
    expect(findMcpAppAttachment(runtime.messages, 'view')?.app.modelContext).toBeNull()
    expect(runtime.contextAttachments).toEqual([])
    runtime.dispose()
  })


  it('captures buffered context updates against fresh restore messages rather than stale local cache', async () => {
    const message = { id: 'old-message', role: 'assistant', content: [], timestamp: 0, metadata: { codex: { items: [{ app: { ...source.app, modelContext: null } }] } } }
    const client = {
      startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [[{ type: 'mcp_app_updated', messageId: 'old-message', appInstanceId: 'view', update: { modelContext: source.app.modelContext } }]] }),
      request: vi.fn(async (command: { type: string }) => command.type === 'get_session_state'
        ? { status: 'idle', mcpAppContexts: [], inProgressMessages: [message] }
        : command.type === 'load_session_messages' ? { messages: [], hasMore: false } : { ok: true }),
    }
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 's')
    expect(runtime.contextAttachments[0]).toMatchObject({ title: 'Bolt', updateId: 'r1' })
    runtime.dispose()
  })
})
