import { describe, expect, it, vi } from 'vitest'
import { parseSchemaForm } from '@superone/shared/schema-form'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import { InputRequestDrafts, mobileInputSurfaces } from './input-request-state'
import { InputRequestSends } from './runtime-input-request-sends'
import { inputRequestActions } from './input-request-actions'

const request: PermissionRequest = {
  requestId: 'form', toolName: 'superone_input_request', input: {}, allowAlwaysAllow: false, requestKind: 'input_request',
  inputRequest: { title: 'Notes', origin: { kind: 'widget', messageId: 'widget' }, output: 'agent' },
  schemaForm: parseSchemaForm({ type: 'object', properties: { notes: { type: 'string' } } }),
}

describe('native input ownership', () => {
  it('keeps forms in the composer and lets permission, question and plan preempt them', () => {
    const base = { pendingPermissions: [request], pendingQuestion: null, pendingPlanApproval: null }
    expect(mobileInputSurfaces(base)).toMatchObject({ permission: null, input: request, showPlan: false })
    expect(mobileInputSurfaces({ ...base, pendingQuestion: {} }).input).toBeNull()
    expect(mobileInputSurfaces({ ...base, pendingPlanApproval: {} })).toMatchObject({ input: null, showPlan: true })
    const permission = { requestId: 'permission', toolName: 'Bash', input: {}, allowAlwaysAllow: false }
    expect(mobileInputSurfaces({ ...base, pendingPermissions: [request, permission] }).permission).toBe(permission)
  })

  it('retains values, step and file choices across session switches and preemption', () => {
    const drafts = new InputRequestDrafts()
    const draft = { values: { notes: 'Unsent\nnotes' }, stepIndex: 1, touched: new Set(['notes']), resources: new Map([['files', [{ uri: 'file:///chosen', name: 'chosen' }]]]) }
    drafts.set('/p', 'owner', 'form', draft)
    drafts.reconcile('/p', 'other', [])
    drafts.reconcile('/p', 'owner', [request])
    expect(drafts.get('/p', 'owner', 'form')).toBe(draft)
    expect(drafts.get('/p', 'other', 'form')).toBeUndefined()
    drafts.reconcile('/p', 'owner', [])
    expect(drafts.get('/p', 'owner', 'form')).toBeUndefined()
  })

  it('restores an invalid form without the rejected bubble, while transport failures retain retry ownership', () => {
    const sends = new InputRequestSends()
    const session = createDefaultChatCoreSession()
    sends.capture('user', request)
    expect(sends.reject(session, 'user', 'Connection lost', false)).toBeNull()
    expect(sends.pendingRequests()).toEqual([request])
    const restored = sends.reject(session, 'user', 'RPC failed: [input_request:invalid] Pick the file again', false)
    expect(restored).toMatchObject({ messages: [], queuedMessages: [], pendingPermissions: [request], awaitingAssistantReply: false })
    expect(sends.errorFor('form')).toBe('Pick the file again')
    expect(sends.pendingRequests()).toEqual([])
    sends.capture('retry', request)
    expect(sends.errorFor('form')).toBeUndefined()
    expect(sends.reject(session, 'retry', '[input_request:already_resolved] Closed', false)).toBeNull()
  })

  it('requires a caller acknowledgement and keeps a rejected form editable', async () => {
    const caller = { ...request, inputRequest: { ...request.inputRequest!, output: 'caller' as const } }
    const runtime = { projectPath: '/p', sessionId: 'owner', session: { pendingPermissions: [caller] }, send: vi.fn() }
    const client = { environmentId: 'desktop', controlledRpc: vi.fn().mockRejectedValueOnce(new Error('Invalid answer')).mockResolvedValue({ ok: true }) }
    const actions = inputRequestActions({ client: client as never, runtime: runtime as never, request: caller })
    await expect(actions.submit({ notes: 'draft' })).rejects.toThrow('Invalid answer')
    expect(runtime.session.pendingPermissions).toEqual([caller])
    await actions.submit({ notes: 'fixed' })
    expect(client.controlledRpc).toHaveBeenLastCalledWith({ environmentId: 'desktop', sessionId: 'owner' }, 'session.respondPermission', expect.objectContaining({ formAnswers: { notes: 'fixed' } }))
    expect(runtime.send).not.toHaveBeenCalled()
    runtime.sessionId = 'other'
    await expect(actions.cancel()).rejects.toThrow('no longer active')
  })

  it('sends widget values with the selected settings and captured metadata', async () => {
    const runtime = { projectPath: '/p', sessionId: 'owner', session: { pendingPermissions: [request] }, send: vi.fn() }
    const client = { environmentId: 'desktop', controlledRpc: vi.fn() }
    const actions = inputRequestActions({ client: client as never, runtime: runtime as never, request, sendOptions: { model: 'chosen', effort: 'high', priority: 'next' } })
    await actions.submit({ notes: 'First\nSecond' })
    expect(runtime.send).toHaveBeenCalledWith('Notes\nnotes:\n  First\n  Second', { model: 'chosen', effort: 'high', priority: 'next', inputRequest: { requestId: 'form', values: { notes: 'First\nSecond' } } })
    expect(client.controlledRpc).not.toHaveBeenCalled()
  })
})
