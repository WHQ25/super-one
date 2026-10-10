import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { SessionLoadResult, SessionStreamMessage, TopicNoticeMessage } from '@superone/shared/environment'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore } from '@superone/chat-core'
import { projectProgressiveMessage } from '@superone/runtime/stream'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import scenarios from './fixtures/emitted.generated.json'
import baseline from './fixtures/wire-baseline.json'
import baselineEvents from './fixtures/wire-baseline-events.json'
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../remote-highlighter', () => ({ initHighlighter: vi.fn(), whenHighlighterReady: async () => {}, highlightCodeSync: () => null,
  highlightCodeByLang: () => null, parseAnsiTokens: () => [] }))
import { nativePhoneWire } from './native-phone-wire-fixture'
import { publishHubEvent } from './desktop-topics'
import type { Session } from '../session/types'

const cleanup: Array<() => void> = []
afterEach(() => { vi.useRealTimers(); while (cleanup.length) cleanup.pop()!() })
function detailRefs(messages: ChatMessage[]): string[] {
  const refs = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    for (const [key, child] of Object.entries(value)) if (key === 'remoteDetail' && typeof child === 'string') refs.add(child); else visit(child)
  }
  for (const message of messages.map(projectProgressiveMessage)) { visit(message.content); visit(message.metadata?.codex?.items) }
  return [...refs]
}
// Native cursors and completion timestamps are additional host facts. Compare
// application semantics separately from framing and additive-delta grouping.
function semanticEvent(event: AgentEvent): AgentEvent {
  const { seq: _seq, epoch: _epoch, environmentId: _env, projectPath: _path, sessionId: _sid, ...value } = event as AgentEvent & { seq?: number; epoch?: number }
  if ('metadata' in value && value.metadata) {
    const { completedAt: _at, ...metadata } = value.metadata
    return { ...value, metadata } as AgentEvent
  }
  return value as AgentEvent
}
function reduceWire(events: AgentEvent[]) {
  let state = createDefaultChatCoreSession()
  const ports = { now: () => 0, id: (prefix: string) => `${prefix}id`, streaming: createStreamingToolInputStore() }
  for (const event of events) state = { ...state, ...applyEventToSession(state, semanticEvent(event), ports) }
  return state
}
function interactions(events: AgentEvent[]) {
  return events.filter(event => ['permission_request', 'ask_user_question', 'plan_approval', 'interaction_resolved',
    'user_message_appended', 'queued_message_consumed', 'queued_messages_changed', 'session_title_changed',
    'message_complete', 'message_interrupted', 'message_error'].includes(event.type)).map(semanticEvent)
}
describe('native relay sender against immutable step-0 budgets', () => {
  it('measures recorded live, load, history and detail through native RPC and the sealed production sender', async () => {
    const measured: Record<string, Record<string, unknown>> = {}
    const all: ChatMessage[] = []
    for (const recording of scenarios as Array<{ recording: string; events: AgentEvent[] }>) {
      const wire = await nativePhoneWire(cleanup)
      const sessionId = `recorded-${recording.recording}`
      wire.store.createRow({ sessionId, projectPath: wire.projectDir, cwd: wire.projectDir })
      const session = wire.sessions.createSession({ id: sessionId, projectPath: wire.projectDir })
      const emitter = wire.sessions.live.get(sessionId)!
      Object.assign(emitter, { seenCompletedMessageId: null })
      let reduced = createDefaultChatCoreSession()
      const ports = { now: () => 0, id: (prefix: string) => `${prefix}id`, streaming: createStreamingToolInputStore() }
      Object.defineProperty(emitter, 'snapshot', { get: () => ({ messages: reduced.messages, harnessId: 'claude' }) })
      await wire.subscribe(sessionId)
      const mark = wire.mark()
      vi.useFakeTimers({ now: 0 })
      for (const raw of recording.events.filter(event => typeof event.type === 'string')) {
        const event = { ...raw, sessionId, projectPath: wire.projectDir } as AgentEvent
        reduced = { ...reduced, ...applyEventToSession(reduced, event, ports) }
        emitter.emitHostEvent(event)
        publishHubEvent(wire.hub, { event, source: 'session', sessionId }, { localEnvironmentId: wire.domain.identity.environmentId,
          recovery: wire.recovery(), getSession: id => id === sessionId ? session as Session : null, spawnParentOf: () => null })
        await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(10)
      }
      await vi.advanceTimersByTimeAsync(1000); vi.useRealTimers()
      const live = wire.measure(mark)
      const mapper = createNodeSessionEventMapper({ sessionId, projectPath: '/Users/me/project', providerId: 'claude' })
      const events = live.messages.flatMap(message => {
        const packet = message as SessionStreamMessage | TopicNoticeMessage
        if (packet.type === 'stream') return packet.frame.events.flatMap(event => mapper.map(event)).map(event => {
          const { seq: _seq, environmentId: _env, projectPath: _path, sessionId: _sid, ...rest } = event as AgentEvent & { seq?: number }
          return { ...rest, sessionId, projectPath: '/Users/me/project', environmentId: 'env-local' }
        })
        return packet.type === 'topic' ? packet.frame.events : []
      })
      const original = (baselineEvents as unknown as Record<string, AgentEvent[]>)[recording.recording]!
      const immutable = (baseline as Record<string, { live?: { payload: { events: number; sha256: string } } }>)[recording.recording]!.live!.payload
      expect({ events: original.length, sha256: createHash('sha256').update(JSON.stringify(original)).digest('hex') }).toEqual(immutable)
      expect(reduceWire(events as AgentEvent[]), `${recording.recording} reducer state`).toEqual(reduceWire(original))
      expect(interactions(events as AgentEvent[]), `${recording.recording} interactions`).toEqual(interactions(original))
      const openMark = wire.mark()
      const loaded = await wire.rpc<SessionLoadResult>('session.load', { sessionId, limit: 8 })
      const open = wire.measure(openMark)
      expect(loaded.summarized).toBe(true)
      expect(loaded.messages.map(message => message.id)).toEqual(reduced.messages.slice(-8).map(message => message.id))
      const refs = detailRefs(reduced.messages)
      const detailMark = wire.mark()
      for (const ref of refs) {
        const detail = await wire.rpc<{ text: string }>('session.subscribeDetail', { sessionId, detailRef: ref, subscriptionId: randomUUID() })
        expect(detail.text).toBeTypeOf('string')
      }
      const detail = wire.measure(detailMark)
      measured[recording.recording] = { live: { frames: live.frames, bytes: live.bytes, payload: { events: events.length,
        sha256: createHash('sha256').update(JSON.stringify(events)).digest('hex') } }, open: { frames: open.frames, bytes: open.bytes },
        detail: { frames: detail.frames, bytes: detail.bytes, refs: refs.length } }
      all.push(...reduced.messages)
      while (cleanup.length) cleanup.pop()!()
    }
    const wire = await nativePhoneWire(cleanup)
    Object.defineProperty(wire.own, 'snapshot', { get: () => ({ messages: all, harnessId: 'claude' }) })
    const mark = wire.mark(); await wire.rpc('session.load', { sessionId: 'own', limit: 8 })
    const open = wire.measure(mark)
    const pageMark = wire.mark()
    const page = await wire.rpc<SessionLoadResult>('session.load', { sessionId: 'own', before: all.length - 8, limit: 24, includeState: false })
    const history = wire.measure(pageMark)
    measured.combined = { open: { frames: open.frames, bytes: open.bytes }, history: { frames: history.frames, bytes: history.bytes, messages: page.messages.length } }
    // Optional measurement report; the immutable step-0 budgets and digests never update.
    if (process.env.SUPERONE_WIRE_REPORT === '1') writeFileSync(new URL('./fixtures/wire-current.json', import.meta.url), JSON.stringify(measured, null, 2) + '\n')
    for (const [name, budget] of Object.entries(baseline)) {
      for (const kind of ['live', 'open', 'history', 'detail'] as const) {
        const maximum = (budget as Record<string, { frames: number; bytes: number }>)[kind]
        if (!maximum) continue
        const actual = measured[name]![kind] as { frames: number; bytes: number }
        expect.soft(actual.frames, `${name} ${kind} frames`).toBeLessThanOrEqual(maximum.frames)
        expect.soft(actual.bytes, `${name} ${kind} bytes`).toBeLessThanOrEqual(maximum.bytes)
      }
      if ('detail' in budget) expect((measured[name]!.detail as { refs: number }).refs).toBe(budget.detail.refs)
    }
  })
})
