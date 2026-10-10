import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../../mobile/src/runtime'
const { history, timeline } = vi.hoisted(() => ({ history: vi.fn(), timeline: vi.fn(() => null as unknown) }))
vi.mock('../db-sessions', () => ({ loadSessionMessagesPaginated: history }))
vi.mock('../session/realtime-timeline-repo', () => ({ loadRealtimeTimeline: timeline }))
vi.mock('../environment/session-identity', () => ({ localSessionEnvironmentId: () => 'desktop' }))
import { ConnectionDelivery, deliveryPolicy } from '@superone/runtime/stream'
import { buildProgressiveBootstrap } from './progressive-bootstrap'

it('hydrates the current live state from one bounded bootstrap without hidden bodies', async () => {
  const source: ChatMessage = { id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
    { type: 'thinking', thinking: 'hidden reasoning' },
    { type: 'tool_use', toolName: 'Write', toolUseId: 't', input: '{"file_path":"a.ts","content":"hidden code"}' },
  ] }
  history.mockReturnValue({ messages: [{ ...source, status: 'interrupted' }], hasMore: true, cursor: 100 })
  const host = { snapshot: { harnessId: 'claude', messages: [source] }, isStreaming: () => true,
    getPendingInteractions: () => [], getQueuedMessagesEvent: () => null, getCurrentSandboxInfo: () => undefined, getCurrentPermissionMode: () => 'default', getUiSettings: () => ({}), getSessionGoal: () => null }
  const phone = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
  phone.views.open('s')
  const request = vi.fn(async () => buildProgressiveBootstrap(host as never, '/p', 's', phone))
  const runtime = new ChatRuntime({ request, startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }) } as never, vi.fn())
  await runtime.open('/p', 's')
  expect(runtime.sourceEnvironmentId).toBe('desktop')
  expect(request).toHaveBeenCalledTimes(1)
  expect(history).toHaveBeenCalledWith('s', 8)
  expect(runtime.messages[0]?.status).toBe('streaming')
  expect(runtime.hasMoreHistory).toBe(true)
  expect(JSON.stringify(runtime.messages)).not.toMatch(/hidden reasoning|hidden code/)
  expect(runtime.messages[0]?.content[1]).toMatchObject({ toolName: 'Write', toolLineDelta: { added: 1, removed: 0 } })
  expect(source.content[0]).toMatchObject({ thinking: 'hidden reasoning' })
  runtime.dispose()
})

it('restores older delegated work beyond the current page without sending its hidden detail', async () => {
  const old: ChatMessage = { id: 'old-task', role: 'assistant', status: 'complete', providerId: 'codex', createdAt: '',
    content: [{ type: 'thinking', thinking: 'Hidden older reasoning' }],
    metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 2 } } }
  const latest: ChatMessage = { id: 'latest', role: 'user', status: 'complete', content: [{ type: 'text', text: 'New typed task' }], createdAt: '' }
  history.mockReturnValue({ messages: [latest], hasMore: true, cursor: 100 })
  // No provider refresh yet: the durable local delegation must still supply its marker.
  timeline.mockReturnValue({ hasTimeline: true, activeRealtimeSessionId: null,
    segments: [{ id: 'voice', role: 'user', text: 'Earlier spoken task', realtimeSessionId: 'rt', localOrder: 1 }], threadMessages: [] })
  const host = { snapshot: { harnessId: 'codex', messages: [old, latest] }, isStreaming: () => false,
    getApiProviderId: () => null,
    getPendingInteractions: () => [], getQueuedMessagesEvent: () => null, getCurrentSandboxInfo: () => undefined,
    getCurrentPermissionMode: () => 'default', getUiSettings: () => ({}), getSessionGoal: () => null }
  const request = vi.fn(async () => buildProgressiveBootstrap(host as never, '/p', 's'))
  const runtime = new ChatRuntime({ request, startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }) } as never, vi.fn())
  await runtime.open('/p', 's')
  expect(runtime.session.realtimeThreadMessages).toMatchObject([{ id: 'old-task', metadata: { codexTimeline: { localOrder: 2 } } }])
  expect(JSON.stringify(runtime.session.realtimeThreadMessages)).not.toContain('Hidden older reasoning')
  expect(runtime.session.realtimeSegments).toHaveLength(1)
  runtime.dispose()
  timeline.mockReturnValue(null)
})
