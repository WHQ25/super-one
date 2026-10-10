import { nativeRestoreClient, nativeSessionLoad } from './native-restore.test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { Session } from './session'
import type { SendDelivery, SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', () => ({ ensureShellPath: async () => {}, isShellPathReady: () => true }))

function fixture(start: () => Promise<void>) {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: 'claude', start: vi.fn(start), send: vi.fn(async (_request: SendMessageRequest, _delivery?: SendDelivery) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
    getPendingInteractions: () => [],
  }
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'claude', harnessId: 'claude', providerConfig: {}, backend: backend as unknown as SessionBackend })
  return { session, backend, emit: (event: AgentEvent) => emit(event) }
}

async function openOnMobile(session: Session) {
  const client = nativeRestoreClient(() => nativeSessionLoad(session), () => [session.getReplayEvents()])
  const runtime = new ChatRuntime(client as never, () => {})
  await runtime.open('/project', 'session')
  return runtime
}

describe('a send the host admitted but never started', () => {
  it('keeps the failure on the user row for a phone that was away when it failed', async () => {
    const { session } = fixture(async () => { throw new Error('spawn claude ENOENT') })
    const onAccepted = vi.fn()
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' }, { providerOrigin: 'remote', onAccepted }))
      .rejects.toThrow('spawn claude ENOENT')
    expect(onAccepted).toHaveBeenCalledOnce()

    const runtime = await openOnMobile(session)
    const row = runtime.session.messages.find((message) => message.id === 'u1')
    expect(row).toBeDefined()
    expect(row?.metadata?.sendFailure).toEqual({ error: 'spawn claude ENOENT' })
    expect(runtime.session.status).toBe('idle')
    runtime.dispose()
  })

  it('tells live subscribers, and clears the row when it is sent again under the same id', async () => {
    let fail = true
    const { session, backend } = fixture(async () => { if (fail) throw new Error('spawn claude ENOENT') })
    const live: AgentEvent[] = []
    session.on((event) => live.push(event))
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).rejects.toThrow()
    expect(live).toContainEqual(expect.objectContaining({ type: 'user_message_send_failed', clientMessageId: 'u1', error: 'spawn claude ENOENT' }))

    fail = false
    await session.send({ content: 'hello', clientMessageId: 'u1' })
    expect(backend.send).toHaveBeenCalledOnce()
    expect(session.snapshot.messages.filter((message) => message.id === 'u1')).toHaveLength(1)
    expect(session.snapshot.messages[0]?.metadata?.sendFailure).toBeUndefined()
  })

  it('keeps a queued send the backend refused as a failed row a restore shows, and resends it', async () => {
    const { session, backend, emit } = fixture(async () => {})
    await session.send({ content: 'first', clientMessageId: 'u1' })
    emit({ type: 'status_change', status: 'streaming' })
    const live: AgentEvent[] = []
    session.on((event) => live.push(event))
    backend.send.mockRejectedValueOnce(new Error('not connected'))
    await expect(session.send({ content: 'later', clientMessageId: 'u2', priority: 'next' })).rejects.toThrow('not connected')

    expect(session.getQueuedMessagesEvent()).toBeNull()
    expect(live.map((event) => event.type)).toEqual(['queued_messages_changed', 'user_message_send_failed', 'queued_messages_changed'])
    emit({ type: 'status_change', status: 'idle' })
    const runtime = await openOnMobile(session)
    const row = runtime.session.messages.find((message) => message.id === 'u2')
    expect(row?.metadata?.sendFailure).toEqual({ error: 'not connected' })
    expect(runtime.session.queuedMessages).toEqual([])
    runtime.dispose()

    await session.send({ content: 'later', clientMessageId: 'u2' })
    expect(backend.send).toHaveBeenLastCalledWith(expect.objectContaining({ clientMessageId: 'u2' }), expect.anything())
    expect(session.snapshot.messages.filter((message) => message.id === 'u2')).toHaveLength(1)
    expect(session.snapshot.messages.find((message) => message.id === 'u2')?.metadata?.sendFailure).toBeUndefined()
  })

  it('clears the marker on every other subscriber when one retries, and holds a stale Resend', async () => {
    let fail = true
    const { session, backend } = fixture(async () => { if (fail) throw new Error('spawn claude ENOENT') })
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).rejects.toThrow()
    const phone = await openOnMobile(session)
    session.on((event) => phone.ingest([event]))
    expect(phone.session.messages[0]?.metadata?.sendFailure).toBeDefined()

    fail = false
    await session.send({ content: 'hello', clientMessageId: 'u1' })
    expect(phone.session.messages[0]?.metadata?.sendFailure).toBeUndefined()

    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).resolves.toEqual({ duplicate: true })
    expect(backend.send).toHaveBeenCalledOnce()
    phone.dispose()
  })

  it('holds a second send of an id still waiting for its turn', async () => {
    const { session, backend } = fixture(async () => {})
    const [first, second] = await Promise.all([
      session.send({ content: 'hello', clientMessageId: 'u1' }),
      session.send({ content: 'hello', clientMessageId: 'u1' }),
    ])
    expect(first).toBeUndefined()
    expect(second).toEqual({ duplicate: true })
    expect(backend.send).toHaveBeenCalledOnce()
  })

  const start = (id: string): AgentEvent =>
    ({ type: 'message_start', message: { id, role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' } })

  it('holds a send the backend handed to the harness before it failed', async () => {
    const { session, backend, emit } = fixture(async () => {})
    backend.send.mockImplementation(async (_request: SendMessageRequest, delivery?: SendDelivery) => {
      emit(start('a1'))
      delivery?.onInputAccepted()
      throw new Error('stream broke')
    })
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).rejects.toThrow('stream broke')
    expect(session.snapshot.messages.find((message) => message.id === 'u1')?.metadata?.sendFailure).toBeUndefined()
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).resolves.toEqual({ duplicate: true })
    expect(backend.send).toHaveBeenCalledOnce()
  })

  it('fails a send that never reached the harness although the backend opened a reply, and drops that row everywhere', async () => {
    const { session, backend, emit } = fixture(async () => {})
    const phone = await openOnMobile(session)
    session.on((event) => phone.ingest([event]))
    // OpenCode's shape: message_start first, then the runtime cannot connect,
    // reported by event without a throw.
    backend.send.mockImplementationOnce(async () => {
      emit(start('a1'))
      emit({ type: 'message_error', messageId: 'a1', error: 'environment is not connected' })
    })
    await session.send({ content: 'hello', clientMessageId: 'u1' })
    expect(session.snapshot.messages.map((message) => message.id)).toEqual(['u1'])
    expect(session.snapshot.messages[0]?.metadata?.sendFailure).toEqual({ error: 'environment is not connected' })
    expect(phone.session.messages.map((message) => message.id)).toEqual(['u1'])
    expect(phone.session.messages[0]?.metadata?.sendFailure).toEqual({ error: 'environment is not connected' })

    backend.send.mockImplementationOnce(async (_request: SendMessageRequest, delivery?: SendDelivery) => {
      emit(start('a2'))
      delivery?.onInputAccepted()
      emit({ type: 'content_delta', messageId: 'a2', delta: { type: 'text', text: 'done' } })
    })
    await session.send({ content: 'hello', clientMessageId: 'u1' })
    expect(backend.send).toHaveBeenCalledTimes(2)
    expect(session.snapshot.messages.map((message) => message.id)).toEqual(['u1', 'a2'])
    expect(session.snapshot.messages[0]?.metadata?.sendFailure).toBeUndefined()
    phone.dispose()
  })

  it('takes agent output as delivery when the backend never signals it', async () => {
    const { session, backend, emit } = fixture(async () => {})
    backend.send.mockImplementation(async () => {
      emit(start('a1'))
      emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'partial' } })
      throw new Error('stream broke')
    })
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).rejects.toThrow('stream broke')
    expect(session.snapshot.messages.find((message) => message.id === 'u1')?.metadata?.sendFailure).toBeUndefined()
  })
})
