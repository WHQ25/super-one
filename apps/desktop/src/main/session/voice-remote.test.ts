import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { mapRealtimeTurnActivities } from '@superone/shared/realtime-turn-activities'
import { buildRealtimeConversationTurns } from '@superone/shared/realtime-transcript'
import { openNodeDatabase } from '@superone/runtime/db'
import { createSqliteHostActionStore } from '@superone/runtime/session'
import type { DoubaoConnection, DoubaoSocket } from '../doubao/doubao-socket'
import type { GeminiSocket } from '../gemini/gemini-socket'
import type { Session } from './types'

const hoisted = vi.hoisted(() => ({
  holdSession: vi.fn(),
  openRemoteSession: vi.fn(),
  sendSessionMessage: vi.fn(),
  callSession: vi.fn(),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../environment/environment-host', () => ({
  getEnvironmentHost: () => ({
    holdSession: hoisted.holdSession,
    openRemoteSession: hoisted.openRemoteSession,
    sendSessionMessage: hoisted.sendSessionMessage,
    callSession: hoisted.callSession,
  }),
}))

vi.mock('../doubao/doubao-speech-settings', () => ({
  getDoubaoSpeechKey: () => 'doubao-key',
  getDoubaoSpeaker: () => 'zh_female_vv_jupiter_bigtts',
}))

vi.mock('../gemini/gemini-speech-settings', () => ({
  getGeminiSpeechKey: () => 'gemini-key',
  getGeminiVoice: () => 'Aoede',
}))

import { publishVoiceRemoteEvent } from './voice-remote-events'
import { RemoteVoiceConversation } from './voice-conversation'
import { RealtimeVoiceHost } from './realtime-voice-host'
import { DoubaoVoiceHost } from './doubao-voice-host'
import { GeminiVoiceHost } from './gemini-voice-host'
import { DesktopSessionHost, type NodeHostSessionManager } from '../node-host/desktop-session-host'
import type { DesktopSessionStore } from '../node-host/desktop-session-reads'

function fakeSender(id: number): WebContents & { destroyed: boolean; sendMock: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter()
  const sendMock = vi.fn()
  const sender = Object.assign(emitter, {
    id,
    destroyed: false,
    isDestroyed() { return this.destroyed },
    send: sendMock,
    sendMock,
  })
  return sender as unknown as WebContents & { destroyed: boolean; sendMock: ReturnType<typeof vi.fn> }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('RemoteVoiceConversation', () => {
  beforeEach(() => {
    hoisted.holdSession.mockReset()
    hoisted.openRemoteSession.mockReset()
    hoisted.sendSessionMessage.mockReset()
    hoisted.callSession.mockReset()
    hoisted.holdSession.mockResolvedValue(undefined)
    hoisted.openRemoteSession.mockResolvedValue({
      state: { sessionProvider: 'claude', status: 'idle' },
      cursor: { version: 100 },
      messages: [],
      activeTurn: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores stale control loss at or below baseline while honoring live control loss', async () => {
    const published: AgentEvent[] = []
    const conv = new RemoteVoiceConversation({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      source: 'doubao-voice',
    }, event => published.push(event))

    const openDeferred = deferred<unknown>()
    hoisted.openRemoteSession.mockReturnValueOnce(openDeferred.promise)
    const opening = conv.open()
    await vi.waitFor(() => expect(hoisted.openRemoteSession).toHaveBeenCalledTimes(1))

    publishVoiceRemoteEvent({
      type: 'remote_control_changed',
      released: true,
      sessionId: 'sid-1',
      projectPath: 'remote:env-1:/repo',
      seq: 100,
    })
    openDeferred.resolve({
      state: { sessionProvider: 'claude', status: 'idle' },
      cursor: { version: 100 },
      messages: [],
      activeTurn: [],
    })
    await opening
    expect(conv.lostControl).toBe(false)

    const lost = vi.fn()
    conv.onControlLost = lost
    publishVoiceRemoteEvent({
      type: 'session_control_holder',
      holder: { clientId: 'phone-1', label: 'iPhone', kind: 'phone' },
      sessionId: 'sid-1',
      projectPath: 'remote:env-1:/repo',
    })
    expect(conv.lostControl).toBe(true)
    expect(lost).toHaveBeenCalledTimes(1)
    conv.close()
  })

  it('stamps remote transcript items in remote seq scale so multi-turn activity stays attached', async () => {
    const published: AgentEvent[] = []
    const conv = new RemoteVoiceConversation({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      source: 'doubao-voice',
    }, event => published.push(event))
    await conv.open()

    conv.publish({
      type: 'realtime_transcript_item',
      phase: 'started',
      itemId: 'u-1',
      role: 'user',
      text: 'First spoken task',
      realtimeSessionId: 'doubao',
    })
    publishVoiceRemoteEvent({
      type: 'user_message_appended',
      sessionId: 'sid-1',
      projectPath: 'remote:env-1:/repo',
      seq: 101,
      message: {
        id: 'm-u1',
        role: 'user',
        status: 'complete',
        content: [{ type: 'text', text: '<realtime_delegation/>' }],
        createdAt: '2026-11-15T00:00:01Z',
        providerId: 'claude',
        _lastAppliedSeq: 101,
        metadata: { source: 'doubao-voice', codexTimeline: { provenance: 'realtime-delegated', turnId: 't1' } },
      },
    })
    publishVoiceRemoteEvent({
      type: 'status_change',
      status: 'idle',
      sessionId: 'sid-1',
      projectPath: 'remote:env-1:/repo',
      seq: 103,
    })
    conv.publish({
      type: 'realtime_transcript_item',
      phase: 'started',
      itemId: 'u-2',
      role: 'user',
      text: 'Second spoken task',
      realtimeSessionId: 'doubao',
    })

    const item1 = published.find(event => event.type === 'realtime_transcript_item' && event.itemId === 'u-1')
    const item2 = published.find(event => event.type === 'realtime_transcript_item' && event.itemId === 'u-2')
    expect(item1?.seq).toBe(101)
    expect(item2?.seq).toBe(104)

    const turns = buildRealtimeConversationTurns([
      { id: 'u-1', realtimeSessionId: 'doubao', role: 'user', text: 'First spoken task', localOrder: item1?.seq },
      { id: 'u-2', realtimeSessionId: 'doubao', role: 'user', text: 'Second spoken task', localOrder: item2?.seq },
    ])
    const delegated1: ChatMessage = {
      id: 'm-a1',
      role: 'assistant',
      status: 'complete',
      content: [{ type: 'text', text: 'Done 1' }],
      createdAt: '2026-11-15T00:00:02Z',
      providerId: 'claude',
      _lastAppliedSeq: 102,
      metadata: { codexTimeline: { provenance: 'realtime-delegated', turnId: 't1' } },
    }
    const delegated2: ChatMessage = {
      id: 'm-a2',
      role: 'assistant',
      status: 'complete',
      content: [{ type: 'text', text: 'Done 2' }],
      createdAt: '2026-11-15T00:00:04Z',
      providerId: 'claude',
      _lastAppliedSeq: 105,
      metadata: { codexTimeline: { provenance: 'realtime-delegated', turnId: 't2' } },
    }
    const activities = mapRealtimeTurnActivities({
      turns,
      messages: [delegated1, delegated2],
      sessionStatus: 'idle',
      needsDecision: false,
    })
    expect(activities.get(turns[0]!.id)?.messageIds).toEqual(['m-a1'])
    expect(activities.get(turns[1]!.id)?.messageIds).toEqual(['m-a2'])
    conv.close()
  })

  it('renews the remote lease on heartbeat and reports control loss when released', async () => {
    vi.useFakeTimers()
    const conv = new RemoteVoiceConversation({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      source: 'gemini-voice',
    }, () => {})
    const lost = vi.fn()
    conv.onControlLost = lost
    await conv.open()

    hoisted.holdSession.mockRejectedValueOnce(Object.assign(new Error('Control released'), { details: { reason: 'control_released' } }))
    await vi.advanceTimersByTimeAsync(30_000)

    expect(hoisted.holdSession).toHaveBeenCalledTimes(2)
    expect(conv.lostControl).toBe(true)
    expect(lost).toHaveBeenCalledTimes(1)
    conv.close()
  })

  it('serializes sends and steers when streaming', async () => {
    hoisted.openRemoteSession.mockResolvedValueOnce({
      state: { sessionProvider: 'claude', status: 'streaming' },
      cursor: { version: 10 },
      messages: [],
      activeTurn: [],
    })
    const firstSend = deferred<unknown>()
    hoisted.sendSessionMessage.mockReturnValueOnce(firstSend.promise).mockResolvedValueOnce(undefined)
    hoisted.callSession.mockResolvedValue({ ok: true })

    const conv = new RemoteVoiceConversation({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      source: 'doubao-voice',
    }, () => {})
    await conv.open()

    const p1 = conv.send({ content: 'one', clientMessageId: 'c1' })
    const p2 = conv.send({ content: 'two', clientMessageId: 'c2' })
    await vi.waitFor(() => expect(hoisted.sendSessionMessage).toHaveBeenCalledTimes(1))
    expect(hoisted.callSession).not.toHaveBeenCalled()

    firstSend.resolve(undefined)
    await expect(p1).resolves.toBe(false)
    await expect(p2).resolves.toBe(false)
    expect(hoisted.callSession).toHaveBeenNthCalledWith(1, 'env-1', 'sid-1', 'session.steer', { clientMessageId: 'c1' })
    expect(hoisted.callSession).toHaveBeenNthCalledWith(2, 'env-1', 'sid-1', 'session.steer', { clientMessageId: 'c2' })
    conv.close()
  })
})

describe('VoiceHost concurrency and admission', () => {
  beforeEach(() => {
    hoisted.holdSession.mockReset()
    hoisted.openRemoteSession.mockReset()
    hoisted.holdSession.mockResolvedValue(undefined)
    hoisted.openRemoteSession.mockResolvedValue({
      state: { sessionProvider: 'claude', status: 'idle' },
      cursor: { version: 1 },
      messages: [],
      activeTurn: [],
    })
  })

  function fakeDoubaoConnector(): {
    connect: (apiKey: string) => Promise<DoubaoConnection>
    sent: string[]
    emitCreated: () => void
  } {
    const sent: string[] = []
    let onMessage: ((text: string) => void) | null = null
    return {
      sent,
      emitCreated: () => { onMessage?.(JSON.stringify({ type: 'session.created', session: { id: 'dlg-1' } })) },
      connect: async () => {
        const socket: DoubaoSocket = {
          send: data => { sent.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')) },
          close: () => {},
          onMessage: handler => { onMessage = handler },
          onClose: () => {},
        }
        return { socket, logid: 'log-1' }
      },
    }
  }

  function fakeGeminiConnector(): { connect: () => Promise<GeminiSocket> } {
    return {
      connect: async () => ({
        send: () => {},
        close: () => {},
        onFrame: () => {},
        onClose: () => {},
      }),
    }
  }

  it('preserves active Doubao call when a concurrent startRemote fails admission', async () => {
    const voices = new RealtimeVoiceHost()
    const { connect, sent, emitCreated } = fakeDoubaoConnector()
    const host = new DoubaoVoiceHost(voices, { connect })
    const sender1 = fakeSender(1)
    const sender2 = fakeSender(2)

    await host.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      sender: sender1,
      attemptId: 'att-1',
    })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    emitCreated()

    await expect(host.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-2',
      sender: sender2,
      attemptId: 'att-2',
    })).rejects.toThrow(/Another voice/)

    const beforeCount = sent.length
    host.setMuted(1, 'sid-1', true)
    expect(sent.length).toBeGreaterThan(beforeCount)

    await expect(host.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      sender: sender1,
      attemptId: 'att-1',
    })).resolves.toMatchObject({ call: { attemptId: 'att-1', sessionId: 'sid-1' } })

    const beforeUnmute = sent.length
    host.setMuted(1, 'sid-1', false)
    expect(sent.length).toBeGreaterThan(beforeUnmute)
    await voices.stopSeat({ endpointId: 'window:1', sessionId: 'sid-1', projectPath: 'remote:env-1:/repo', capability: { protocol: 1, supported: false }, busy: false, send: () => {} }, 'att-1')
  })

  it('rejects Doubao and Gemini startRemote when window closes during open', async () => {
    const voices = new RealtimeVoiceHost()
    const doubao = new DoubaoVoiceHost(voices, { connect: fakeDoubaoConnector().connect })
    const gemini = new GeminiVoiceHost(voices, { connect: fakeGeminiConnector().connect })

    const destroyed = fakeSender(9)
    const openGate = deferred<unknown>()
    hoisted.openRemoteSession.mockReturnValueOnce(openGate.promise)
    const p1 = doubao.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      sender: destroyed,
      attemptId: 'att-d',
    })
    await vi.waitFor(() => expect(hoisted.openRemoteSession).toHaveBeenCalledTimes(1))
    destroyed.destroyed = true
    openGate.resolve({ state: { sessionProvider: 'claude', status: 'idle' }, cursor: { version: 1 }, messages: [], activeTurn: [] })
    await expect(p1).rejects.toThrow(/Window closed/)

    const destroyed2 = fakeSender(10)
    const openGate2 = deferred<unknown>()
    hoisted.openRemoteSession.mockReturnValueOnce(openGate2.promise)
    const p2 = gemini.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      sender: destroyed2,
      attemptId: 'att-g',
    })
    await vi.waitFor(() => expect(hoisted.openRemoteSession).toHaveBeenCalledTimes(2))
    destroyed2.destroyed = true
    openGate2.resolve({ state: { sessionProvider: 'claude', status: 'idle' }, cursor: { version: 1 }, messages: [], activeTurn: [] })
    await expect(p2).rejects.toThrow(/Window closed/)
  })

  it('preserves active Gemini call when a concurrent startRemote fails admission', async () => {
    const voices = new RealtimeVoiceHost()
    const host = new GeminiVoiceHost(voices, { connect: fakeGeminiConnector().connect })
    const sender1 = fakeSender(11)
    const sender2 = fakeSender(12)

    await host.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-1',
      sender: sender1,
      attemptId: 'g-1',
    })
    await expect(host.startRemote({
      connectionId: 'env-1',
      projectPath: 'remote:env-1:/repo',
      sessionId: 'sid-2',
      sender: sender2,
      attemptId: 'g-2',
    })).rejects.toThrow(/Another voice/)

    expect(() => host.pushAudio(11, 'sid-1', new Uint8Array([1, 2]))).not.toThrow()
    await voices.stopSeat({ endpointId: 'window:11', sessionId: 'sid-1', projectPath: 'remote:env-1:/repo', capability: { protocol: 1, supported: false }, busy: false, send: () => {} }, 'g-1')
  })
})

describe('DesktopSessionHost.callOperation session.steer', () => {
  it('dispatches queued steer command and validates inputs', async () => {
    const dispatchBackendCommand = vi.fn(async () => {})
    const assertMutation = vi.fn()
    let harnessId = 'claude'
    const session = {
      id: 'sid-1',
      snapshot: {
        get harnessId() { return harnessId },
      },
      lease: { assertMutation },
      dispatchBackendCommand,
    } as unknown as Session

    const db = openNodeDatabase(':memory:')
    const host = new DesktopSessionHost({
      environmentId: 'env-1',
      sessions: { getSession: (id: string) => (id === 'sid-1' ? session : null), onSession: () => () => {} } as unknown as NodeHostSessionManager,
      rows: { get: () => ({ sessionId: 'sid-1', projectPath: '/repo' }) } as unknown as DesktopSessionStore,
      edits: {} as never,
      leases: {} as never,
      events: {} as never,
      hostActions: createSqliteHostActionStore(db),
      projectPath: () => '/repo',
      controllerLabel: () => null,
      controllerActive: () => true,
      controlHolder: () => null,
    })

    await expect(host.callOperation('sid-1', 'session.steer', { clientMessageId: 'q1' })).resolves.toEqual({ ok: true })
    expect(assertMutation).toHaveBeenCalledTimes(2)
    expect(dispatchBackendCommand).toHaveBeenCalledWith({ kind: 'claude.steer_queued', clientMessageId: 'q1' })

    await expect(host.callOperation('sid-1', 'session.steer', {})).rejects.toMatchObject({ code: 'invalid_argument' })
    harnessId = 'unknown'
    await expect(host.callOperation('sid-1', 'session.steer', { clientMessageId: 'q2' })).rejects.toMatchObject({ code: 'unsupported' })
  })
})
