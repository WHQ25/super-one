import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerOpenResult } from '@superone/shared/agent-types'
import type { ControlLease } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { createPhoneMethods, type PhoneMethodHost } from '../../remote/phone-methods'
import { clearComposerDeliveriesForTests } from '../../session/composer-delivery'
import { clearInputRequestsForTests, respondToInputRequest } from '../../session/input-requests'
import type { FakeSessionManager } from '../node-host-test-fixtures'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  clearComposerDeliveriesForTests()
  clearInputRequestsForTests()
  while (cleanup.length) cleanup.pop()!()
})
const spec = { title: 'Pick', requestedSchema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] } }

function composerDomain() {
  let sessions: FakeSessionManager
  const host = { agent: {}, sessions: { getSession: (id: string) => sessions.getSession(id) } } as PhoneMethodHost
  const result = phoneDomain(cleanup, { phoneMethods: createPhoneMethods(host) })
  sessions = result.sessions
  const { own } = result
  Object.defineProperty(own, 'snapshot', { get: () => ({ harnessId: 'claude', messages: [{ id: 'widget', role: 'assistant', content: [{ type: 'tool_use', toolName: 'mcp__superone__widget_show', toolUseId: 't1', input: '{}', status: 'complete' }] }] }) })
  Object.assign(own, { respondToPermission: (requestId: string, allow: boolean, _always: boolean, _reason: string, _suggestions: number[], decision: 'cancel' | undefined, formAnswers: Record<string, unknown>) => {
    own.lease.assertMutation()
    return respondToInputRequest(own.id, requestId, { allow, decision, formAnswers })
  } })
  return result
}

describe('phone endpoint: composer', () => {
  it.each(['lan', 'relay'] as const)('binds a form and its consumable outcome to the asking phone over %s', async (transport) => {
    const { domain } = composerDomain()
    const a = await connectPhone(domain, { deviceId: 'a', transport })
    const b = await connectPhone(domain, { deviceId: 'b', transport })
    cleanup.push(a.close, b.close)
    const lease = await a.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    const open = { ...proof, viewId: 'view', localId: 'form', messageId: 'widget', spec, output: 'caller', deviceId: 'b' }
    const opened = await a.rpc<ComposerOpenResult>('composer.open', open, 'open-form')
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error(opened.error.message)
    expect(await a.rpc('composer.open', open, 'open-form')).toEqual(opened)
    await b.rpc('composer.cancel', { viewId: 'view', localId: 'form', deviceId: 'a' })
    expect(await a.rpc('composer.outcome', { inputRequestId: opened.requestId })).toEqual({ state: 'pending' })
    expect(await b.rpc('composer.outcome', { inputRequestId: opened.requestId, deviceId: 'a' })).toEqual({ state: 'unknown' })
    await a.rpc('session.respondPermission', { ...proof, interactionId: opened.requestId, decision: 'allow', formAnswers: { color: 'blue' } })
    expect(a.pushes).toContainEqual({ type: 'client', event: expect.objectContaining({ type: 'composer_settled', requestId: opened.requestId, viewId: 'view', localId: 'form', outcome: { status: 'submitted', values: { color: 'blue' } } }) })
    expect(b.pushes).not.toContainEqual(expect.objectContaining({ type: 'client' }))
    const outcome = { state: 'settled', outcome: { status: 'submitted', values: { color: 'blue' } } }
    expect(await a.rpc('composer.outcome', { inputRequestId: opened.requestId }, 'collect-result')).toEqual(outcome)
    expect(await a.rpc('composer.outcome', { inputRequestId: opened.requestId }, 'collect-result')).toEqual(outcome)
    expect(await a.rpc('composer.outcome', { inputRequestId: opened.requestId })).toEqual({ state: 'unknown' })
  })

  it('keeps completion on its original connection and recovers it after reconnecting', async () => {
    const { domain } = composerDomain()
    const original = await connectPhone(domain, { deviceId: 'a' })
    const lease = await original.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    const opened = await original.rpc<ComposerOpenResult>('composer.open', { ...proof, viewId: 'view', localId: 'form', messageId: 'widget', spec, output: 'caller' })
    if (!opened.ok) throw new Error(opened.error.message)
    original.close()
    const replacement = await connectPhone(domain, { deviceId: 'a' })
    cleanup.push(replacement.close)
    await replacement.rpc('session.respondPermission', { ...proof, interactionId: opened.requestId, decision: 'allow', formAnswers: { color: 'red' } })
    expect(original.pushes).not.toContainEqual(expect.objectContaining({ type: 'client' }))
    expect(replacement.pushes).not.toContainEqual(expect.objectContaining({ type: 'client' }))
    expect(await replacement.rpc('composer.outcome', { inputRequestId: opened.requestId })).toEqual({ state: 'settled', outcome: { status: 'submitted', values: { color: 'red' } } })
  })

  it('requires session control to open a form and cancels only the matching frontend view', async () => {
    const { domain } = composerDomain()
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    await expect(phone.rpc('composer.openInputRequest', { sessionId: 'own', messageId: 'widget', spec })).rejects.toMatchObject({ code: 'invalid_argument' })
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    const opened = await phone.rpc<ComposerOpenResult>('composer.open', { ...proof, viewId: 'view', localId: 'form', messageId: 'widget', spec })
    if (!opened.ok) throw new Error(opened.error.message)
    await phone.rpc('composer.cancel', { viewId: 'view', localId: 'other' })
    expect(await phone.rpc('composer.outcome', { inputRequestId: opened.requestId })).toEqual({ state: 'pending' })
    await phone.rpc('composer.cancel', { viewId: 'view', localId: 'form' })
    expect(await phone.rpc('composer.outcome', { inputRequestId: opened.requestId })).toMatchObject({ state: 'settled', outcome: { status: 'cancelled' } })
  })
})
