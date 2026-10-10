import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentGateway, SubscribeEventsInput } from '@superone/shared/environment'
import { executeEnvironmentCommand, releaseEnvironmentDevice } from './environment-commands'
import { routedHistory } from './environment-session-view'

const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), project: vi.fn(), acquire: vi.fn(), release: vi.fn(), renew: vi.fn(), load: vi.fn(), send: vi.fn(), stream: vi.fn() }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: m.list, getGateway: () => gateway }) }))
vi.mock('./environment-session-resources', () => ({ routedResources: vi.fn() }))
const ref = { environmentId: 'node', sessionId: 'same' }
const gateway = {
  sessions: { get: m.get, acquireControl: m.acquire, releaseControl: m.release, renewControl: m.renew, load: m.load, send: m.send }, getProject: m.project,
  subscribeEvents: (input: SubscribeEventsInput & { signal: AbortSignal }) => m.stream(input),
}
async function* idle(input: { signal: AbortSignal }) { await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true })) }
const loaded = (messages: ChatMessage[], version: number) => ({ sessionId: 'same', state: {}, messages, before: null, cursor: { sequence: '42', epoch: 'e', version } })
const message = (id: string, text: string, status: ChatMessage['status'] = 'complete'): ChatMessage =>
  ({ id, role: 'assistant', status, providerId: 'grok', createdAt: new Date(0).toISOString(), content: [{ type: 'text', text }] })
beforeEach(async () => {
  await releaseEnvironmentDevice('phone')
  vi.clearAllMocks()
  m.list.mockResolvedValue([{ environmentId: 'node', connectionId: 'route', kind: 'remote' }])
  m.get.mockResolvedValue({ projectId: 'p', harnessId: 'acp', providerId: 'grok', status: 'idle' })
  m.project.mockResolvedValue({ path: '/app' })
  m.acquire.mockResolvedValue({ leaseId: 'lease', generation: 4 })
  m.release.mockResolvedValue(undefined)
  m.renew.mockResolvedValue({ leaseId: 'lease', generation: 4 })
  m.load.mockResolvedValue(loaded([], 3))
  m.stream.mockImplementation(idle)
})
describe('paired phone environment route', () => {
  it('requires the explicit owning project before acquiring control', async () => {
    await expect(executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/other', sessionId: 'same' }, 'phone', vi.fn())).rejects.toThrow('project mismatch')
    expect(m.acquire).not.toHaveBeenCalled()
  })
  it('prepares a baseline, retains images and turn settings, and cleans up after host removal', async () => {
    const result = await executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/app', sessionId: 'same' }, 'phone', vi.fn())
    expect(result).toMatchObject({ snapshot: { sourceEnvironmentId: 'node' } })
    // Held for this phone, not for the desktop as a whole.
    expect(m.acquire).toHaveBeenCalledWith(expect.objectContaining({ resource: ref, delegate: 'phone' }))
    const images = [{ id: 'img', name: 'a.png', mimeType: 'image/png', base64: 'AA==' }]
    await executeEnvironmentCommand('node', { type: 'send_message', projectPath: '/app', sessionId: 'same', content: 'Hello', images, model: 'actual-model', serviceTier: 'fast', inputRequest: { requestId: 'form', answers: {} } } as never, 'phone', vi.fn())
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ session: ref, leaseId: 'lease', generation: 4, options: expect.objectContaining({ images, model: 'actual-model', serviceTier: 'fast', inputRequest: expect.anything() }) }))
    m.list.mockResolvedValue([])
    await executeEnvironmentCommand('node', { type: 'unsubscribe_session', sessionId: 'same' }, 'phone', vi.fn())
    expect(m.release).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'lease' }))
  })
  it('releases a newly acquired lease on a failed bootstrap', async () => {
    m.load.mockRejectedValue(new Error('offline'))
    await expect(executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/app', sessionId: 'same' }, 'phone', vi.fn())).rejects.toThrow('offline')
    expect(m.release).toHaveBeenCalledOnce()
  })
  it('follows from the snapshot it opened at, and repairs the phone when the node lost events it missed', async () => {
    const send = vi.fn(async () => {})
    m.load.mockResolvedValueOnce(loaded([message('a', 'Hel', 'streaming')], 3)).mockResolvedValueOnce(loaded([message('a', 'Hello'), message('b', 'Next')], 9))
    m.stream.mockImplementation(async function* (input: SubscribeEventsInput & { signal: AbortSignal }) {
      expect(input).toMatchObject({ afterSequence: '42', epoch: 'e', versions: { same: 3 } })
      input.onResnapshot?.(['same'])
      // Already reflected by the repaired snapshot.
      yield { aggregateType: 'session', aggregateId: 'same', sessionVersion: 9, eventType: 'session.agent_event', payload: { event: { type: 'content_delta', messageId: 'b', delta: { type: 'text', text: 'dup' } } } }
      yield* idle(input)
    })
    const result = await executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/app', sessionId: 'same' }, 'phone', send)
    expect(result).toMatchObject({ historyPage: { cursor: null, hasMore: false } })
    await vi.waitFor(() => expect(send.mock.calls.map(([event]) => (event as AgentEvent).type)).toEqual(['content_delta', 'message_complete', 'message_start']))
    expect(send.mock.calls[0]![0]).toMatchObject({ messageId: 'a', delta: { type: 'text', text: 'lo' } })
  })
})
describe('routed history anchors', () => {
  it('never repeats older messages in a short page after an anchor near the end', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i), role: 'user' as const, text: String(i), sortOrder: i, createdAt: i + 1 }))
    const listMessages = vi.fn(async (input: { cursor?: string | number | null; limit?: number }) => {
      const end = input.cursor == null ? rows.length : Math.min(rows.length, Number(input.cursor))
      const start = Math.max(0, end - (input.limit ?? 24))
      return { sessionId: 'same', messages: rows.slice(start, end), cursor: start ? String(start) : null, hasMore: start > 0 }
    })
    const historyGateway = { sessions: { listMessages } } as unknown as EnvironmentGateway
    const page = await routedHistory(historyGateway, ref, 'acp', { anchorId: '4', direction: 'after', limit: 24 })
    expect(page.messages.map(row => row.id)).toEqual(['5'])
    expect(page).toMatchObject({ startIndex: 5, endIndex: 6, totalCount: 6 })
    expect((await routedHistory(historyGateway, ref, 'acp', { anchorId: '5', direction: 'after' })).messages).toEqual([])
    expect((await routedHistory(historyGateway, ref, 'acp', { anchorId: '0', direction: 'before' })).messages).toEqual([])
  })
})
