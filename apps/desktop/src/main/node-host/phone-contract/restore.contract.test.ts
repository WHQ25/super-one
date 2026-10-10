import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, RealtimeTimelineResult } from '@superone/shared/agent-types'
import type { SessionLoadResult } from '@superone/shared/environment'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

function message(id: string, role: ChatMessage['role'], content: ChatMessage['content'] = []): ChatMessage {
  return { id, role, content, status: 'complete', providerId: 'claude', createdAt: '' }
}

describe('phone endpoint: restore and history', () => {
  it('refuses a session loaded through a different project', async () => {
    const { domain } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    await expect(phone.rpc('session.load', { projectId: 'other', sessionId: 'own', limit: 8 })).rejects.toMatchObject({ code: 'not_found' })
    await expect(phone.rpc('session.load', { projectId: 1, sessionId: 'own' })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(await phone.rpc('session.load', { projectId: 'p1', sessionId: 'own', limit: 8 })).toMatchObject({ sessionId: 'own' })
  })
  it.each(['lan', 'relay'] as const)('restores host facts, pending controls and the active turn outside its page over %s', async (transport) => {
    const timeline: RealtimeTimelineResult = { segments: [{ id: 'voice', role: 'user', realtimeSessionId: 'rt', text: 'Continue' }], activeRealtimeSessionId: 'rt', threadMessages: [], hasTimeline: true }
    const { domain, own, store, sessions, projectDir } = phoneDomain(cleanup, { restore: { realtime: () => timeline } })
    const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: domain.identity.environmentId, session: 'own', server: 'fixture', configGeneration: 1, configFingerprint: 'cfg' }, resourceUri: 'ui://fixture/view', status: 'result', resource: { hash: 'a'.repeat(64), html: 'private View HTML', meta: {} }, modelContext: { updateId: 'selected', content: [{ type: 'text', text: 'selected row' }], source: { appInstanceId: 'view', server: 'fixture' } } }
    const messages = [
      message('old-u', 'user'),
      message('old-app', 'assistant', [{ type: 'tool_use', toolName: 'fixture', toolUseId: 'tool', input: '{}', status: 'complete', app }]),
      message('new-u', 'user'),
      message('finished-tool', 'assistant', [{ type: 'thinking', thinking: 'long thought' }]),
      { ...message('stream', 'assistant', [{ type: 'text', text: 'Partial answer' }]), status: 'streaming' as const },
    ]
    Object.defineProperty(own, 'snapshot', { get: () => ({ harnessId: 'claude', messages, contextTokens: 82_400, totalCostUsd: 0.42, isWorktree: true, worktreePath: `${projectDir}/wt`, gitBranch: 'feature', worktreeMissing: true }) })
    Object.assign(own, { status: 'streaming', permissionMode: 'plan', sandbox: { enabled: true, autoAllowBash: false }, getSessionGoal: () => ({ objective: 'Ship it', status: 'paused' }), getUiSettings: () => ({ ultracode: true }), getReplayEvents: () => [{ type: 'queued_messages_changed', messages: [message('queued', 'user')] }, { type: 'todos_updated', todos: [{ id: 'todo', content: 'Verify', status: 'in_progress' }] }] })
    own.pending = [{ type: 'ask_user_question', request: { requestId: 'ask', questions: [] } }]
    const phone = await connectPhone(domain, { transport })
    cleanup.push(phone.close)
    const loaded = await phone.rpc<SessionLoadResult>('session.load', { sessionId: 'own', limit: 1 })
    expect(loaded.state).toMatchObject({ status: 'streaming', pendingQuestion: { requestId: 'ask' }, queuedMessages: [{ id: 'queued' }], todos: { todo: { content: 'Verify' } }, permissionMode: 'plan', ultracode: true, sessionGoal: { objective: 'Ship it', status: 'paused' }, contextTokens: 82_400, totalCostUsd: 0.42, realtimeSegments: timeline.segments, realtimeSessionId: 'rt', _worktreeRemoved: true })
    expect(loaded.restore).toMatchObject({ sourceEnvironmentId: domain.identity.environmentId, sandboxInfo: { enabled: true, autoAllowBash: false }, isWorktree: true, worktreePath: `${projectDir}/wt`, gitBranch: 'feature', worktreeMissing: true, mcpAppContexts: [{ messageId: 'old-app', app: { appInstanceId: 'view', modelContext: app.modelContext } }] })
    expect(loaded.restore?.mcpAppContexts[0].app.resource).toBeUndefined()
    expect(loaded.messages.map(row => row.id)).toEqual(['stream'])
    expect(loaded.activeTurn?.map(row => row.id)).toEqual(['new-u', 'finished-tool'])
    expect(loaded.activeTurn?.[1].content[0]).toMatchObject({ thinking: '', remoteDetail: '["finished-tool","thinking",0]' })
    expect(messages[3].content[0]).toEqual({ type: 'thinking', thinking: 'long thought' })

    const history = await phone.rpc<SessionLoadResult>('session.load', { sessionId: 'own', before: 2, limit: 2, includeState: false })
    expect(history.messages.map(row => row.id)).toEqual(['old-u', 'old-app'])
    expect(history.state).toEqual({})
    expect(history.restore).toBeUndefined()
    expect(history.activeTurn).toBeUndefined()
    expect(history.cursor).toEqual(loaded.cursor)

    store.rows.set('own', { ...store.rows.get('own')!, isWorktree: true, worktreePath: `${projectDir}/wt`, gitBranch: 'feature', contextTokens: 82_400, totalCostUsd: 0.42 })
    store.all.loadMessages = () => ({ messages, cursor: null, hasMore: false })
    sessions.live.delete('own')
    // A persisted row still exposes its host facts after the runtime is unloaded.
    const cold = await phone.rpc<SessionLoadResult>('session.load', { sessionId: 'own', limit: 1 })
    expect(cold.restore).toMatchObject({ isWorktree: true, worktreePath: `${projectDir}/wt`, gitBranch: 'feature', mcpAppContexts: [{ messageId: 'old-app' }] })
    expect(cold.state).toMatchObject({ contextTokens: 82_400, totalCostUsd: 0.42, realtimeSessionId: 'rt' })
    expect(cold.activeTurn).toBeUndefined()
  })

  it('reads state and cursor after asynchronous preparation, including events that arrive while it waits', async () => {
    let ready!: () => void
    const { domain, own } = phoneDomain(cleanup, { restore: { prepare: () => new Promise(resolve => { ready = () => resolve(undefined) }) } })
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const reading = phone.rpc<SessionLoadResult>('session.load', { sessionId: 'own' })
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'))
    own.emitHostEvent({ type: 'user_message_appended', message: message('during-wait', 'user') })
    ready()
    const loaded = await reading
    expect(loaded.messages.map(row => row.id)).toEqual(['during-wait'])
    expect(loaded.cursor).toEqual({ sequence: domain.localSessions.snapshotSequence(), epoch: domain.localSessions.streamEpoch(), version: 1 })
  })

  it('pages around stable message anchors and rejects removed anchors or malformed bounds', async () => {
    const { domain, own } = phoneDomain(cleanup)
    const messages = Array.from({ length: 8 }, (_, i) => message(`m${i}`, i % 2 ? 'assistant' : 'user'))
    Object.defineProperty(own, 'snapshot', { get: () => ({ harnessId: 'claude', messages }) })
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const page = (direction: string) => phone.rpc<SessionLoadResult>('session.load', { sessionId: 'own', anchorId: 'm3', direction, limit: 3 })
    expect((await page('before')).messages.map(row => row.id)).toEqual(['m0', 'm1', 'm2'])
    const around = await page('around')
    expect(around.messages.map(row => row.id)).toEqual(['m1', 'm2', 'm3'])
    expect(around).toMatchObject({ before: 1, after: 4 })
    const after = await page('after')
    expect(after.messages.map(row => row.id)).toEqual(['m4', 'm5', 'm6'])
    expect(after).toMatchObject({ before: 4, after: 7 })
    await expect(phone.rpc('session.load', { sessionId: 'own', anchorId: 'gone' })).rejects.toMatchObject({ code: 'not_found' })
    for (const invalid of [{ before: -1 }, { before: '3' }, { limit: 0 }, { includeState: 'false' }, { anchorId: 'm3', before: 2 }, { direction: 'after' }, { anchorId: 'm3', direction: 'unknown' }]) {
      await expect(phone.rpc('session.load', { sessionId: 'own', ...invalid })).rejects.toMatchObject({ code: 'invalid_argument' })
    }
  })
})
