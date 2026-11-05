import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { decode } from '@toon-format/toon'
import { SessionRuntime, EventLog, createSqliteSessionStore, sessionReadModel, type TurnRunner } from '@superone/runtime/session'
import { runSessionCleanup } from '@superone/runtime/session/session-cleanup'
import { dispatchRpc, type RpcContext as RuntimeRpcContext } from '@superone/runtime/server'
import { OPERATION_SCOPES } from '@superone/shared/environment'
import { openNodeDatabase } from '../db/database'
import { dispatchSessionArchiveRpc } from './session-archive-handlers'
import type { RpcContext } from './handlers'

describe('node message counts across interruption and restart', () => {
  it('counts projected messages in metadata, list ordering and pinned rows without reading transcript bodies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'message-count-'))
    const path = join(dir, 'state.sqlite')
    let db = openNodeDatabase(path)
    const runner: TurnRunner = async ({ messageId, signal, onAgentEvent }) => {
      onAgentEvent?.({ type: 'message_start', message: { id: messageId!, role: 'assistant', status: 'streaming', content: [], createdAt: new Date().toISOString(), providerId: 'claude' } })
      onAgentEvent?.({ type: 'content_delta', messageId: messageId!, delta: { type: 'text', text: 'progress before interruption' } })
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw new Error('interrupted')
    }
    const boot = (turnRunner: TurnRunner) => {
      const events = new EventLog(db, 'node')
      return new SessionRuntime(createSqliteSessionStore(db), events, { assertValid: () => {} }, 'node', turnRunner, {
        readModel: sessionReadModel(db, events), runtimeReaperIntervalMs: 0,
      })
    }
    let runtime = boot(runner)
    const client = { clientSessionId: 'client' }
    const lease = { leaseId: 'l', generation: '1' }
    const session = runtime.create({ projectId: 'p', harnessId: 'claude', title: 'Interrupted' })
    const other = runtime.create({ projectId: 'p', harnessId: 'claude', title: 'Empty' })
    const context = () => ({
      identity: { environmentId: 'node' }, client: { ...client, scopes: OPERATION_SCOPES.readSession },
      sessions: runtime, projects: { get: () => ({ projectId: 'p', path: dir, name: 'Project' }) },
      collaboration: { isSpawnChild: () => false },
    }) as unknown as RpcContext & RuntimeRpcContext
    const archive = (tool: string, args: Record<string, unknown>) => {
      const response = dispatchSessionArchiveRpc('session.archive', { tool, args, sourceSessionId: session.sessionId }, context()) as { result: { content: Array<{ text: string }> } }
      return response.result.content[0].text
    }
    const check = async (count: number) => {
      const bodies = vi.spyOn(runtime, 'messages').mockImplementation(() => { throw new Error('metadata must not load message bodies') })
      try {
        const meta = JSON.parse(archive('session_read', { sessionId: session.sessionId, view: 'meta' }))
        expect(meta.messageCount).toBe(count)
        const list = decode(archive('session_list', { order: 'message_count_desc' })) as { sessions: Array<{ id: string; messageCount: number }> }
        expect(list.sessions[0]).toMatchObject({ id: session.sessionId, messageCount: count })
        expect(list.sessions[1].id).toBe(other.sessionId)
        for (const [method, args] of [
          ['session.list', { projectId: 'p', limit: 10, offset: 0 }],
          ['session.listPinned', {}],
          ['session.searchTitle', { query: 'Interrupted' }],
        ] as const) {
          const result = await dispatchRpc(method, args, context())
          expect(result).toMatchObject({ result: expect.arrayContaining([expect.objectContaining({ sessionId: session.sessionId, messageCount: count })]) })
        }
      } finally { bodies.mockRestore() }
      expect(archive('session_read', { sessionId: session.sessionId, view: 'text' })).toContain(`messages: ${count}`)
    }
    try {
      runtime.setUiFlags(session.sessionId, { isPinned: true })
      await runtime.send({ sessionId: session.sessionId, text: 'original task', client, ...lease })
      await vi.waitFor(() => expect(runtime.messages(session.sessionId).length).toBe(2))
      expect(runtime.get(session.sessionId)?.transcript).toHaveLength(1)
      await check(2)
      await db.backup(join(dir, 'restart.sqlite'))
      await runtime.dispose()
      db.close()
      db = openNodeDatabase(join(dir, 'restart.sqlite'))
      runtime = boot(async () => ({ finalText: 'finished' }))
      expect(runtime.get(session.sessionId)?.status).toBe('interrupted')
      await check(2)
      await runtime.send({ sessionId: session.sessionId, text: 'continue', client, ...lease })
      await vi.waitFor(() => expect(runtime.get(session.sessionId)?.status).toBe('idle'))
      await check(4)
      await runtime.dispose()
      db.close()
      db = openNodeDatabase(join(dir, 'restart.sqlite'))
      runtime = boot(async () => ({ finalText: 'finished' }))
      // A cold, current checkpoint counts rows; it must not SELECT message_json.
      const prepare = vi.spyOn(db, 'prepare')
      expect(JSON.parse(archive('session_read', { sessionId: session.sessionId, view: 'meta' })).messageCount).toBe(4)
      expect(prepare.mock.calls.some(([sql]) => /SELECT\s+message_json\s+FROM/i.test(sql))).toBe(false)
      prepare.mockRestore()
      const cleanup = runSessionCleanup(runtime, { action: 'delete', sessionIds: [session.sessionId], sourceSessionId: other.sessionId, includePinned: true })
      const confirmation = runtime.get(other.sessionId)!.pendingInteraction!
      expect(confirmation.sessionCleanupConfirm?.sessions[0]).toMatchObject({ id: session.sessionId, messageCount: 4 })
      runtime.respondPermission({ sessionId: other.sessionId, interactionId: confirmation.interactionId, decision: 'deny', client, ...lease })
      expect(await cleanup).toMatchObject({ status: 'rejected' })
      expect(runtime.get(session.sessionId)).not.toBeNull()
      runtime.setUiFlags(session.sessionId, { isSettled: true })
      expect(await dispatchRpc('session.listSettled', {}, context())).toMatchObject({ result: { sessions: [expect.objectContaining({ sessionId: session.sessionId, messageCount: 4 })] } })
    } finally {
      await runtime.dispose()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
