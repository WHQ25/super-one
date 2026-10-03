import { describe, expect, it, vi } from 'vitest'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import { SessionRuntime, type NodeSessionRecord, type SessionStore, type SessionEventLog, type PendingInteraction, type TurnRunner } from './session-runtime'

const client = { clientSessionId: 'controller' }
const lease = { leaseId: 'lease', generation: 'generation' }
const form: PendingInteraction = {
  interactionId: 'form', kind: 'permission', createdAt: 1, toolName: 'fixture',
  requestKind: 'mcp_elicitation', message: 'Choose a count', allowAlwaysAllow: false,
  ...elicitationFormRequest({ type: 'object', properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'] }),
}

function fixture(runner: TurnRunner = async () => ({ finalText: '' })) {
  const rows = new Map<string, NodeSessionRecord>()
  const log: Array<{ eventType: string; payload: unknown }> = []
  const store: SessionStore = { loadAll: () => [...rows.values()], save: s => { rows.set(s.sessionId, structuredClone(s)) }, delete: id => { rows.delete(id) } }
  const events: SessionEventLog = { headSequence: () => String(log.length), listAfter: () => [], appendSession: input => { log.push(input) } }
  const assertValid = vi.fn((input: { holderClientId: string }) => { if (input.holderClientId !== client.clientSessionId) throw new Error('invalid lease') })
  const runtime = new SessionRuntime(store, events, { assertValid }, 'node', runner)
  const session = runtime.create({ projectId: 'project', harnessId: 'codex' })
  const respond = (overrides: Partial<Parameters<SessionRuntime['respondPermission']>[0]> = {}) => runtime.respondPermission({ sessionId: session.sessionId, interactionId: form.interactionId, decision: 'allow', client, ...lease, ...overrides })
  return { runtime, session, rows, log, respond, assertValid }
}

describe('durable elicitation on the permission channel', () => {
  it('persists the form and requires valid answers from the lease holder', async () => {
    const f = fixture()
    const result = f.runtime.requestElicitation(f.session.sessionId, form, new AbortController().signal)
    expect(f.rows.get(f.session.sessionId)?.pendingInteraction).toEqual(form)
    expect(f.log.at(-1)).toMatchObject({ eventType: 'session.permission_requested', payload: form })
    expect(() => f.respond({ client: { clientSessionId: 'observer' }, formAnswers: { count: 3 } })).toThrow('invalid lease')
    expect(() => f.respond({ formAnswers: { count: 0 } })).toThrow(/count/)
    expect(f.runtime.get(f.session.sessionId)?.pendingInteraction).toEqual(form)
    f.respond({ decision: 'allow_always', formAnswers: { count: 3, injected: 'drop' } })
    await expect(result).resolves.toEqual({ action: 'accept', content: { count: 3 }, _meta: null })
    expect(f.runtime.get(f.session.sessionId)?.alwaysAllowedTools).toEqual([])
    expect(f.runtime.get(f.session.sessionId)?.pendingInteraction).toBeNull()
    expect(() => f.respond()).toThrow(/no matching/)
    expect(f.log.filter(e => e.eventType === 'session.permission_responded')).toHaveLength(1)
  })

  it.each(['decline', 'cancel', 'abort', 'close'] as const)('settles %s once and clears the persisted prompt', async action => {
    const f = fixture()
    const abort = new AbortController()
    const result = f.runtime.requestElicitation(f.session.sessionId, form, abort.signal)
    if (action === 'close') f.runtime.close(f.session.sessionId)
    else if (action === 'abort') abort.abort()
    else f.respond({ decision: 'deny', cancel: action === 'cancel' })
    await expect(result).resolves.toEqual({ action: action === 'decline' ? 'decline' : 'cancel', content: null, _meta: null })
    expect(f.runtime.get(f.session.sessionId)?.pendingInteraction).toBeNull()
    abort.abort()
    expect(f.log.filter(e => ['session.permission_responded', 'session.permission_aborted'].includes(e.eventType))).toHaveLength(1)
  })

  it('returns persist only for an approval without form fields, without remembering the tool locally', async () => {
    const f = fixture()
    const approval = { ...form, schemaForm: undefined, elicitationForm: undefined, supportsAlwaysPersist: true, allowAlwaysAllow: true }
    const result = f.runtime.requestElicitation(f.session.sessionId, approval, new AbortController().signal)
    f.respond({ decision: 'allow_always' })
    await expect(result).resolves.toEqual({ action: 'accept', content: null, _meta: { persist: 'always' } })
    expect(f.runtime.get(f.session.sessionId)?.alwaysAllowedTools).toEqual([])
  })

  it('waits for user input even when the turn bypasses permissions', async () => {
    let observed: unknown
    const runner: TurnRunner = async input => {
      observed = await input.onElicitation!(form)
      return { finalText: 'done' }
    }
    const f = fixture(runner)
    f.runtime.send({ sessionId: f.session.sessionId, text: 'form', permissionMode: 'bypassPermissions', client, ...lease })
    await vi.waitFor(() => expect(f.runtime.get(f.session.sessionId)?.pendingInteraction).toEqual(form))
    expect(observed).toBeUndefined()
    f.respond({ formAnswers: { count: 2 } })
    await vi.waitFor(() => expect(observed).toEqual({ action: 'accept', content: { count: 2 }, _meta: null }))
  })
})
