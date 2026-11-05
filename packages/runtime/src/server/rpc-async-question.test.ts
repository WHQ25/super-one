import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { CODEX_ASYNC_QUESTION_DISMISSED, codexAsyncQuestionQueue, pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { EventLog } from '../session/event-log'
import { sessionReadModel } from '../session/read-model'
import { SessionRuntime, type TurnRunner } from '../session/session-runtime'
import { createSqliteSessionStore } from '../session/sqlite-session-store'
import { dispatchRpc, SHARED_RPC_METHODS } from './rpc-dispatch'
import type { RpcContext } from './rpc-context'

const runtimes: SessionRuntime[] = []
const databases: NodeDatabase[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  for (const db of databases.splice(0)) if (db.open) db.close()
})

const questions = [{ title: 'Environment?', options: ['Production', 'Staging'] }]
const answerId = 'codex_async_answer:question'

function fixture(options: { streaming?: boolean; harnessId?: string } = {}) {
  const db = openNodeDatabase(':memory:')
  databases.push(db)
  const runner = vi.fn<TurnRunner>(async ({ onInputAccepted }) => {
    onInputAccepted?.()
    return { finalText: '', skipAssistantTranscript: true }
  })
  const leases = { assertValid: vi.fn() }
  const boot = () => {
    const events = new EventLog(db, 'env')
    const runtime = new SessionRuntime(createSqliteSessionStore(db), events, leases, 'env', runner, {
      readModel: sessionReadModel(db, events), runtimeReaperIntervalMs: 0,
    })
    runtimes.push(runtime)
    return runtime
  }
  const runtime = boot()
  const { sessionId } = runtime.create({ projectId: 'p', harnessId: options.harnessId ?? 'codex',
    model: 'model', effort: 'high', apiProviderId: 'codex-account:cli' })
  const emit = (event: AgentEvent) => runtime.publishHarnessEvent(sessionId, event)
  emit({ type: 'message_start', message: { id: 'turn', role: 'assistant', status: 'streaming', content: [], providerId: 'codex', createdAt: new Date().toISOString() } })
  emit({ type: 'content_delta', messageId: 'turn', delta: { type: 'text', id: 'question', text: '', codexAsyncQuestions: questions } })
  if (!options.streaming) emit({ type: 'message_complete', messageId: 'turn' })
  const idempotency: RpcContext['idempotency'] = { payloadHash: () => 'h', runExclusive: (_c, _m, _k, _h, execute) => execute() }
  const ctx = {
    sessions: runtime, projects: {}, leases,
    identity: { environmentId: 'env' },
    client: { clientSessionId: 'desktop', scopes: ['session:operate', 'session:read'] },
    idempotencyKey: 'request',
    idempotency,
  } as unknown as RpcContext
  const rpc = (over: Record<string, unknown> = {}) => dispatchRpc('session.answerAsyncQuestion', {
    sessionId, messageId: 'turn', itemId: 'question', answers: ['Production'], leaseId: 'lease', generation: 'generation', ...over,
  }, ctx)
  return { runtime, runner, leases, ctx, rpc, sessionId, boot, emit }
}

describe('remote Codex async question RPC', () => {
  it('registers the operation and accepts a reply after the original turn completes', async () => {
    const f = fixture()
    expect(SHARED_RPC_METHODS.has('session.answerAsyncQuestion')).toBe(true)
    expect(f.runtime.servedOperations.has('session.answerAsyncQuestion')).toBe(true)
    expect(await f.rpc()).toEqual({ result: { reply: 'Production' } })
    expect(f.runner).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Production', clientMessageId: answerId, turnKind: 'run', model: 'model', effort: 'high', apiProviderId: 'codex-account:cli',
    }))
    expect(f.runtime.messages(f.sessionId).find(row => row.id === answerId)?.content)
      .toEqual([{ type: 'text', text: 'Production', codexAsyncQuestions: questions }])
    expect(pendingCodexAsyncQuestions(f.runtime.messages(f.sessionId))).toEqual([])
    const controller = createNodeSessionEventMapper({ sessionId: f.sessionId, skipUserMessage: true })
    const delivered = f.runtime.listEventsAfter('0').flatMap(event => controller.map(event))
    expect(delivered).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'user_message_appended', message: expect.objectContaining({ id: answerId, content: [{ type: 'text', text: 'Production', codexAsyncQuestions: questions }] }),
    })]))
    expect(f.leases.assertValid).toHaveBeenCalledWith({ resource: { environmentId: 'env', sessionId: f.sessionId },
      leaseId: 'lease', generation: 'generation', holderClientId: 'desktop' })
  })

  it('resolves dismiss through the same durable reply and restores it after a restart', async () => {
    const f = fixture()
    expect(await f.rpc({ answers: [CODEX_ASYNC_QUESTION_DISMISSED] }))
      .toEqual({ result: { reply: CODEX_ASYNC_QUESTION_DISMISSED } })
    await f.runtime.dispose()
    const restarted = f.boot()
    const loaded = restarted.load({ sessionId: f.sessionId })
    expect(pendingCodexAsyncQuestions(loaded.messages)).toEqual([])
    expect(codexAsyncQuestionQueue({ ...loaded.state, messages: loaded.messages })).toEqual([])
    expect(loaded.messages.find(row => row.id === answerId)?.content)
      .toEqual([{ type: 'text', text: CODEX_ASYNC_QUESTION_DISMISSED, codexAsyncQuestions: questions }])
    f.ctx.sessions = restarted
    expect(await f.rpc()).toEqual({ result: { reply: CODEX_ASYNC_QUESTION_DISMISSED } })
    expect(f.runner).toHaveBeenCalledTimes(1)
  })

  it('replays an accepted answer even if its original streaming question was lost at restart', async () => {
    const f = fixture({ streaming: true })
    let finish!: () => void
    f.runner.mockImplementationOnce(async ({ onInputAccepted }) => {
      onInputAccepted?.()
      await new Promise<void>(resolve => { finish = resolve })
      return { finalText: '', skipAssistantTranscript: true }
    })
    expect(await f.rpc()).toEqual({ result: { reply: 'Production' } })
    // The question delta is ephemeral; the accepted answer is a durable event.
    const restarted = f.boot()
    f.ctx.sessions = restarted
    expect(await f.rpc()).toEqual({ result: { reply: 'Production' } })
    expect(f.runner).toHaveBeenCalledTimes(1)
    finish()
    f.emit({ type: 'message_complete', messageId: 'turn' })
  })

  it('keeps the question pending until input is accepted, then acknowledges without waiting for completion', async () => {
    const f = fixture({ streaming: true })
    let accept!: () => void
    let finish!: () => void
    f.runner.mockImplementationOnce(async ({ onInputAccepted }) => {
      await new Promise<void>(resolve => { accept = resolve })
      onInputAccepted?.()
      await new Promise<void>(resolve => { finish = resolve })
      return { finalText: '', skipAssistantTranscript: true }
    })
    const request = f.rpc()
    await vi.waitFor(() => expect(accept).toBeTypeOf('function'))
    const duplicate = f.rpc()
    expect(pendingCodexAsyncQuestions(f.runtime.messages(f.sessionId))).toHaveLength(1)
    accept()
    expect(await request).toEqual({ result: { reply: 'Production' } })
    expect(await duplicate).toEqual({ result: { reply: 'Production' } })
    expect(f.runner).toHaveBeenCalledTimes(1)
    expect(f.runtime.get(f.sessionId)?.status).toBe('streaming')
    expect(pendingCodexAsyncQuestions(f.runtime.messages(f.sessionId))).toHaveLength(0)
    finish()
    f.emit({ type: 'message_complete', messageId: 'turn' })
  })

  it('deduplicates simultaneous answers and retries with a lost acknowledgement', async () => {
    const f = fixture()
    expect(await Promise.all([f.rpc(), f.rpc()])).toEqual([
      { result: { reply: 'Production' } }, { result: { reply: 'Production' } },
    ])
    expect(await f.rpc({ answers: ['Staging'] })).toEqual({ result: { reply: 'Production' } })
    expect(f.runner).toHaveBeenCalledTimes(1)
    expect(f.runtime.messages(f.sessionId).filter(row => row.id === answerId)).toHaveLength(1)
  })

  it('does not persist an unaccepted reply and allows the question to be retried', async () => {
    const f = fixture()
    f.runner.mockRejectedValueOnce(new Error('Connection lost'))
    expect(await f.rpc()).toMatchObject({ error: { message: 'Connection lost' } })
    expect(f.runtime.messages(f.sessionId).some(row => row.id === answerId)).toBe(false)
    expect(pendingCodexAsyncQuestions(f.runtime.messages(f.sessionId))).toHaveLength(1)
    expect(await f.rpc()).toEqual({ result: { reply: 'Production' } })
    expect(f.runner).toHaveBeenCalledTimes(2)
  })

  it('captures the answer position before continuation arrives during admission', async () => {
    const f = fixture({ streaming: true })
    f.emit({ type: 'content_delta', messageId: 'turn', delta: { type: 'text', id: 'before', text: 'Before' } })
    f.runner.mockImplementationOnce(async ({ onInputAccepted }) => {
      f.emit({ type: 'content_delta', messageId: 'turn', delta: { type: 'text', id: 'after', text: 'After' } })
      onInputAccepted?.()
      return { finalText: '', skipAssistantTranscript: true }
    })
    expect(await f.rpc()).toEqual({ result: { reply: 'Production' } })
    const answer = f.runtime.messages(f.sessionId).find(row => row.id === answerId)!
    expect(answer.metadata?.transcriptBoundary?.content).toEqual({ 'text::0': 0, 'text::1': 6 })
    f.emit({ type: 'message_complete', messageId: 'turn' })
  })

  it.each([
    [{ messageId: 'missing' }, 'not_found'], [{ itemId: 'missing' }, 'not_found'], [{ answers: [] }, 'invalid_argument'],
    [{ answers: [''] }, 'invalid_argument'], [{ answers: ['  '] }, 'invalid_argument'],
    [{ answers: [42] }, 'invalid_argument'], [{ answers: ['one', 'two'] }, 'invalid_argument'],
  ] as const)('rejects an invalid question or answer: %j', async (over, code) => {
    const f = fixture()
    expect(await f.rpc(over)).toMatchObject({ error: { code } })
    expect(f.runner).not.toHaveBeenCalled()
  })

  it('requires session operation scope and a valid control lease', async () => {
    const f = fixture()
    f.ctx.client.scopes = ['session:read']
    expect(await f.rpc()).toMatchObject({ error: { code: 'forbidden' } })
    f.ctx.client.scopes = ['session:operate']
    f.leases.assertValid.mockImplementation(() => { throw Object.assign(new Error('Lease expired'), { code: 'failed_precondition' }) })
    expect(await f.rpc()).toMatchObject({ error: { message: 'Lease expired' } })
    expect(f.runner).not.toHaveBeenCalled()
  })

  it('rejects other harnesses and closed sessions', async () => {
    const f = fixture({ harnessId: 'claude' })
    expect(await f.rpc()).toMatchObject({ error: { code: 'unsupported' } })
    f.runtime.close(f.sessionId)
    expect(await f.rpc()).toMatchObject({ error: { code: 'not_found' } })
    expect(f.runner).not.toHaveBeenCalled()
  })
})
