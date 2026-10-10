import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import WebSocket from 'ws'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, type ChatCorePorts } from '@superone/chat-core'
import { issueChannelCredential, startClientHandshake, acceptClientHello, type SecureChannel } from '@superone/relay-client/secure-channel'
import { openLinkFrame } from '@superone/relay-client/phone-link'
import { decodeHostPlaintext } from '@superone/relay-client/host-payload'
import scenarios from './fixtures/emitted.generated.json'

const history = vi.hoisted(() => ({ messages: [] as ChatMessage[] }))

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  whenHighlighterReady: async () => {},
  highlightCodeSync: () => null,
  highlightCodeByLang: () => null,
  parseAnsiTokens: () => [],
}))
vi.mock('../environment/session-identity', () => ({ localSessionEnvironmentId: () => 'env-local' }))
vi.mock('../session/realtime-timeline-repo', () => ({ loadRealtimeTimeline: () => null }))
vi.mock('../db-sessions', () => ({
  /** `loadSessionMessagesPaginated`'s windowing over the reduced transcript. */
  loadSessionMessagesPaginated: (_sessionId: string, limit: number, cursor?: number) => {
    const count = history.messages.length
    const end = Math.min(count, Math.max(0, Math.floor(cursor ?? count)))
    const start = Math.max(0, end - Math.min(200, Math.max(1, Math.floor(limit))))
    return { messages: history.messages.slice(start, end), cursor: start > 0 ? start : null, hasMore: start > 0 }
  },
}))

import { RemoteControlService } from '../remote-control-service'
import { MobileBroadcaster } from '../remote/mobile-broadcaster'
import { PhoneTopics } from '../remote/phone-topics'
import { createDesktopTopicHub, publishHubEvent } from './desktop-topics'
import { setProgressiveSession, projectProgressiveMessage, subscribeDetail, unsetProgressiveSession } from '../remote/progressive-session'
import { buildProgressiveBootstrap } from '../agent/progressive-bootstrap'
import { stripMessagesForRemote } from '../remote-content'
import type { Session, SessionLifecycleEvent, SessionManager } from '../session/types'

/**
 * What a relayed phone pays today for recorded session output, measured on the
 * relay socket after the real profile, projection, batching, DEFLATE, sealing
 * and chunking. Later protocol steps compare against `wire-baseline.json`; a
 * change here is a wire change, not a snapshot to update.
 */

const ROOT = 'ab'.repeat(32)
const PHONE = 'phone-1'
const PROJECT = '/Users/me/project'
const EVENT_SPACING_MS = 10

type Wire = { frames: number; bytes: number }
type Recording = { recording: string; events: AgentEvent[] }

function openChannels(): { host: SecureChannel; phone: SecureChannel } {
  const credential = issueChannelCredential(ROOT, 'key-phone-1')
  const client = startClientHandshake(credential)
  const accept = acceptClientHello(client.hello, () => credential.secretHex)
  const { proof, channel: phone } = client.finish(accept.challenge)
  return { host: accept.finish(proof), phone }
}

/** The service with one relay phone and a socket that records what it is asked to send. */
async function relayService() {
  const { host, phone } = openChannels()
  const sent: string[] = []
  const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
  const ws = { readyState: WebSocket.OPEN, send: (text: string) => { sent.push(text) } }
  const internals = service as unknown as {
    keys: unknown
    phoneLink: unknown
    relayWs: unknown
    relayLinks: Map<string, unknown>
    connectedDevices: Map<string, unknown>
    sendQueue: Promise<void>
    sendResponse: (requestId: string, data: unknown, deviceId: string, channel: SecureChannel) => Promise<void>
  }
  internals.keys = { rootSecret: ROOT, channelKeyHex: 'c' }
  internals.phoneLink = await import('../remote/phone-link-host')
  internals.relayWs = ws
  internals.relayLinks.set(PHONE, { handshake: null, channel: host, device: { keyId: 'key-phone-1', deviceId: PHONE, deviceName: 'iPhone', secretHex: '', enabled: true } })
  internals.connectedDevices.set(PHONE, { name: 'iPhone', transports: new Set(['relay']) })

  /** Frames opened as the phone would, so the baseline only counts readable frames. */
  const decoded: unknown[] = []
  let read = 0
  const drain = (): void => {
    for (; read < sent.length; read++) {
      const frame = JSON.parse(sent[read]) as { type: string; data: string }
      if (frame.type === 'response_chunk') continue
      const { payload } = openLinkFrame(phone, frame.data)
      decoded.push(decodeHostPlaintext(payload))
    }
  }
  const measure = (from: number): Wire => {
    const frames = sent.slice(from)
    return { frames: frames.length, bytes: frames.reduce((sum, text) => sum + Buffer.byteLength(text), 0) }
  }
  return {
    service,
    sent,
    decoded,
    drain,
    measure,
    settle: () => internals.sendQueue,
    respond: (requestId: string, data: unknown) => internals.sendResponse(requestId, data, PHONE, host),
  }
}

function fakeSession(sessionId: string, messages: () => ChatMessage[]): Session & { emit(event: SessionLifecycleEvent): void } {
  const listeners = new Set<(event: SessionLifecycleEvent) => void>()
  return {
    onLifecycle: (listener: (event: SessionLifecycleEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    emit: (event: SessionLifecycleEvent) => { for (const listener of listeners) listener(event) },
    id: sessionId,
    projectPath: PROJECT,
    ephemeral: false,
    get snapshot() { return { messages: messages(), harnessId: 'claude' } },
    owner: { kind: 'local' },
    subscribers: new Set([PHONE]),
    getQueuedMessagesEvent: () => null,
    getPendingInteractions: () => [],
    isStreaming: () => false,
    getCurrentSandboxInfo: () => undefined,
    getCurrentPermissionMode: () => 'default',
    getUiSettings: () => ({ ultracode: false }),
    getSessionGoal: () => null,
    activityStatus: () => 'idle',
    seenCompletedMessageId: null,
    realtimeActive: false,
  } as unknown as Session & { emit(event: SessionLifecycleEvent): void }
}

const reducerPorts = (): ChatCorePorts => ({ now: () => 0, id: (prefix) => `${prefix}id`, streaming: createStreamingToolInputStore() })

/** Every detail reference a projected transcript exposes, in order. */
function detailRefs(messages: ChatMessage[]): Array<{ messageId: string; ref: string }> {
  const refs: Array<{ messageId: string; ref: string }> = []
  for (const message of messages.map(projectProgressiveMessage)) {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(visit); return }
      for (const [key, child] of Object.entries(value)) {
        if (key === 'remoteDetail' && typeof child === 'string') refs.push({ messageId: message.id, ref: child })
        else visit(child)
      }
    }
    visit(message.content)
    visit(message.metadata?.codex?.items)
  }
  return [...new Map(refs.map((entry) => [entry.ref, entry])).values()]
}

async function measureRecording({ recording, events }: Recording) {
  vi.useFakeTimers({ now: 0 })
  const sessionId = `recorded-${recording}`
  const relay = await relayService()
  let reduced = createDefaultChatCoreSession()
  const ports = reducerPorts()
  const session = fakeSession(sessionId, () => reduced.messages)
  const getSession = (id: string) => id === sessionId ? session : undefined
  // Main's phone path: hub event → topic → the phones' delivery group.
  const topics = createDesktopTopicHub()
  const phones = new PhoneTopics(topics, new MobileBroadcaster({ getSession } as unknown as SessionManager, relay.service, 'env-local'), 'env-local')
  phones.online(PHONE, 'relay')
  phones.watchSession(session)
  session.emit({ type: 'subscriber_added', sessionId, deviceId: PHONE })

  // Live turn: a progressive phone watching the session while it streams.
  setProgressiveSession(PHONE, sessionId)
  for (const raw of events.filter((event) => typeof event.type === 'string')) {
    const event = { ...raw, sessionId, projectPath: PROJECT } as AgentEvent
    reduced = { ...reduced, ...applyEventToSession(reduced, event, ports) }
    publishHubEvent(topics, { event, source: 'session', sessionId }, { localEnvironmentId: 'env-local', getSession, spawnParentOf: () => null })
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(EVENT_SPACING_MS)
  }
  vi.advanceTimersByTime(1_000)
  vi.useRealTimers()
  await relay.settle()
  const live = relay.measure(0)

  // Session open: one `subscribe_session { progressive: true }` response.
  history.messages = reduced.messages
  let mark = relay.sent.length
  await relay.respond('open', await buildProgressiveBootstrap(session, PROJECT, sessionId))
  const open = relay.measure(mark)

  // Detail expansion: every deferred row opened once.
  mark = relay.sent.length
  const refs = detailRefs(reduced.messages)
  for (const [index, { messageId, ref }] of refs.entries()) {
    const message = reduced.messages.find((candidate) => candidate.id === messageId)!
    let response: unknown
    try { response = subscribeDetail(PHONE, sessionId, `d${index}`, ref, message) } catch (error) { response = { error: (error as Error).message } }
    await relay.respond(`detail-${index}`, response)
  }
  const detail = { ...relay.measure(mark), refs: refs.length }
  unsetProgressiveSession(PHONE)

  relay.drain()
  return { recording, live: { ...live, payload: payloadDigest(relay.decoded.slice(0, live.frames)) }, open, detail, messages: reduced.messages, decodedFrames: relay.decoded.length }
}

/**
 * The event sequence the phone applies, independent of how it was framed:
 * batches flattened, so a change that only regroups frames keeps the digest.
 */
function payloadDigest(frames: unknown[]): { events: number; sha256: string } {
  const events = frames.flatMap((frame) => Array.isArray(frame) ? frame : [frame])
  return { events: events.length, sha256: createHash('sha256').update(JSON.stringify(events)).digest('hex') }
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Each recording is a short session, so paging is measured on all of them
 * back to back: the open, then the page before the bootstrap's eight, as
 * `load_session_messages { cursor, limit: 24 }` answers it.
 */
async function measureHistory(messages: ChatMessage[]) {
  const relay = await relayService()
  const sessionId = 'recorded-combined'
  history.messages = messages
  setProgressiveSession(PHONE, sessionId)
  await relay.respond('open', await buildProgressiveBootstrap(fakeSession(sessionId, () => []), PROJECT, sessionId))
  const open = relay.measure(0)
  const before = messages.length - 8
  const page = messages.slice(Math.max(0, before - 24), before)
  await relay.respond('history', { messages: stripMessagesForRemote(page.map(projectProgressiveMessage), PROJECT), hasMore: before > 24, cursor: before > 24 ? before - 24 : null, provider: 'claude' })
  const historyPage = { ...relay.measure(1), messages: page.length }
  unsetProgressiveSession(PHONE)
  relay.drain()
  expect(relay.decoded).toHaveLength(2)
  return { open, history: historyPage }
}

describe('relay wire baseline', () => {
  it('records bytes and frames a relayed phone receives for recorded sessions', async () => {
    const results = []
    for (const recording of scenarios as Recording[]) results.push(await measureRecording(recording))
    for (const result of results) {
      // Every frame the relay carried opens on the phone's channel.
      expect(result.decodedFrames).toBeGreaterThan(0)
    }
    const combined = await measureHistory(results.flatMap((result) => result.messages))
    const baseline = {
      ...Object.fromEntries(results.map(({ recording, decodedFrames: _d, messages: _m, ...wire }) => [recording, wire])),
      combined,
    }
    await expect(JSON.stringify(baseline, null, 2) + '\n').toMatchFileSnapshot('./fixtures/wire-baseline.json')
  })
})
