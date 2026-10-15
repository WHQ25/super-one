import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '@superone/runtime/db'
import { CollaborationWakeQueue } from '@superone/runtime/collaboration'
import type { AgentEvent } from '@superone/shared/agent-types'
import { FakeBackend } from './session-test-backend'
import type { SendDelivery } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../mcp/config-tools', () => ({ resolveConfigConfirm: () => false, rejectConfigConfirm: () => false }))
vi.mock('../mcp/media-tools', () => ({ resolveVideoConfirm: () => false, rejectVideoConfirm: () => false }))
vi.mock('../mcp/miniapp-call-confirm', () => ({ resolveMiniappCallConfirm: () => false, rejectMiniappCallConfirm: () => false }))
vi.mock('../mcp/browser-webmcp-confirm', () => ({ resolveWebmcpTrustConfirm: () => false, rejectWebmcpTrustConfirm: () => false }))
vi.mock('../computer-use/grant-request', () => ({ resolveComputerUseGrant: () => false, rejectComputerUseGrant: () => false }))
vi.mock('../acp/acp-recap-focus', () => ({ notifySessionRecapForeground: vi.fn(), notifySessionRecapSessionRemoved: vi.fn() }))

import { Session } from './session'

describe('collaboration inbox to Session admission', () => {
  let db: NodeDatabase
  let queue: CollaborationWakeQueue
  afterEach(() => { queue?.dispose(); db?.close() })

  it('keeps the wake unconfirmed until the backend accepts its input', async () => {
    db = openNodeDatabase(':memory:')
    const backend = new FakeBackend()
    let accept!: () => void
    backend.send = vi.fn(async (_request, delivery?: SendDelivery) => {
      accept = () => delivery?.onInputAccepted()
      await new Promise<void>((resolve) => { backend.resolveSend = resolve })
    })
    const session = new Session({ id: 'parent', projectPath: process.cwd(), cwd: process.cwd(),
      providerId: 'claude-base', harnessId: 'claude', providerConfig: {}, backend })
    queue = new CollaborationWakeQueue(db, { admit: (_id, content, notificationId, onInputAccepted, beforeInput) =>
      session.admitTaskNotification(content, { clientMessageId: notificationId, onInputAccepted, beforeInput }), warn: vi.fn() })
    queue.enqueue('parent', 'stop:child:1', 'Your collaboration child stopped.')
    await vi.waitFor(() => expect(backend.send).toHaveBeenCalledTimes(1))
    expect(db.prepare('SELECT state FROM collaboration_wakes').get()).not.toMatchObject({ state: 'admitted' })
    // Once the backend reaches its handoff callback, a later pause must not
    // throw through backend state that has already opened the turn.
    queue.observe('parent', { type: 'message_interrupted', messageId: 'late-stop' })
    expect(() => accept()).not.toThrow()
    await vi.waitFor(() => expect(db.prepare('SELECT state FROM collaboration_wakes').get()).toMatchObject({ state: 'admitted' }))
    backend.resolveSend?.()
  })

  it('retains an undelivered wake when backend rebuild fails after send-chain admission', async () => {
    db = openNodeDatabase(':memory:')
    const backend = new FakeBackend()
    backend.rebuild = vi.fn(async () => { throw new Error('rebuild failed') })
    const session = new Session({ id: 'parent', projectPath: process.cwd(), cwd: process.cwd(),
      providerId: 'claude-base', harnessId: 'claude', providerConfig: {}, backend })
    session.markNeedsRebuild()
    queue = new CollaborationWakeQueue(db, { admit: (_id, content, notificationId, onInputAccepted, beforeInput) =>
      session.admitTaskNotification(content, { clientMessageId: notificationId, onInputAccepted, beforeInput }), warn: vi.fn() })
    queue.enqueue('parent', 'stop:child:1', 'Your collaboration child stopped.')
    await vi.waitFor(() => expect(backend.rebuild).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(db.prepare('SELECT state, last_error FROM collaboration_wakes').get())
      .toMatchObject({ state: 'queued', last_error: 'rebuild failed' }))
    expect(backend.sendCalls).toHaveLength(0)
  })

  it.each(['backend continuation', 'human stop'])('defers a prepared wake after %s before the input handoff', async (reason) => {
    db = openNodeDatabase(':memory:')
    const backend = new FakeBackend()
    let finishRebuild!: () => void
    backend.rebuild = vi.fn(() => new Promise<void>((resolve) => { finishRebuild = resolve }))
    const send = backend.send.bind(backend)
    backend.send = async (request, delivery?: SendDelivery) => { delivery?.onInputAccepted(); await send(request) }
    const session = new Session({ id: 'parent', projectPath: process.cwd(), cwd: process.cwd(),
      providerId: 'claude-base', harnessId: 'claude', providerConfig: {}, backend })
    session.markNeedsRebuild()
    queue = new CollaborationWakeQueue(db, {
      canAdmit: () => !session.isStreaming(),
      admit: (_id, content, clientMessageId, onInputAccepted, beforeInput) => session.admitTaskNotification(content, { clientMessageId, onInputAccepted, beforeInput }),
      warn: vi.fn(),
    })
    session.on((event, replay) => { if (!replay) { queue.observe('parent', event); if (event.type === 'status_change') queue.start() } })
    queue.enqueue('parent', 'message:1', 'new mail')
    await vi.waitFor(() => expect(backend.rebuild).toHaveBeenCalledTimes(1))
    expect(db.prepare('SELECT state FROM collaboration_wakes').get()).toMatchObject({ state: 'preparing' })
    if (reason === 'backend continuation') {
      backend.emit({ type: 'message_start', message: { id: 'continuation', role: 'assistant', status: 'streaming', content: [], createdAt: '' } })
      backend.emit({ type: 'status_change', status: 'streaming' })
      backend.emit({ type: 'content_delta', messageId: 'continuation', delta: { type: 'text', text: 'background continuation' } })
    } else backend.emit({ type: 'message_interrupted', messageId: 'manual-stop' })
    expect(db.prepare('SELECT state FROM collaboration_wakes').get()).toMatchObject({ state: 'preparing' })
    finishRebuild()
    await vi.waitFor(() => expect(db.prepare('SELECT state, attempts FROM collaboration_wakes').get())
      .toMatchObject({ state: 'queued', attempts: 0 }))
    expect(backend.sendCalls).toHaveLength(0)
    backend.emit({ type: 'status_change', status: 'idle' })
    if (reason === 'human stop') {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(backend.sendCalls).toHaveLength(0)
      backend.emit({ type: 'message_complete', messageId: 'manual-recovery' })
    }
    await vi.waitFor(() => expect(db.prepare('SELECT state, attempts FROM collaboration_wakes').get())
      .toMatchObject({ state: 'admitted', attempts: 1 }))
    expect(backend.sendCalls).toHaveLength(1)
    backend.resolveSend?.()
  })

  it.each(['claude', 'codex', 'acp'] as const)(
    'admits a %s wake through Session once, without retrying the ensuing provider error', async (harnessId) => {
      db = openNodeDatabase(':memory:')
      const backend = new FakeBackend()
      const send = backend.send.bind(backend)
      backend.send = async (request, delivery?: SendDelivery) => { delivery?.onInputAccepted(); await send(request) }
      backend.injectTaskNotification = vi.fn(async () => 'deferred' as const)
      const session = new Session({
        id: 'parent', projectPath: process.cwd(), cwd: process.cwd(), providerId: `${harnessId}-base`,
        harnessId, providerConfig: {}, backend,
      })
      const events: AgentEvent[] = []
      session.on((event, replay) => { events.push(event); if (!replay) queue?.observe('parent', event) })
      queue = new CollaborationWakeQueue(db, {
        admit: (_id, content, notificationId, onInputAccepted, beforeInput) => session.admitTaskNotification(content, { clientMessageId: notificationId, onInputAccepted, beforeInput }),
        warn: vi.fn(),
      })
      queue.enqueue('parent', 'stop:child:1', 'Your collaboration child stopped. Call session_collab_retrieve.')
      await vi.waitFor(() => expect(backend.sendCalls).toHaveLength(1))
      expect(backend.injectTaskNotification).not.toHaveBeenCalled()
      expect(backend.sendCalls[0]).toMatchObject({ clientMessageId: 'stop:child:1', source: 'task-notification' })
      expect(db.prepare('SELECT state FROM collaboration_wakes').get()).toMatchObject({ state: 'admitted' })
      backend.emit({ type: 'message_start', message: { id: 'error-1', role: 'assistant', status: 'streaming', content: [], createdAt: '' } })
      backend.emit({ type: 'message_error', messageId: 'error-1', error: 'not deliverable', errorInfo: { raw: 'not deliverable', code: 'rate_limit', httpStatus: 429 } })
      backend.emit({ type: 'status_change', status: 'error' })
      backend.resolveSend?.()
      queue.enqueue('parent', 'stop:child:1', 'Your collaboration child stopped. Call session_collab_retrieve.')
      queue.start()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(backend.sendCalls).toHaveLength(1)
      queue.enqueue('parent', 'stop:child:2', 'Another child stopped.')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(backend.sendCalls).toHaveLength(1)
      expect(db.prepare("SELECT state FROM collaboration_wakes WHERE notification_id = 'stop:child:2'").get()).toMatchObject({ state: 'queued' })
      expect(events.some((event) => event.type === 'message_error')).toBe(true)
      expect(events.some((event) => event.type === 'user_message_appended')).toBe(false)
    },
  )
})
