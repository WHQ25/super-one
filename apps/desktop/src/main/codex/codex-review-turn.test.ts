import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/superone-test' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../providers/resolver', () => ({ resolveChatService: vi.fn(() => null) }))
vi.mock('../providers/llm-proxy-manager', () => ({ ensureCodexProxyUrl: vi.fn(async () => undefined) }))
vi.mock('../database', () => ({ getActiveProviderRaw: vi.fn(() => null), getProviderByIdRaw: vi.fn() }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { reviewCodexTurn } from './codex-turn'
import { createCodexSession } from './codex-session'

function fixture() {
  const session = createCodexSession('review-session', '/project', 'test-model', 'thread', undefined, 'default')
  session.threadReady = true
  session.effectiveCwd = '/project'
  const notes = [
    { method: 'item/completed', params: { threadId: 'thread', turnId: 'review', item: { id: 'entered', type: 'enteredReviewMode', review: 'current changes' } } },
    { method: 'turn/started', params: { threadId: 'thread', turn: { id: 'worker', rootTurnId: 'review' } } },
    { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'worker', rootTurnId: 'review', status: 'completed' } } },
    { method: 'item/completed', params: { threadId: 'thread', turnId: 'review', item: { id: 'exited', type: 'exitedReviewMode', review: 'Finding' } } },
    { method: 'item/completed', params: { threadId: 'thread', turnId: 'review', item: { id: 'result', type: 'agentMessage', text: 'Finding' } } },
    { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'review', rootTurnId: 'review', status: 'completed' } } },
  ]
  const request = vi.fn(async (method: string) => method === 'review/start' ? { turn: { id: 'review', rootTurnId: null } } : {})
  const next = vi.fn(async () => {
    const note = notes.shift()
    if (!note) throw new Error('No more notifications')
    return note
  })
  session.connectionAuth = { mode: 'auto' }
  session.connectionHandle = { connection: { request }, getStderr: () => '' } as never
  session.notificationDispatcher = { mainInbox: { next } } as never
  return { session, request, next, notes }
}

describe('inline Codex review', () => {
  it('keeps the submitted review identity, output and completion across a worker start', async () => {
    const { session, request, next } = fixture()
    const onTurnMetadata = vi.fn()
    const onTurnStarted = vi.fn()
    const result = await reviewCodexTurn(session, { mode: 'auto' }, '/project', { target: { type: 'uncommittedChanges' } }, { onTurnMetadata, onTurnStarted })
    expect(request).toHaveBeenCalledWith('review/start', { threadId: 'thread', delivery: 'inline', target: { type: 'uncommittedChanges' } })
    expect(result).toMatchObject({ turnId: 'review', finalResponse: 'Finding' })
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'review', phase: 'exited', text: 'Finding' })]))
    expect(next).toHaveBeenCalledTimes(6)
    expect(onTurnStarted).not.toHaveBeenCalled()
    expect(onTurnMetadata.mock.calls.map(([value]) => value.turnId)).toEqual(['review', 'review'])
    expect(session.activeTurnId).toBeNull()
    expect(session.interruptFn).toBeNull()
  })

  it('does not mistake the worker for a queued follow-up turn', async () => {
    const { session, notes } = fixture()
    notes.push(
      { method: 'turn/started', params: { threadId: 'thread', turn: { id: 'queued' } } },
      { method: 'item/started', params: { threadId: 'thread', turnId: 'queued', item: { id: 'user', type: 'userMessage', clientId: 'queued-user' } } },
      { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'queued', status: 'completed' } } },
    )
    let queued = true
    const onTurnStarted = vi.fn()
    const result = await reviewCodexTurn(session, { mode: 'auto' }, '/project', { target: { type: 'uncommittedChanges' } }, {
      onTurnStarted,
      hasQueuedMessages: () => queued,
      onQueuedMessageConsumed: () => { queued = false },
    })
    expect(onTurnStarted).toHaveBeenCalledExactlyOnceWith({ turnId: 'queued', queued: true })
    expect(result).toMatchObject({ turnId: 'queued', finalResponse: 'Finding' })
  })

  it('interrupts the submitted review rather than its internal worker', async () => {
    const { session, request, next } = fixture()
    next.mockImplementationOnce(async () => {
      expect(session.activeTurnId).toBe('review')
      await session.interruptFn?.()
      throw new Error('Codex run interrupted')
    })
    await expect(reviewCodexTurn(session, { mode: 'auto' }, '/project', { target: { type: 'uncommittedChanges' } })).rejects.toThrow('Codex run interrupted')
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread', turnId: 'review' })
    expect(session.activeTurnId).toBeNull()
    expect(session.interruptFn).toBeNull()
  })
})
