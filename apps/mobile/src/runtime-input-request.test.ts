import { afterEach, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { parseSchemaForm } from '@superone/shared/schema-form'
import { ChatRuntime } from './runtime'
import { runtimeTestClient } from './runtime-test-client'

const request: PermissionRequest = { requestId: 'form', toolName: 'superone_input_request', input: {}, allowAlwaysAllow: false, requestKind: 'input_request',
  inputRequest: { title: 'Notes', output: 'agent', origin: { kind: 'widget', messageId: 'widget' } },
  schemaForm: parseSchemaForm({ type: 'object', properties: { notes: { type: 'string' } } }),
}
const runtimes: ChatRuntime[] = []
function fixture() {
  const client = runtimeTestClient()
  const runtime = new ChatRuntime(client as never, vi.fn())
  runtime.projectPath = '/p'; runtime.sessionId = 'owner'; runtime.provider = 'codex'
  runtime.session.pendingPermissions = [request]
  runtimes.push(runtime)
  return { client, runtime }
}
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose() })

it.each([undefined, 'next'] as const)('restores invalid widget values from the %s send receipt', async priority => {
  const { runtime, client } = fixture()
  client.dispatch.mockRejectedValue(new Error('RPC failed: [input_request:invalid] Choose a valid file'))
  runtime.send('Notes', { clientMessageId: 'user', priority, inputRequest: { requestId: 'form', values: { notes: 'draft' } } })
  await vi.waitFor(() => expect(runtime.session.pendingPermissions).toEqual([request]))
  expect(runtime.session.messages).toEqual([])
  expect(runtime.session.queuedMessages).toEqual([])
  expect(runtime.inputRequestSends.errorFor('form')).toBe('Choose a valid file')
  expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'owner', inputRequest: { requestId: 'form', values: { notes: 'draft' } } }))
})

it('also restores a queued form when the host failure event arrives before the receipt', async () => {
  const { runtime, client } = fixture()
  let finish!: (value: unknown) => void
  client.dispatch.mockReturnValue(new Promise((_resolve, reject) => { finish = reject }))
  runtime.send('Notes', { clientMessageId: 'queued', priority: 'next', inputRequest: { requestId: 'form', values: { notes: 'draft' } } })
  runtime.ingest([{ type: 'user_message_send_failed', sessionId: 'other', clientMessageId: 'queued', error: '[input_request:invalid] Foreign' }])
  expect(runtime.session.pendingPermissions).toEqual([])
  runtime.ingest([{ type: 'user_message_send_failed', sessionId: 'owner', clientMessageId: 'queued', error: '[input_request:invalid] Fix the value' }])
  expect(runtime.session.pendingPermissions).toEqual([request])
  expect(runtime.session.queuedMessages).toEqual([])
  expect(runtime.session.messages).toEqual([])
  expect(runtime.inputRequestSends.errorFor('form')).toBe('Fix the value')
  finish(new Error('[input_request:invalid] Fix the value'))
  await Promise.resolve(); await Promise.resolve()
  expect(runtime.session.pendingPermissions).toEqual([request])
})

it('keeps transport retries on the same message and values', async () => {
  const { runtime, client } = fixture()
  client.dispatch.mockRejectedValueOnce(new Error('Disconnected'))
  runtime.send('Notes', { clientMessageId: 'user', model: 'chosen', inputRequest: { requestId: 'form', values: { notes: 'draft' } } })
  await vi.waitFor(() => expect(runtime.session.messages[0]?.metadata?.sendFailure).toBeDefined())
  runtime.resendFailedMessage('user')
  await vi.waitFor(() => expect(client.dispatch).toHaveBeenCalledTimes(2))
  expect(client.dispatch.mock.calls[1][0]).toEqual(client.dispatch.mock.calls[0][0])
  expect(runtime.session.messages).toHaveLength(1)
})

it('does not replay a permanently settled request', async () => {
  const { runtime, client } = fixture()
  client.dispatch.mockRejectedValue(new Error('[input_request:already_resolved] Already answered'))
  runtime.send('Notes', { clientMessageId: 'user', inputRequest: { requestId: 'form', values: { notes: 'draft' } } })
  await vi.waitFor(() => expect(runtime.session.messages[0]?.metadata?.sendFailure).toBeDefined())
  runtime.resendFailedMessage('user')
  expect(client.dispatch).toHaveBeenCalledTimes(1)
  expect(runtime.session.pendingPermissions).toEqual([])
})
