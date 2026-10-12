import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { ChatRuntime } from '../runtime'
import type { ScheduledSend, ScheduledSendPatch } from '@superone/shared/agent-types'
import { useComposerDraft } from './use-composer-draft'
import { useScheduledSend } from './use-scheduled-send'

const methods = ['get', 'set', 'clear'].map(action => `session.scheduledSend.${action}`)
async function setup() {
  let row: ScheduledSend | null = null
  const rpc = jest.fn(async (method: string) => method === 'environment.descriptor' ? { capabilities: { methods } } : row)
  const controlledRpc = jest.fn(async (_target: unknown, method: string, input: { patch?: ScheduledSendPatch }) => {
    row = method === 'session.scheduledSend.clear' ? null : { sessionId: 's', sendAt: Date.now() + 3600000, armed: true, source: 'manual', message: null, ...row, ...input.patch }
    return row
  })
  const client = { environmentId: 'desktop', resolveProject: async () => ({ environmentId: 'desktop' }), rpc, controlledRpc } as unknown as RelayClient
  const runtime = { sessionId: 's', projectPath: '/repo', sourceEnvironmentId: 'desktop' } as ChatRuntime
  const runtimeRef = { current: runtime }
  const consumeDraft = jest.fn(async () => {})
  const onError = jest.fn()
  const result = await renderHook(() => {
    const composer = useComposerDraft()
    const schedule = useScheduledSend({ client, connected: true, projectPath: '/repo', sessionId: 's', sourceEnvironmentId: 'desktop',
      runtimeRef, composer, attachments: [], clearAttachments: () => {}, prepareSession: async () => runtime,
      consumeDraft, onError })
    return { composer, ...schedule }
  })
  await waitFor(() => expect(result.result.current.controls.available).toBe(true))
  return { ...result, controlledRpc, consumeDraft, onError, runtimeRef }
}

test('arms the captured draft without consuming the editor, then clears it only on confirmed delivery', async () => {
  const f = await setup()
  await act(async () => { f.result.current.composer.changeText('Send this later') })
  const sendAt = Date.now() + 3600000
  await act(async () => { await f.result.current.controls.schedule(sendAt) })
  expect(f.result.current.composer.draft).toBe('Send this later')
  expect(f.controlledRpc).toHaveBeenCalledWith({ environmentId: 'desktop', sessionId: 's' }, 'session.scheduledSend.set', {
    patch: { sendAt, armed: true, source: 'manual', message: 'Send this later', attachments: [] },
  })
  expect(f.consumeDraft).toHaveBeenCalledTimes(1)
  await act(async () => { f.result.current.ingest([{ type: 'scheduled_send_changed', environmentId: 'desktop', sessionId: 's', scheduled: null, delivered: true }]) })
  expect(f.result.current.composer.draft).toBe('')
  await f.unmount()
})

test('delivery never clears a new draft typed after arming', async () => {
  const f = await setup()
  await act(async () => { f.result.current.composer.changeText('Queued message') })
  await act(async () => { await f.result.current.controls.schedule(Date.now() + 3600000) })
  await act(async () => { f.result.current.composer.changeText('A newer draft') })
  await act(async () => { f.result.current.ingest([{ type: 'scheduled_send_changed', environmentId: 'desktop', sessionId: 's', scheduled: null, delivered: true }]) })
  expect(f.result.current.composer.draft).toBe('A newer draft')
  await f.unmount()
})

test('accepts the host offer at quota reset plus one minute without sending immediately or adding another delay', async () => {
  const f = await setup()
  const resetsAt = Date.now() + 3600000
  const sendAt = resetsAt + 60000
  await act(async () => {
    f.result.current.ingest([{ type: 'scheduled_send_changed', environmentId: 'desktop', sessionId: 's',
      scheduled: { sessionId: 's', sendAt, armed: false, source: 'rate_limit', message: null }, delivered: false }])
  })
  await act(async () => { await f.result.current.controls.accept() })
  expect(f.controlledRpc).toHaveBeenCalledWith({ environmentId: 'desktop', sessionId: 's' }, 'session.scheduledSend.set', {
    patch: { sendAt: resetsAt + 60000, armed: true, source: 'rate_limit' },
  })
  expect(f.controlledRpc.mock.calls.some(call => call[1] === 'session.send')).toBe(false)
  await f.unmount()
})

test('a response after leaving the session never consumes the new session draft', async () => {
  const f = await setup()
  await act(async () => { f.result.current.composer.changeText('Queued message') })
  let finish!: (row: ScheduledSend) => void
  f.controlledRpc.mockImplementationOnce(async () => new Promise<ScheduledSend>(resolve => { finish = resolve }))
  let pending!: Promise<void>
  const sendAt = Date.now() + 3600000
  await act(async () => { pending = f.result.current.controls.schedule(sendAt) })
  f.runtimeRef.current = { sessionId: 'other', projectPath: '/repo', sourceEnvironmentId: 'desktop' } as ChatRuntime
  await act(async () => {
    f.result.current.composer.changeText('New session draft')
    finish({ sessionId: 's', sendAt, armed: true, source: 'manual', message: 'Queued message' })
    await pending
  })
  expect(f.consumeDraft).not.toHaveBeenCalled()
  expect(f.result.current.composer.draft).toBe('New session draft')
  await f.unmount()
})
