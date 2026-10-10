import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlLease, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { createPhoneMethods, type PhoneMethodHost } from '../../remote/phone-methods'
import { enqueueSessionQueueOp } from '../../session/session-queue'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'
import type { FakeSessionManager } from '../node-host-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

function operationsDomain() {
  let sessions: FakeSessionManager
  const host = { agent: {}, sessions: { getSession: (id: string) => sessions.getSession(id) } } as PhoneMethodHost
  const result = phoneDomain(cleanup, { phoneMethods: createPhoneMethods(host) })
  sessions = result.sessions
  const { own } = result
  const operations = {
    requestSessionRecap: vi.fn(async () => { own.lease.assertMutation(); return true }),
    setCodexGoal: vi.fn(async () => { own.lease.assertMutation(); return null }),
    clearCodexGoal: vi.fn(async () => { own.lease.assertMutation(); return true }),
    dequeueMessage: vi.fn(async () => { own.lease.assertMutation(); return true }),
    dispatchBackendCommand: vi.fn(async () => { own.lease.assertMutation() }),
    respondToPermission: vi.fn(() => { own.lease.assertMutation(); return true }),
    respondToQuestion: vi.fn(() => { own.lease.assertMutation() }),
    dismissQuestion: vi.fn(() => { own.lease.assertMutation() }),
  }
  Object.assign(own, operations)
  return { ...result, operations }
}

describe('phone endpoint: fenced session operations', () => {
  it.each(['lan', 'relay'] as const)('serves existing session operations and dedupes lost-response retries over %s', async (transport) => {
    const { domain, operations } = operationsDomain()
    const phone = await connectPhone(domain, { transport })
    cleanup.push(phone.close)
    const descriptor = await phone.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(descriptor.capabilities.methods).toEqual(expect.arrayContaining(['session.recap', 'session.setGoal', 'session.dequeue', 'session.steer', 'session.answerAsyncQuestion']))
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    await expect(phone.rpc('session.setGoal', { ...proof, objective: 'Finish it', status: 'active' }, 'goal-1')).resolves.toEqual({ ok: true })
    await phone.rpc('session.setGoal', { ...proof, objective: 'Finish it', status: 'active' }, 'goal-1')
    expect(operations.setCodexGoal).toHaveBeenCalledTimes(1)
    expect(operations.setCodexGoal).toHaveBeenCalledWith(null, 'Finish it', 'active')
    await phone.rpc('session.setGoal', { ...proof, objective: null })
    expect(operations.clearCodexGoal).toHaveBeenCalledWith(null)
    expect(await phone.rpc('session.recap', { ...proof, auto: true })).toEqual({ ok: true })
    expect(await phone.rpc('session.dequeue', { ...proof, clientMessageId: 'q1' })).toEqual({ removed: true })
    await phone.rpc('session.steer', { ...proof, clientMessageId: 'q2', priority: 'next' })
    expect(operations.dispatchBackendCommand).toHaveBeenCalledWith({ kind: 'claude.steer_queued', clientMessageId: 'q2', priority: 'next' })
  })

  it('rejects missing, stolen and stale proofs before touching the harness', async () => {
    const { domain, operations } = operationsDomain()
    const a = await connectPhone(domain, { deviceId: 'a' })
    const b = await connectPhone(domain, { deviceId: 'b' })
    cleanup.push(a.close, b.close)
    const lease = await a.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    await expect(a.rpc('session.setGoal', { sessionId: 'own', objective: 'no proof' })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(b.rpc('session.setGoal', { ...proof, objective: 'stolen' })).rejects.toMatchObject({ code: 'lease_stale' })
    await expect(a.rpc('session.setGoal', { ...proof, objective: 'x', status: 'bad' })).rejects.toMatchObject({ code: 'invalid_argument' })
    domain.leases.revoke({ environmentId: domain.identity.environmentId, sessionId: 'own' })
    await expect(a.rpc('session.recap', proof)).rejects.toMatchObject({ code: 'lease_stale' })
    expect(operations.setCodexGoal).not.toHaveBeenCalled()
    expect(operations.requestSessionRecap).not.toHaveBeenCalled()
  })

  it('revalidates a queue operation after it waits behind an earlier command', async () => {
    const { domain, own, operations } = operationsDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    let release!: () => void
    const earlier = enqueueSessionQueueOp('own', () => new Promise<void>((resolve) => { release = resolve }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const assertMutation = vi.spyOn(own.lease, 'assertMutation')
    const waiting = phone.rpc('session.dequeue', { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, clientMessageId: 'q' })
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'lease_stale' })
    await vi.waitFor(() => expect(assertMutation).toHaveBeenCalledTimes(1))
    domain.leases.revoke({ environmentId: domain.identity.environmentId, sessionId: 'own' })
    release()
    await earlier
    await rejected
    expect(operations.dequeueMessage).not.toHaveBeenCalled()
  })

  it('preserves harness-specific queued steer and plan approval behavior', async () => {
    const { domain, own, operations } = operationsDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    own.harnessId = 'codex'
    await expect(phone.rpc('session.steer', { ...proof, clientMessageId: 'q', priority: 'next' })).rejects.toMatchObject({ code: 'unsupported' })
    await phone.rpc('session.steer', { ...proof, clientMessageId: 'q', priority: 'now' })
    expect(operations.dispatchBackendCommand).toHaveBeenCalledWith({ kind: 'codex.steer_queued', clientMessageId: 'q' })
    await phone.rpc('session.respondPlan', { ...proof, decision: 'reject', options: { messageId: 'plan', feedback: 'Revise' } })
    expect(operations.dispatchBackendCommand).toHaveBeenCalledWith({ kind: 'codex.plan_approval', messageId: 'plan', status: 'rejected', feedback: 'Revise' })
    await expect(phone.rpc('session.answerAsyncQuestion', { ...proof, messageId: 'missing', itemId: 'i', answers: ['yes'] })).rejects.toThrow('Async question not found')
    expect(operations.dispatchBackendCommand).toHaveBeenCalledTimes(2)
  })

  it('preserves the settings and answers that the phone composer supplies', async () => {
    const { domain, own, operations } = operationsDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    await phone.rpc('session.patchSettings', { ...proof, settings: { mode: 'build', agentPreset: 'builder', additionalDirectories: ['/extra'] } })
    expect(own.mode).toBe('build')
    expect(own.agentPreset).toBe('builder')
    expect(operations.dispatchBackendCommand).toHaveBeenCalledWith({ kind: 'session.set_additional_dirs', dirs: ['/extra'] })
    const annotations = { choice: { selections: [{ id: 'quote', content: 'quoted text' }] } }
    await phone.rpc('session.respondQuestion', { ...proof, interactionId: 'question', answers: { choice: 'Yes' }, annotations })
    expect(operations.respondToQuestion).toHaveBeenCalledWith('question', { choice: 'Yes' }, annotations)
    await phone.rpc('session.respondQuestion', { ...proof, interactionId: 'question', dismiss: true })
    expect(operations.dismissQuestion).toHaveBeenCalledWith('question')
    await phone.rpc('session.respondPermission', { ...proof, interactionId: 'permission', decision: 'deny', reason: 'Choose another path', selectedSuggestions: [0, 2] })
    expect(operations.respondToPermission).toHaveBeenCalledWith('permission', false, false, 'Choose another path', [0, 2], undefined, undefined)
  })

  it.each(['lan', 'relay'] as const)('keeps all native turn selections and parks before steering over %s', async (transport) => {
    const { domain, own, operations } = operationsDomain()
    const phone = await connectPhone(domain, { transport })
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    const selections = { priority: 'later', steer: 'now', agent: 'build', modelParams: { fast: 'true' }, inputRequest: { requestId: 'request', values: { color: 'blue' } } }
    await phone.rpc('session.send', { ...proof, text: 'submit', clientMessageId: 'u', options: selections })
    await vi.waitFor(() => expect(operations.dispatchBackendCommand).toHaveBeenCalledWith({ kind: 'claude.steer_queued', clientMessageId: 'u', priority: 'now' }))
    expect(own.sent[0]).toMatchObject({ priority: 'later', agent: 'build', cursor: { params: { fast: 'true' } }, inputRequest: selections.inputRequest })
    own.harnessId = 'codex'
    await phone.rpc('session.send', { ...proof, text: 'codex', clientMessageId: 'c', options: { permissionPreset: 'read-only', collaborationMode: 'plan', effort: 'high', serviceTier: null, threadId: 'thread' } })
    expect(own.sent[1].codex).toEqual({ permissionPreset: 'read-only', collaborationMode: 'plan', reasoningEffort: 'high', serviceTier: null, threadId: 'thread' })
    await expect(phone.rpc('session.send', { ...proof, text: 'bad', clientMessageId: 'x', options: { modelParams: { fast: true } } })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(own.sent).toHaveLength(2)
  })

  it('keeps a dequeue behind the pending park even after send admission returns', async () => {
    const { domain, own, operations } = operationsDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    let park!: () => void
    own.send = async (request, opts) => {
      own.lease.assertMutation()
      own.sent.push(request)
      opts?.onAccepted?.()
      await new Promise<void>(resolve => { park = resolve })
    }
    await phone.rpc('session.send', { ...proof, text: 'queued', clientMessageId: 'q', options: { priority: 'later' } })
    const waiting = phone.rpc('session.dequeue', { ...proof, clientMessageId: 'q' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(operations.dequeueMessage).not.toHaveBeenCalled()
    park()
    expect(await waiting).toEqual({ removed: true })
  })

  it('refuses invalid create settings before persisting a new session', async () => {
    const { domain, sessions } = operationsDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    await expect(phone.rpc('session.create', { projectId: 'p1', harnessId: 'claude', options: { additionalDirectories: [3] } })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(sessions.live.size).toBe(1)
    expect(await phone.rpc('session.list', { projectId: 'p1', limit: 10, offset: 0 })).toHaveLength(1)
  })

  it('does not apply later settings when control is taken back during an asynchronous edit', async () => {
    const { domain, own, operations } = operationsDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    let finish!: () => void
    own.setPermissionMode = () => new Promise<void>((resolve) => { finish = resolve })
    const editing = phone.rpc('session.patchSettings', { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, settings: { permissionMode: 'plan', agentPreset: 'new', additionalDirectories: ['/later'] } })
    const rejected = expect(editing).rejects.toMatchObject({ code: 'lease_stale' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    domain.leases.revoke({ environmentId: domain.identity.environmentId, sessionId: 'own' })
    finish()
    await rejected
    expect(own.agentPreset).toBeNull()
    expect(operations.dispatchBackendCommand).not.toHaveBeenCalled()
  })
})
