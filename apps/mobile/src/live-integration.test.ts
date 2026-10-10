import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayClient, type SocketLike } from '@superone/relay-client'
import { TEST_LINK, completeNativeHandshake, type TestHost } from '../../../packages/relay-client/src/test-host-link'
import { ChatRuntime } from './runtime'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'

const message = (text: string): ChatMessage => ({ id: 'm', role: 'assistant', status: 'streaming',
  content: text ? [{ type: 'text', text }] : [], createdAt: '', providerId: 'claude' })

class MockSocket implements SocketLike {
  sent: string[] = []
  onopen: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  host?: TestHost
  subscriptionId = ''
  constructor(readonly phase: number) {}
  send(data: string): void {
    this.sent.push(data)
    if (!this.host || !data.startsWith('{')) return
    const frame = JSON.parse(data)
    if (frame.type !== 'command') return
    const request = this.host.openRpc(frame.data)
    if (request?.type !== 'rpc') return
    queueMicrotask(() => this.answer(request))
  }
  private answer(request: Record<string, unknown>): void {
    const p = request.payload as Record<string, unknown>
    let result: unknown
    switch (request.method) {
      case 'project.list': result = [{ projectId: 'p', path: '/project', name: 'project' }]; break
      case 'environment.descriptor': result = { capabilities: { methods: [] } }; break
      case 'session.load': result = { sessionId: 'session', projectId: 'p', messages: this.phase ? [message('before')] : [],
        state: { status: 'streaming', sessionProvider: 'claude' }, before: null,
        cursor: { sequence: this.phase ? '2' : '0', version: this.phase ? 2 : 0, epoch: 'e' } }; break
      case 'session.acquireControl': result = { resource: { environmentId: 'desk', sessionId: 'session' }, leaseId: `grant-${this.phase}`,
        generation: '1', holderClientId: 'desktop:desk', delegate: 'phone:phone-1', expiresAt: new Date(Date.now() + 60_000).toISOString() }; break
      case 'topic.subscribe':
        this.subscriptionId = String(p.subscriptionId)
        // Native follow registers its stream before the receipt. Restore must
        // retain these pushed frames while it installs the atomic snapshot.
        this.event(this.phase ? 3 : 1, this.phase
          ? { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: ' during' } }
          : { type: 'message_start', message: message('') })
        result = { subscriptionId: this.subscriptionId }; break
      case 'topic.unsubscribe': case 'session.releaseControl': result = { ok: true }; break
      default: throw new Error(`Unexpected native RPC ${request.method}`)
    }
    this.host!.sendRpc(this, { type: 'rpc_result', requestId: request.requestId, result })
  }
  event(sequence: number, event: AgentEvent): void {
    this.host!.sendRpc(this, { type: 'stream', subscriptionId: this.subscriptionId, frame: { sequence: String(sequence), epoch: 'e', events: [{
      eventId: `event-${sequence}`, sequence: String(sequence), timestamp: 0, environmentId: 'desk', aggregateType: 'session', aggregateId: 'session',
      eventType: 'session.agent_event', eventVersion: 1, sessionVersion: sequence, payload: { event },
    }] } }, { push: true })
  }
  close(): void {}
  emit(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
  drop(): void { this.onclose?.() }
  handshake(): void { this.host = completeNativeHandshake(this) }
}

afterEach(() => vi.useRealTimers())

describe('live RN native relay integration', () => {
  it('restores a mid-stream flap, releases native buffered frames, and rejects the stale epoch', async () => {
    vi.useFakeTimers()
    const sockets: MockSocket[] = []
    let runtime!: ChatRuntime
    const paints: string[] = []
    const client = new RelayClient({ openSocket: () => {
      const socket = new MockSocket(sockets.length)
      sockets.push(socket); queueMicrotask(() => socket.onopen?.()); return socket
    }, onEvents: (events, epoch) => runtime.ingest(events, epoch) })
    runtime = new ChatRuntime(client, session => {
      const text = session.messages.find(item => item.id === 'm')?.content.find(block => block.type === 'text')
      paints.push(text?.type === 'text' ? text.text : '')
    })
    const connected = client.connectRelay({ relayUrl: 'wss://relay.example', link: TEST_LINK, deviceId: 'phone-1' })
    await vi.runAllTicks(); await connected
    sockets[0]!.handshake()
    await runtime.open('/project', 'session')
    expect(runtime.epoch).toBe(1)
    sockets[0]!.event(2, { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'before' } })
    vi.advanceTimersByTime(33)
    expect(paints.at(-1)).toBe('before')

    sockets[0]!.drop()
    const reconnecting = client.reconnect()
    await vi.runAllTicks(); await reconnecting
    sockets[1]!.handshake()
    await runtime.reopen()
    expect(runtime.epoch).toBe(2)
    expect(paints.at(-1)).toBe('before during')
    runtime.ingest([{ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: ' stale' } }], 1)
    sockets[1]!.event(4, { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: ' after' } })
    vi.advanceTimersByTime(33)
    expect(paints.at(-1)).toBe('before during after')
    runtime.dispose(); client.disconnect()
  })
})
