import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionLoadResult } from '@superone/shared/environment/session-messages'
import { appendHistory, dropIncompleteTail, mergeCachedHistory, RestoreRejectedError, restoreSession, snapshotFromLoad } from './restore'
import { DesktopUpgradeRequiredError } from './phone-protocol'

const resource = { environmentId: 'desk', sessionId: 's' }
const msg = (id: string): ChatMessage => ({ id, role: 'assistant', status: 'complete', providerId: 'claude', content: [{ type: 'text', text: id }], createdAt: '' })
it('hydrates omitted reducer defaults before exposing native restore facts to the mobile shell', () => {
  expect(snapshotFromLoad(load({ state: { sessionProvider: 'claude' } }), 'desk')).toMatchObject({
    status: 'idle', permissionMode: 'default', ultracode: false, contextTokens: 0, totalCostUsd: 0,
    realtimeSegments: [], activeRealtimeSessionId: null, goal: null,
  })
})
function load(overrides: Partial<SessionLoadResult> = {}): SessionLoadResult {
  return { sessionId: 's', state: { status: 'idle', sessionProvider: 'claude' }, messages: [], before: null, after: null, cursor: { sequence: '90', epoch: 'epoch', version: 12 }, ...overrides }
}
function client(first = load()) {
  const order: string[] = []
  return {
    order, startBuffering: vi.fn(() => order.push('buffer')), stopSession: vi.fn(async () => { order.push('stop') }),
    resolveProject: vi.fn(async () => ({ environmentId: 'desk', projectId: 'p' })),
    releaseBuffer: vi.fn(() => ({ epoch: 1, batches: [] as unknown[][] })),
    acquireControl: vi.fn(async () => { order.push('acquire') }), followSession: vi.fn(async () => { order.push('subscribe') }),
    rpc: vi.fn(async (method: string, _payload?: unknown, _options?: unknown): Promise<unknown> => {
      order.push(method)
      return method === 'environment.descriptor' ? { capabilities: { methods: ['session.historyIndex'] } } : first
    }),
  }
}
it('loads a bounded atomic page and complete state before acquiring and following its cursor', async () => {
  const state = { status: 'streaming', queuedMessages: [msg('queued')], todos: [{ content: 'work', status: 'pending' }], contextTokens: 3, sessionGoal: { objective: 'goal' } }
  const first = load({ messages: [msg('recent')], before: 500, activeTurn: [msg('live')], state })
  const remote = client(first), restored = await restoreSession(remote as never, '/p', 's')
  expect(remote.rpc).toHaveBeenCalledWith('session.load', { sessionId: 's', projectId: 'p', limit: 8 }, { environmentId: 'desk' })
  expect(remote.order.indexOf('acquire')).toBeGreaterThan(remote.order.indexOf('session.load'))
  expect(remote.order.at(-1)).toBe('subscribe')
  expect(remote.acquireControl).toHaveBeenCalledWith(resource)
  expect(remote.followSession).toHaveBeenCalledWith({ session: resource, projectPath: '/p', provider: undefined, cursor: first.cursor })
  expect(restored).toMatchObject({ state, hasMore: true, cursor: 500, navigationAvailable: true, snapshot: { sourceEnvironmentId: 'desk', inProgressMessages: [msg('live')], goal: state.sessionGoal } })
  expect(remote.releaseBuffer).toHaveBeenCalledOnce()
})
it('buffers through a synchronous subscription push and filters the snapshot version and foreign host', async () => {
  const remote = client()
  remote.followSession.mockImplementation(async () => {
    expect(remote.releaseBuffer).not.toHaveBeenCalled()
    remote.releaseBuffer.mockReturnValue({ epoch: 7, batches: [[
      { type: 'status_change', environmentId: 'desk', sessionId: 's', seq: 12 },
      { type: 'status_change', environmentId: 'other', sessionId: 's', seq: 15 },
      { type: 'status_change', environmentId: 'desk', sessionId: 's', seq: 13 },
    ]] })
  })
  expect(await restoreSession(remote as never, '/p', 's')).toMatchObject({ epoch: 7, liveBatches: [[{ seq: 13 }]] })
})
it('retains a contiguous older cache when the newest page overlaps it', async () => {
  const remote = client(load({ messages: [msg('b'), msg('c')], before: 1 }))
  const result = await restoreSession(remote as never, '/p', 's', { messages: [msg('a'), msg('b')], cursor: 9, hasMore: true })
  expect(result.messages.map(message => message.id)).toEqual(['a', 'b', 'c'])
  expect(result).toMatchObject({ cursor: 9, hasMore: true })
  expect(remote.rpc.mock.calls.filter(([method]) => method === 'session.load')).toHaveLength(1)
})
it('fills a gap after the last complete cache row and follows the final atomic page cursor', async () => {
  const remote = client(load({ messages: [msg('fresh')], before: 200 }))
  const final = load({ messages: [msg('next'), msg('fresh')], cursor: { sequence: '100', epoch: 'epoch', version: 22 } })
  const answer = remote.rpc.getMockImplementation()!
  remote.rpc.mockImplementation(async (method, payload, options) => (payload as { direction?: string })?.direction === 'after' ? final : answer(method, payload, options))
  const result = await restoreSession(remote as never, '/p', 's', { messages: [msg('old'), { ...msg('unfinished'), status: 'streaming' }], cursor: 8, hasMore: true })
  expect(remote.rpc).toHaveBeenCalledWith('session.load', { sessionId: 's', projectId: 'p', anchorId: 'old', direction: 'after', limit: 40, includeState: false }, { environmentId: 'desk' })
  expect(result.messages.map(message => message.id)).toEqual(['old', 'next', 'fresh'])
  expect(remote.followSession).toHaveBeenCalledWith(expect.objectContaining({ cursor: final.cursor }))
})
it('invalidates a removed anchor but propagates link failure during gap filling', async () => {
  for (const code of ['not_found', undefined]) {
    const remote = client(load({ messages: [msg('fresh')], before: 100 })), answer = remote.rpc.getMockImplementation()!
    remote.rpc.mockImplementation(async (method, payload, options) => {
      if ((payload as { direction?: string })?.direction === 'after') throw Object.assign(new Error('gone'), { code })
      return answer(method, payload, options)
    })
    const pending = restoreSession(remote as never, '/p', 's', { messages: [msg('old')], cursor: 4, hasMore: true })
    if (code) expect((await pending).messages.map(message => message.id)).toEqual(['fresh'])
    else await expect(pending).rejects.not.toBeInstanceOf(RestoreRejectedError)
  }
})
it('discards a cache when the atomic host catalog is empty', async () => {
  expect(await restoreSession(client() as never, '/p', 's', { messages: [msg('old')], cursor: 4, hasMore: true })).toMatchObject({ messages: [], cursor: null, hasMore: false })
})
it('releases the buffer on refusal, preserves upgrade-required, and never probes legacy commands', async () => {
  for (const error of [Object.assign(new Error('locked'), { code: 'failed_precondition' }), new Error('closed'), new DesktopUpgradeRequiredError()]) {
    const remote = client()
    remote.resolveProject.mockRejectedValue(error)
    const result = await restoreSession(remote as never, '/p', 's').catch(value => value)
    expect(result instanceof RestoreRejectedError).toBe('code' in error && error.code === 'failed_precondition')
    if (error instanceof DesktopUpgradeRequiredError) expect(result).toBe(error)
    expect(remote.rpc).not.toHaveBeenCalled()
    expect(remote.releaseBuffer).toHaveBeenCalledOnce()
  }
})
it('keeps merge helpers contiguous and drops an incomplete cache tail', () => {
  expect(mergeCachedHistory([msg('a'), msg('b')], [msg('b'), msg('c')]).messages.map(row => row.id)).toEqual(['a', 'b', 'c'])
  expect(appendHistory([msg('a')], [msg('a'), msg('b')]).map(row => row.id)).toEqual(['a', 'b'])
  expect(dropIncompleteTail([msg('a'), { ...msg('b'), status: 'streaming' }])).toEqual([msg('a')])
})
