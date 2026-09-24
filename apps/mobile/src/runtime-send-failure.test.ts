import { describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from './runtime'

const IMAGE = { id: 'i', name: 'a.png', mimeType: 'image/png', base64: 'a' }

function runtimeWith(request: (cmd: { type: string }) => Promise<unknown>) {
  const client = { send: vi.fn(), request: vi.fn(request) }
  const runtime = new ChatRuntime(client as never, vi.fn())
  runtime.projectPath = '/p'
  runtime.sessionId = 's'
  return { client, runtime }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('send failure', () => {
  it('waits for a receipt on text sends too, instead of firing and forgetting', async () => {
    const { client, runtime } = runtimeWith(async () => ({ ok: true }))
    runtime.send('hello', { clientMessageId: 'u' })
    await settle()
    expect(client.send).not.toHaveBeenCalled()
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'send_message', clientMessageId: 'u', requestId: expect.any(String) }))
    expect(runtime.session.messages[0]?.metadata?.sendFailure).toBeUndefined()
    runtime.dispose()
  })

  it('keeps a refused send on its bubble and stops "Sending…"', async () => {
    const { runtime } = runtimeWith(async () => ({ error: 'Attachment: Could not save file. Retry.' }))
    runtime.send('look', { clientMessageId: 'u', images: [IMAGE] })
    await settle()
    expect(runtime.session.messages).toHaveLength(1)
    expect(runtime.session.messages[0]?.metadata?.sendFailure).toEqual({ error: 'Attachment: Could not save file. Retry.' })
    expect(runtime.pendingTurn).toBeNull()
    runtime.dispose()
  })

  it('marks a send failed when the host reports it after the receipt', async () => {
    const { runtime } = runtimeWith(async () => ({ ok: true }))
    runtime.send('hello', { clientMessageId: 'u' })
    await settle()
    runtime.ingest([{ type: 'user_message_send_failed', sessionId: 's', clientMessageId: 'u', error: 'backend failed to start' }])
    expect(runtime.session.messages[0]?.metadata?.sendFailure).toEqual({ error: 'backend failed to start' })
    expect(runtime.pendingTurn).toBeNull()
    runtime.dispose()
  })

  it('resends exactly the original command under the same id', async () => {
    let fail = true
    const { client, runtime } = runtimeWith(async () => (fail ? Promise.reject(new Error('not connected')) : { ok: true }))
    runtime.send('hello', { clientMessageId: 'u', model: 'm1' })
    await settle()
    expect(runtime.session.messages[0]?.metadata?.sendFailure).toEqual({ error: 'not connected' })

    fail = false
    runtime.resendFailedMessage('u')
    await settle()
    const sends = client.request.mock.calls.map(([cmd]) => cmd as { type: string; requestId?: string })
    expect(sends).toHaveLength(2)
    const strip = ({ requestId: _, ...rest }: { requestId?: string }) => rest
    expect(strip(sends[1]!)).toEqual(strip(sends[0]!))
    expect(runtime.session.messages).toHaveLength(1)
    expect(runtime.session.messages[0]?.metadata?.sendFailure).toBeUndefined()
    expect(runtime.pendingTurn).toBe('sending')
    runtime.dispose()
  })

  it('moves a failed queued send into the transcript', async () => {
    const { runtime } = runtimeWith(async () => ({ error: 'refused' }))
    runtime.send('later', { clientMessageId: 'q', priority: 'next' })
    await settle()
    expect(runtime.session.queuedMessages).toEqual([])
    expect(runtime.session.messages.map((m) => m.id)).toEqual(['q'])
    runtime.dispose()
  })

  it('takes a failed message out for editing and forgets its replay', async () => {
    const { client, runtime } = runtimeWith(async () => ({ error: 'refused' }))
    runtime.send('hello', { clientMessageId: 'u', images: [IMAGE] })
    await settle()
    const taken = runtime.takeFailedMessage('u')
    expect(taken?.attachments).toEqual([IMAGE])
    expect(runtime.session.messages).toEqual([])
    runtime.resendFailedMessage('u')
    await settle()
    expect(client.request).toHaveBeenCalledTimes(1)
    expect(runtime.takeFailedMessage('missing')).toBeNull()
    runtime.dispose()
  })

  it('does not cache a failed bubble, so it cannot outlive its replay', async () => {
    const put = vi.fn()
    const client = { send: vi.fn(), request: vi.fn(async () => ({ error: 'refused' })) }
    const runtime = new ChatRuntime(client as never, vi.fn(), { pairingId: () => 'host', transcripts: { get: () => null, put } as never })
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.ingest([{ type: 'user_message_appended', message: { id: 'ok', role: 'user', status: 'complete', content: [{ type: 'text', text: 'earlier' }], createdAt: '', providerId: 'local' } }])
    runtime.send('hello', { clientMessageId: 'u' })
    await settle()
    runtime.dispose()
    expect(put.mock.calls.at(-1)?.[3].messages.map((m: { id: string }) => m.id)).toEqual(['ok'])
  })
})
