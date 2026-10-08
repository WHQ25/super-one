import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayClient, type SocketLike } from '@superone/relay-client'
import { TEST_LINK, completeHandshake, type TestHost } from '../../../packages/relay-client/src/test-host-link'
import { ChatRuntime } from './runtime'

class MockSocket implements SocketLike {
  sent: string[] = []
  onopen: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  send(data: string): void { this.sent.push(data) }
  close(): void {}
  emit(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
  drop(): void { this.onclose?.() }
}

afterEach(() => vi.useRealTimers())

describe('live RN ↔ relay integration', () => {
  it('rehydrates a mid-stream flap, releases buffered events, and rejects the stale epoch', async () => {
    vi.useFakeTimers()
    const sockets: MockSocket[] = []
    const hosts = new WeakMap<MockSocket, TestHost>()
    let runtime!: ChatRuntime
    const paints: string[] = []
    const client = new RelayClient({
      openSocket: () => {
        const socket = new MockSocket()
        sockets.push(socket)
        queueMicrotask(() => socket.onopen?.())
        return socket
      },
      onEvents: (events, epoch) => runtime.ingest(events, epoch),
    })
    runtime = new ChatRuntime(client, (session) => {
      const message = session.messages.find((item) => item.id === 'm')
      const text = message?.content.find((block) => block.type === 'text')
      paints.push(text?.type === 'text' ? text.text : '')
    })

    const cursors = new WeakMap<MockSocket, number>()
    const nextCommand = async (socket: MockSocket) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const start = cursors.get(socket) ?? 0
        for (let index = start; index < socket.sent.length; index++) {
          const frame = JSON.parse(socket.sent[index]) as { type?: string; data?: string }
          if (frame.type !== 'command' || !frame.data) continue
          cursors.set(socket, index + 1)
          return hosts.get(socket)!.openCommand(frame.data) as { requestId: string; type: string }
        }
        await Promise.resolve()
      }
      throw new Error('expected RPC command')
    }
    const respond = async (socket: MockSocket, body: unknown) => {
      const command = await nextCommand(socket)
      socket.emit({
        type: 'response',
        requestId: command.requestId,
        data: hosts.get(socket)!.seal('response', body, command.requestId),
      })
      return command
    }
    const emitEvent = (socket: MockSocket, seq: number, event: unknown) => socket.emit({
      type: 'event',
      seq,
      data: hosts.get(socket)!.seal('event', event),
    })

    const connected = client.connectRelay({ relayUrl: 'wss://relay.example', link: TEST_LINK, deviceId: 'phone-1' })
    await vi.runAllTicks()
    await connected
    const first = sockets[0]
    hosts.set(first, completeHandshake(first))
    const opening = runtime.open('/project', 'session')
    expect((await respond(first, { ok: true })).type).toBe('subscribe_session')
    expect((await respond(first, { messages: [], hasMore: false, provider: 'claude' })).type).toBe('load_session_messages')
    emitEvent(first, 1, {
      type: 'message_start',
      message: { id: 'm', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    expect((await respond(first, { status: 'streaming', pendingInteractions: [], inProgressMessages: [] })).type).toBe('get_session_state')
    await opening
    expect(runtime.epoch).toBe(1)

    emitEvent(first, 2, { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'before' } })
    vi.advanceTimersByTime(33)
    expect(paints.at(-1)).toBe('before')

    first.drop()
    const reconnecting = client.reconnect()
    await vi.runAllTicks()
    await reconnecting
    const second = sockets[1]
    hosts.set(second, completeHandshake(second))
    const reopening = runtime.reopen()
    await respond(second, { ok: true })
    await respond(second, {
      messages: [{
        id: 'm',
        role: 'assistant',
        status: 'streaming',
        content: [{ type: 'text', text: 'before' }],
        createdAt: '',
        providerId: 'claude',
      }],
      hasMore: false,
      provider: 'claude',
    })
    emitEvent(second, 3, { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: ' during' } })
    await respond(second, { status: 'streaming', pendingInteractions: [], inProgressMessages: [] })
    await reopening
    expect(runtime.epoch).toBe(2)
    expect(paints.at(-1)).toBe('before during')

    runtime.ingest([{ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: ' stale' } }], 1)
    emitEvent(second, 4, { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: ' after' } })
    vi.advanceTimersByTime(33)
    expect(paints.at(-1)).toBe('before during after')
  })
})
