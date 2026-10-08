import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../mobile/src/runtime'
import { buildRemoteSessionSnapshot } from './agent/remote-session-snapshot'
import { rowToChatMessage } from './session/session-repo'

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./session/realtime-timeline-repo', () => ({ loadRealtimeTimeline: () => null }))

afterEach(() => vi.useRealTimers())

describe('opening a running session from mobile', () => {
  it.each(['claude', 'codex'])('overrides interrupted history before the first %s paint', async (providerId) => {
    vi.useFakeTimers()
    const running: ChatMessage = {
      id: 'reply', role: 'assistant', status: 'streaming', providerId, createdAt: '',
      content: [{ type: 'text', text: 'Still working' }],
    }
    const persisted = rowToChatMessage({
      id: running.id, session_id: 'session', role: running.role, status: running.status,
      content_json: JSON.stringify(running.content), created_at: '', provider_id: providerId,
      metadata_json: null, checkpoint_id: null, resume_point_id: null,
    })
    expect(persisted.status).toBe('interrupted')
    // A row completed in memory may still have its last streaming checkpoint on disk.
    const earlier = { ...running, id: 'earlier', status: 'complete' as const }
    const staleEarlier = { ...persisted, id: 'earlier' }
    const host = {
      snapshot: { messages: [earlier, running], harnessId: providerId },
      isStreaming: () => true,
      getPendingInteractions: () => [],
      getQueuedMessagesEvent: () => null,
      getCurrentSandboxInfo: () => undefined,
      getCurrentPermissionMode: () => 'default',
      getUiSettings: () => ({}), getSessionGoal: () => null,
    }
    const client = {
      startBuffering() {},
      releaseBuffer: () => ({ epoch: 1, batches: [] }),
      request: async (command: { type: string }) => {
        if (command.type === 'load_session_messages') return { messages: [staleEarlier, persisted], hasMore: false, provider: providerId }
        if (command.type === 'get_session_state') return buildRemoteSessionSnapshot(host as never, '/project', 'session')
        return { ok: true }
      },
    }
    const paint = vi.fn()
    const runtime = new ChatRuntime(client as never, paint)
    await runtime.open('/project', 'session')
    expect(paint).toHaveBeenCalledTimes(1)
    expect(paint).toHaveBeenCalledWith(expect.objectContaining({
      status: 'streaming', messages: [
        expect.objectContaining({ id: 'earlier', status: 'complete' }),
        expect.objectContaining({ id: 'reply', status: 'streaming' }),
      ],
    }), true)
    expect(runtime.streaming).toBe(true)
    runtime.ingest([{ type: 'content_delta', messageId: 'reply', delta: { type: 'text', text: ' now' } }])
    expect(runtime.messages[1]).toMatchObject({ status: 'streaming', content: [{ text: 'Still working now' }] })
    runtime.ingest([{ type: 'message_interrupted', messageId: 'reply' }])
    expect(runtime.messages[1].status).toBe('interrupted')
    runtime.dispose()
  })
})


it('restores all composer context from passive history without sending View HTML or tool output', async () => {
  const app = { appInstanceId: 'view', status: 'result' as const, resourceUri: 'ui://cad',
    binding: { node: 'local', session: 'session', server: 'CAD', configGeneration: 1, configFingerprint: 'config' },
    resource: { html: 'private-html', hash: 'hash', meta: {} }, toolResult: { content: [], _meta: { private: 'tool-private' } },
    modelContext: { updateId: 'r1', content: [{ type: 'text', text: 'Selected part' }], source: { appInstanceId: 'view', server: 'CAD' } } }
  const history: ChatMessage[] = [{ id: 'old-view', role: 'assistant', status: 'complete', createdAt: '',
    content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app }] }]
  const restored = await buildRemoteSessionSnapshot(null, '/project', 'session', true, history)
  expect(restored.inProgressMessages).toEqual([])
  expect(restored.mcpAppContexts).toHaveLength(1)
  expect(restored.mcpAppContexts[0]).toMatchObject({ messageId: 'old-view', app: { modelContext: { updateId: 'r1' } } })
  expect(JSON.stringify(restored.mcpAppContexts)).not.toMatch(/private-html|tool-private/)
})

it('opens a session on the phone with the Ultracode the desktop session runs with', async () => {
  const host = {
    snapshot: { messages: [], harnessId: 'claude' },
    isStreaming: () => false,
    getPendingInteractions: () => [],
    getQueuedMessagesEvent: () => null,
    getCurrentSandboxInfo: () => undefined,
    getCurrentPermissionMode: () => 'default',
    getUiSettings: () => ({ ultracode: true }), getSessionGoal: () => null,
  }
  const client = {
    startBuffering() {},
    releaseBuffer: () => ({ epoch: 1, batches: [] }),
    request: async (command: { type: string }) => command.type === 'get_session_state'
      ? buildRemoteSessionSnapshot(host as never, '/project', 'session')
      : command.type === 'load_session_messages' ? { messages: [], hasMore: false, provider: 'claude' } : { ok: true },
  }
  const runtime = new ChatRuntime(client as never, () => {})
  await runtime.open('/project', 'session')
  expect(runtime.session.ultracode).toBe(true)
  runtime.dispose()
})
