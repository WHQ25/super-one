import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { Session } from './session'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', () => ({ ensureShellPath: async () => {}, isShellPathReady: () => true }))

function fixture(start: () => Promise<void>) {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: 'claude', start: vi.fn(start), send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
    getPendingInteractions: () => [],
  }
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'claude', harnessId: 'claude', providerConfig: {}, backend: backend as unknown as SessionBackend })
  return { session, backend, emit: (event: AgentEvent) => emit(event) }
}

async function openOnMobile(session: Session) {
  const client = {
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [session.getReplayEvents()] }),
    async request(command: { type: string }) {
      if (command.type !== 'subscribe_session') return { ok: true }
      return { historyPage: { messages: session.snapshot.messages, provider: 'claude', hasMore: false }, snapshot: { status: 'idle' } }
    },
  }
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
    expect(backend.send).toHaveBeenLastCalledWith(expect.objectContaining({ clientMessageId: 'u2' }))
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

  it('leaves the row alone when the turn had already replied', async () => {
    const { session, backend, emit } = fixture(async () => {})
    backend.send.mockImplementation(async () => {
      emit({ type: 'message_start', message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' } })
      throw new Error('stream broke')
    })
    await expect(session.send({ content: 'hello', clientMessageId: 'u1' })).rejects.toThrow('stream broke')
    expect(session.snapshot.messages.find((message) => message.id === 'u1')?.metadata?.sendFailure).toBeUndefined()
  })
})
