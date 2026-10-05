import { describe, expect, it, vi } from 'vitest'
import { admitInputRequestSpec, inputRequestMeta } from '@superone/shared/input-request'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import { SessionRuntime, type NodeSessionRecord, type PendingInteraction, type SessionEventLog, type SessionStore } from './session-runtime'

const client = { clientSessionId: 'controller' }
const lease = { leaseId: 'lease', generation: 'generation' }
const admitted = admitInputRequestSpec({
  title: 'Deploy target',
  requestedSchema: { type: 'object', properties: { env: { type: 'string', enum: ['staging', 'prod'] } }, required: ['env'] },
}, { userResources: false })
if (!admitted.ok) throw new Error(admitted.error)
const meta = inputRequestMeta(admitted.spec, { kind: 'agent' }, 'caller')
const permission: PendingInteraction = {
  interactionId: 'permission', kind: 'permission', createdAt: 1, toolName: 'Bash', allowAlwaysAllow: true,
  requestKind: 'mcp_elicitation', ...elicitationFormRequest({ type: 'object', properties: { ok: { type: 'boolean' } } }),
}

function fixture() {
  const rows = new Map<string, NodeSessionRecord>()
  const log: Array<{ eventType: string; payload: unknown }> = []
  const store: SessionStore = { loadAll: () => [...rows.values()], save: s => { rows.set(s.sessionId, structuredClone(s)) }, delete: id => { rows.delete(id) } }
  const events: SessionEventLog = { headSequence: () => String(log.length), listAfter: () => [], appendSession: input => { log.push(input) } }
  const assertValid = vi.fn((input: { holderClientId: string }) => { if (input.holderClientId !== client.clientSessionId) throw new Error('invalid lease') })
  const runtime = new SessionRuntime(store, events, { assertValid }, 'node', async () => ({ finalText: '' }))
  const session = runtime.create({ projectId: 'project', harnessId: 'claude' })
  const request = (signal = new AbortController().signal) => runtime.requestInput({ sessionId: session.sessionId, meta, form: admitted.form, signal })
  const respond = (interactionId: string, overrides: Partial<Parameters<SessionRuntime['respondPermission']>[0]> = {}) =>
    runtime.respondPermission({ sessionId: session.sessionId, interactionId, decision: 'allow', client, ...lease, ...overrides })
  const formId = () => runtime.pendingInputRequests(session.sessionId)[0]!.interactionId
  return { runtime, session, rows, log, request, respond, formId }
}

describe('node input requests', () => {
  it('emits an input_request prompt and returns validated values from the lease holder', async () => {
    const f = fixture()
    const result = f.request()
    const [pending] = f.runtime.pendingInputRequests(f.session.sessionId)
    expect(pending).toMatchObject({ kind: 'permission', requestKind: 'input_request', toolName: 'composer_request', inputRequest: meta })
    expect(f.log.at(-1)).toMatchObject({ eventType: 'session.permission_requested', payload: pending })
    expect(f.rows.get(f.session.sessionId)?.pendingInteraction).toBeNull()
    expect(() => f.respond(f.formId(), { client: { clientSessionId: 'observer' }, formAnswers: { env: 'prod' } })).toThrow('invalid lease')
    expect(() => f.respond(f.formId())).toThrow(/no form values/)
    expect(() => f.respond(f.formId(), { formAnswers: { env: 'dev' } })).toThrow(/env/)
    const id = f.formId()
    f.respond(id, { formAnswers: { env: 'prod', injected: 1 } })
    await expect(result).resolves.toEqual({ status: 'submitted', values: { env: 'prod' } })
    expect(f.runtime.pendingInputRequests(f.session.sessionId)).toEqual([])
    expect(f.log.at(-1)).toMatchObject({ eventType: 'session.permission_responded', payload: { interactionId: id, decision: 'allow' } })
    expect(() => f.respond(id, { formAnswers: { env: 'prod' } })).toThrow(/no matching/)
  })

  it('coexists with a harness permission without evicting it or being evicted', async () => {
    const f = fixture()
    const form = f.request()
    const elicitation = f.runtime.requestElicitation(f.session.sessionId, permission, new AbortController().signal)
    expect(f.runtime.get(f.session.sessionId)?.pendingInteraction).toEqual(permission)
    expect(f.runtime.pendingInputRequests(f.session.sessionId)).toHaveLength(1)
    f.respond('permission', { formAnswers: { ok: true } })
    await expect(elicitation).resolves.toMatchObject({ action: 'accept' })
    f.respond(f.formId(), { formAnswers: { env: 'staging' } })
    await expect(form).resolves.toEqual({ status: 'submitted', values: { env: 'staging' } })
  })

  it.each(['cancel', 'deny', 'abort', 'interrupt', 'close'] as const)('settles %s once with a neutral cancellation', async action => {
    const f = fixture()
    const abort = new AbortController()
    const result = f.request(abort.signal)
    if (action === 'close') f.runtime.close(f.session.sessionId)
    else if (action === 'interrupt') f.runtime.interrupt(f.session.sessionId, client, lease.leaseId, lease.generation)
    else if (action === 'abort') abort.abort()
    else f.respond(f.formId(), { decision: action === 'deny' ? 'deny' : 'allow', cancel: action === 'cancel' })
    await expect(result).resolves.toEqual({ status: 'cancelled', reason: action === 'cancel' || action === 'deny' ? 'user' : 'aborted' })
    abort.abort()
    expect(f.log.filter(e => ['session.permission_responded', 'session.permission_aborted'].includes(e.eventType))).toHaveLength(1)
    expect(f.runtime.pendingInputRequests(f.session.sessionId)).toEqual([])
  })

  it('never shows a form for an aborted turn', async () => {
    const f = fixture()
    const abort = new AbortController()
    abort.abort()
    await expect(f.request(abort.signal)).resolves.toEqual({ status: 'cancelled', reason: 'aborted' })
    expect(f.log.some(e => e.eventType === 'session.permission_requested')).toBe(false)
  })
})
