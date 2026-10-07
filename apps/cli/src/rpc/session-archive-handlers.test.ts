import { describe, expect, it, vi } from 'vitest'
import { decode } from '@toon-format/toon'
import { OPERATION_SCOPES } from '@superone/shared/environment'
import { dispatchSessionArchiveRpc } from './session-archive-handlers'
import type { RpcContext } from './handlers'

const session = (sessionId = 'one', extra = {}) => ({ sessionId, projectId: 'p', harnessId: 'acp', providerId: 'grok', title: 'OAuth investigation', createdAt: 1, updatedAt: 2, transcript: [{ id: 'm', role: 'assistant', text: 'refresh token rationale', createdAt: 2 }], tags: ['auth'], isHidden: false, isPinned: false, ...extra })
function context(rows = [session()]) {
  return { identity: { environmentId: 'node-A' }, client: { scopes: OPERATION_SCOPES.readSession }, sessions: { archiveEntries: () => rows.values(), get: (id: string) => rows.find(row => row.sessionId === id), listMessages: vi.fn(() => ({ messages: rows[0].transcript, cursor: null, hasMore: false })), snapshotSequence: () => '42' }, projects: { list: () => [{ projectId: 'p', name: 'App', path: '/app' }], get: (id: string) => id === 'p' ? {} : null }, sessionProviders: { get: () => ({ config: { agentId: 'grok-build' } }) }, collaboration: { isSpawnChild: () => false } } as unknown as RpcContext
}
function archive(ctx: RpcContext, args: Record<string, unknown>, tool = 'session_search', sourceSessionId = 'one') {
  const reply = dispatchSessionArchiveRpc('session.archive', { tool, args, sourceSessionId }, ctx) as { result: { content: Array<{ text: string }>; isError?: boolean } }
  return reply.result
}

describe('environment archive RPC', () => {
  it('requires session read scope for all read endpoints', () => {
    const ctx = context(); ctx.client.scopes = []
    for (const method of ['session.archive', 'session.linkMetadata', 'session.linkBootstrap']) expect(dispatchSessionArchiveRpc(method, {}, ctx)).toMatchObject({ error: { code: 'forbidden' } })
  })
  it('searches only its own archive and returns environment once with ACP branding', () => {
    const ctx = context([session(), session('hidden', { isHidden: true })])
    const value = decode(archive(ctx, { environmentId: 'localhost', query: 'refresh token' }).content[0].text) as { environmentId: string; hits: Array<Record<string, unknown>> }
    expect(value.environmentId).toBe('localhost')
    expect(value.hits).toHaveLength(1)
    expect(value.hits[0]).toMatchObject({ sessionId: 'one', harness: 'acp', acpAgentId: 'grok-build' })
    expect(value.hits[0]).not.toHaveProperty('environmentId')
    expect(value.hits[0]).not.toHaveProperty('sessionUrl')
  })
  it('rejects mismatched environments and requires scope for a caller from another host', () => {
    expect(archive(context(), { query: 'token', environmentId: 'node-B', allProjects: true }).isError).toBe(true)
    expect(archive(context(), { query: 'token' }, 'session_search', 'foreign-session').isError).toBe(true)
    expect(archive(context(), { query: 'token', allProjects: true }, 'session_search', 'foreign-session').isError).toBeUndefined()
  })
  it('metadata hides private sessions and never materializes transcripts', () => {
    const ctx = context([session(), session('hidden', { isHidden: true })])
    const reply = dispatchSessionArchiveRpc('session.linkMetadata', { sessionIds: ['one', 'hidden'] }, ctx)
    expect(reply).toMatchObject({ result: [{ status: 'ok', metadata: { ref: { environmentId: 'node-A', sessionId: 'one' } } }, { status: 'unavailable' }] })
    expect(ctx.sessions.listMessages).not.toHaveBeenCalled()
  })
  it('takes a synchronous restore baseline with the durable sequence', () => {
    expect(dispatchSessionArchiveRpc('session.linkBootstrap', { sessionId: 'one' }, context())).toMatchObject({ result: { snapshot: { sessionId: 'one' }, page: { hasMore: false }, sequence: '42' } })
  })
  it('uses the shared message_count sort and native transcript tools', () => {
    const ctx = context([session(), session('two', { transcript: [] })])
    const list = decode(archive(ctx, { order: 'message_count_desc' }, 'session_list').content[0].text) as { sessions: Array<{ id: string }> }
    expect(list.sessions.map(row => row.id)).toEqual(['one', 'two'])
    vi.mocked(ctx.sessions.listMessages).mockReturnValue({ sessionId: 'one', cursor: null, hasMore: false, messages: [{ id: 'm', role: 'assistant', text: 'result', createdAt: 2, sortOrder: 0, content: [{ type: 'tool_use', toolUseId: 't', toolName: 'Bash', input: '{"command":"pwd"}', status: 'complete' }] }] })
    expect(archive(ctx, { sessionId: 'one', view: 'tools' }, 'session_read').content[0].text).toContain('Bash')
  })
})
