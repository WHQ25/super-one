import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, SessionLoadRequest, SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import type { TranscriptWindowPatch, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { utf8Length } from '@superone/shared/transcript-window/content-digest'
import { applyWindowPatch, applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage, windowCoverage, windowLookup } from '@superone/shared/transcript-window/window-store'
import { longReplyText, textMessage } from '@superone/shared/transcript-window/window-fixtures'
import { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { LIVE_MESSAGE_BUDGET, LIVE_PATCH_BYTES, WindowViews } from '../stream/delivery/window-views'
import { deliveryPolicy } from '../stream/delivery-policy'
import type { RpcContext, SessionHostPort } from './rpc-context'
import { handleSessionTranscriptWindow } from './rpc-session-window'
import { deliverFrame } from './session-delivery'

function host(initial: ChatMessage[]) {
  let transcript = initial
  let version = 1
  const sessions = {
    get: (id: string) => (id === 's' ? { projectId: 'p' } : null),
    messages: () => transcript,
    load: (input: SessionLoadRequest): SessionLoadResult => ({
      sessionId: input.sessionId,
      state: input.includeState === false ? {} : { status: 'streaming' },
      messages: input.full ? [...transcript] : transcript.slice(-8),
      before: null,
      cursor: { sequence: String(version), epoch: 'e', version },
    }),
  } as unknown as SessionHostPort
  return {
    sessions,
    set(next: ChatMessage[]) { transcript = next; version++ },
    get version() { return version },
  }
}

function context(sessions: SessionHostPort, delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))): RpcContext & { delivery: ConnectionDelivery } {
  return {
    client: { clientSessionId: 'c', scopes: ['session:read'], devicePublicKeyFingerprint: 'fp', devicePublicKeyPem: 'pem' },
    sessions,
    streams: { delivery } as unknown as RpcContext['streams'],
    delivery,
  } as unknown as RpcContext & { delivery: ConnectionDelivery }
}

async function window(ctx: RpcContext, payload: Record<string, unknown> = {}): Promise<TranscriptWindowResult> {
  const reply = await handleSessionTranscriptWindow({ sessionId: 's', ...payload }, ctx)
  if (reply.error) throw Object.assign(new Error(reply.error.message), reply.error)
  return reply.result as TranscriptWindowResult
}

const envelope = (event: AgentEvent, version: number, ephemeral = true): EnvironmentEventEnvelope => ({
  eventId: `e${version}`, environmentId: 'env', sequence: '1', aggregateType: 'session', aggregateId: 's', eventType: 'session.agent_event',
  eventVersion: 1, payload: { event }, timestamp: 0, sessionVersion: version, ...(ephemeral ? { ephemeral: true } : {}),
} as EnvironmentEventEnvelope)
const frame = (...events: EnvironmentEventEnvelope[]): SessionStreamFrame => ({ sequence: '1', epoch: 'e', events })
const delta = (text: string): AgentEvent => ({ type: 'content_delta', sessionId: 's', messageId: 'a', delta: { type: 'text', text } })

function patchesOf(delivered: SessionStreamFrame): TranscriptWindowPatch[] {
  return delivered.events.flatMap((e) => {
    const event = (e.payload as { event?: AgentEvent }).event
    return event?.type === 'transcript_window' ? [event.patch] : []
  })
}

describe('session.transcriptWindow', () => {
  it('serves a bounded tail with state and cursor, summarized for a phone', async () => {
    const h = host([textMessage('u', 'user', 'Explain'), textMessage('a', 'assistant', longReplyText(1024 * 1024))])
    const result = await window(context(h.sessions), { viewport: { width: 390, height: 844 } })
    expect(utf8Length(JSON.stringify(result.messages))).toBeLessThan(128 * 1024)
    expect(result).toMatchObject({ schema: 1, total: 2, newer: null, cursor: { version: 1 }, summarized: true, state: { status: 'streaming' } })
    expect(result.older?.messageId).toBe('a')
  })

  it('omits bodies the client holds and serves paged windows without state', async () => {
    const h = host([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Hello')])
    const first = await window(context(h.sessions))
    const held = applyWindowResult(null, first, EMPTY_WINDOW_LOOKUP).state
    const again = await window(context(h.sessions), { have: windowCoverage(held.messages) })
    expect(again.messages.every((m) => !m.meta && m.fragments.every((f) => !f.body))).toBe(true)
    const paged = await window(context(h.sessions), { anchor: { messageId: 'a' }, direction: 'before' })
    expect(paged.state).toBeUndefined()
    expect(paged.messages.map((m) => m.id)).toEqual(['u'])
  })

  it('validates its arguments', async () => {
    const ctx = context(host([]).sessions)
    await expect(window(ctx, { direction: 'before' })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(window(ctx, { anchor: { messageId: '' } })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(window(ctx, { projectId: 'other' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(window(context(host([textMessage('a', 'assistant', 'x')]).sessions), { anchor: { messageId: 'gone' }, direction: 'before' }))
      .rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('transcript window live delivery', () => {
  it('replaces text deltas with an appended-text patch the client verifies', async () => {
    const h = host([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Hello', 'streaming')])
    const ctx = context(h.sessions)
    let held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    h.set([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Hello world', 'streaming')])
    const delivered = deliverFrame(frame(envelope(delta(' world'), 2)), ctx.delivery, h.sessions).frame
    expect(delivered.events.map((e) => (e.payload as { event: AgentEvent }).event.type)).toEqual(['transcript_window'])
    expect(delivered.events[0].sessionVersion).toBe(2)
    const [patch] = patchesOf(delivered)
    expect(patch.messages[0].fragments[0]).toMatchObject({ append: ' world' })
    const applied = applyWindowPatch(held, patch)
    expect(applied.stale).toBe(false)
    held = applied.state
    expect(materializeWindowMessage(held.messages[1]).content[0]).toMatchObject({ text: 'Hello world' })
  })

  it('forwards state events with bodies removed and adds new messages under the live budget', async () => {
    const h = host([textMessage('u', 'user', 'Hi')])
    const ctx = context(h.sessions)
    const held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    const big = textMessage('a', 'assistant', longReplyText(512 * 1024), 'complete')
    h.set([textMessage('u', 'user', 'Hi'), big])
    const start: AgentEvent = { type: 'message_start', sessionId: 's', message: big }
    const delivered = deliverFrame(frame(envelope(start, 2, false), envelope({ type: 'message_complete', sessionId: 's', messageId: 'a', metadata: { resultText: 'x'.repeat(1000) } }, 3, false)), ctx.delivery, h.sessions).frame
    const events = delivered.events.map((e) => (e.payload as { event: AgentEvent }).event)
    expect(events.map((e) => e.type)).toEqual(['message_start', 'message_complete', 'transcript_window'])
    expect(events[0]).toMatchObject({ message: { id: 'a', content: [] } })
    expect(events[1]).not.toHaveProperty('metadata.resultText')
    const [patch] = patchesOf(delivered)
    expect(utf8Length(JSON.stringify(patch))).toBeLessThan(80 * 1024)
    expect(patch.messages[0]).toMatchObject({ id: 'a', omittedAfter: 0 })
    expect(patch.messages[0].omittedBefore).toBeGreaterThan(0)
    const applied = applyWindowPatch(held, patch)
    expect(applied.stale).toBe(false)
    expect(applied.state.messages.map((m) => m.id)).toEqual(['u', 'a'])
  })

  it('patches a rewrite of held content and a removal', async () => {
    const h = host([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Draft answer', 'streaming'), textMessage('x', 'assistant', 'temp')])
    const ctx = context(h.sessions)
    let held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    h.set([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Final answer', 'complete')])
    const [patch] = patchesOf(deliverFrame(frame(envelope({ type: 'content_retracted', sessionId: 's', messageId: 'a', blocks: [] }, 2, false)), ctx.delivery, h.sessions).frame)
    expect(patch.removed).toEqual(['x'])
    const applied = applyWindowPatch(held, patch, windowLookup(held))
    expect(applied.stale).toBe(false)
    held = applied.state
    expect(held.messages.map((m) => materializeWindowMessage(m).content[0])).toEqual([
      expect.objectContaining({ text: 'Hi' }), expect.objectContaining({ text: 'Final answer' }),
    ])
  })

  it('delivers native history replacement through a bounded window and keeps the last reply pointer', async () => {
    const h = host([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Draft'), textMessage('removed', 'assistant', 'Later turn')])
    const ctx = context(h.sessions)
    const held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    const restored = [textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', longReplyText(512 * 1024))]
    h.set(restored)
    const replacement: AgentEvent = { type: 'transcript_replaced', sessionId: 's', messages: restored }
    const delivered = deliverFrame(frame(envelope(replacement, 2, false)), ctx.delivery, h.sessions).frame
    expect(utf8Length(JSON.stringify(delivered))).toBeLessThan(100 * 1024)
    const events = delivered.events.map(e => (e.payload as { event: AgentEvent }).event)
    expect(events[0]).toMatchObject({ type: 'transcript_replaced', messages: [{ id: 'a', content: [] }] })
    const [patch] = patchesOf(delivered)
    expect(patch.removed).toContain('removed')
    const applied = applyWindowPatch(held, patch, windowLookup(held))
    expect(applied.stale).toBe(false)
    expect(applied.state.messages.map(m => m.id)).toEqual(['u', 'a'])
    expect(materializeWindowMessage(applied.state.messages[1]).content.length).toBeGreaterThan(0)
    expect(replacement.messages).toBe(restored)
    expect(replacement.messages[1].content[0]).toMatchObject({ text: longReplyText(512 * 1024) })
    h.set([])
    const cleared = deliverFrame(frame(envelope({ type: 'transcript_replaced', sessionId: 's', messages: [] }, 3, false)), ctx.delivery, h.sessions).frame
    expect((cleared.events[0].payload as { event: AgentEvent }).event).toMatchObject({ type: 'transcript_replaced', messages: [] })
    expect(applyWindowPatch(applied.state, patchesOf(cleared)[0], windowLookup(applied.state)).state.messages).toEqual([])
  })

  it('keeps every event for a relaying desktop and tags patches with the holder', async () => {
    const h = host([textMessage('a', 'assistant', 'Hello', 'streaming')])
    const ctx = context(h.sessions, new ConnectionDelivery(deliveryPolicy('relay', 'desktop')))
    await window(ctx, { holder: 'phone-1' })
    h.set([textMessage('a', 'assistant', 'Hello!', 'streaming')])
    const delivered = deliverFrame(frame(envelope(delta('!'), 2)), ctx.delivery, h.sessions).frame
    const events = delivered.events.map((e) => (e.payload as { event: AgentEvent }).event)
    expect(events.map((e) => e.type)).toEqual(['content_delta', 'transcript_window'])
    expect(events[1]).toMatchObject({ holder: 'phone-1' })
  })

  it('adds every message that arrived at a window that held none', async () => {
    const h = host([])
    const ctx = context(h.sessions)
    const held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    h.set([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Hello', 'streaming')])
    const [patch] = patchesOf(deliverFrame(frame(envelope(delta('Hello'), 2)), ctx.delivery, h.sessions).frame)
    const applied = applyWindowPatch(held, patch)
    expect(applied.stale).toBe(false)
    expect(applied.state.messages.map((m) => m.id)).toEqual(['u', 'a'])
  })

  it('bounds the whole serialized patch, starting the window after the newest messages that fit', async () => {
    const h = host([textMessage('u', 'user', 'Hi')])
    const ctx = context(h.sessions)
    const held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    const replies = Array.from({ length: 100 }, (_, i) => textMessage(`a${i}`, 'assistant', 'x'.repeat(20_000)))
    h.set([textMessage('u', 'user', 'Hi'), ...replies])
    const [patch] = patchesOf(deliverFrame(frame(envelope(delta('x'), 2)), ctx.delivery, h.sessions).frame)
    expect(utf8Length(JSON.stringify(patch))).toBeLessThanOrEqual(LIVE_PATCH_BYTES)
    const applied = applyWindowPatch(held, patch)
    expect(applied.stale).toBe(false)
    const ids = applied.state.messages.map((m) => m.id)
    expect(ids.at(-1)).toBe('a99')
    expect(ids).toEqual(replies.slice(-ids.length).map((m) => m.id))
    expect(applied.state.older?.messageId).toBe(ids[0])
    // Paging back from the new edge reaches what the patch left out.
    const older = await window(ctx, { anchor: applied.state.older!, direction: 'before' })
    const edge = applied.state.messages[0].omittedBefore > 0 ? ids[0] : replies[100 - ids.length - 1].id
    expect(older.messages.at(-1)?.id).toBe(edge)
  })

  it('re-enters a rewritten reply as its newest fragments instead of resending the held range', async () => {
    const h = host([textMessage('a', 'assistant', longReplyText(512 * 1024), 'streaming')])
    const ctx = context(h.sessions)
    let held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    held = applyWindowResult(held, await window(ctx, { anchor: held.older!, direction: 'before' }), EMPTY_WINDOW_LOOKUP, 'older').state
    h.set([textMessage('a', 'assistant', `Rewritten. ${longReplyText(512 * 1024)}`, 'complete')])
    const [patch] = patchesOf(deliverFrame(frame(envelope({ type: 'content_retracted', sessionId: 's', messageId: 'a', blocks: [] }, 2, false)), ctx.delivery, h.sessions).frame)
    expect(utf8Length(JSON.stringify(patch))).toBeLessThan(LIVE_MESSAGE_BUDGET.maxBytes + 16 * 1024)
    const applied = applyWindowPatch(held, patch, windowLookup(held))
    expect(applied.stale).toBe(false)
    expect(applied.state.messages[0].omittedBefore).toBeGreaterThan(0)
  })

  it('sends what changed since the client caught up after it pages a streaming reply', async () => {
    const reply = longReplyText(300 * 1024)
    const h = host([textMessage('a', 'assistant', reply, 'streaming')])
    const ctx = context(h.sessions)
    let held = applyWindowResult(null, await window(ctx), EMPTY_WINDOW_LOOKUP).state
    h.set([textMessage('a', 'assistant', `${reply} and more`, 'streaming')])
    held = applyWindowResult(held, await window(ctx, { anchor: held.older!, direction: 'before' }), EMPTY_WINDOW_LOOKUP, 'older').state
    const [patch] = patchesOf(deliverFrame(frame(envelope(delta(' and more'), 2)), ctx.delivery, h.sessions).frame)
    const applied = applyWindowPatch(held, patch, windowLookup(held))
    expect(applied.stale).toBe(false)
    const text = materializeWindowMessage(applied.state.messages[0]).content.map((b) => ('text' in b ? b.text : '')).join('')
    expect(text.endsWith(' and more')).toBe(true)
  })

  it('keeps a bounded number of held windows, dropping the least recently used', () => {
    const views = new WindowViews()
    const messages = [textMessage('a', 'assistant', 'Hello', 'streaming')]
    const budget = { maxBytes: 64 * 1024, maxFragments: 8, targetChars: 1000 }
    for (let i = 0; i <= 64; i++) views.serve({ sessionId: 's', holder: `h${i}`, messages, request: {}, budget })
    const holders = views.patches('s', [textMessage('a', 'assistant', 'Hello!', 'streaming')]).map((p) => p.holder)
    expect(holders).toHaveLength(64)
    expect(holders).not.toContain('h0')
    views.serve({ sessionId: 'other', holder: 'h1', messages, request: {}, budget })
    expect(views.patches('s', [textMessage('a', 'assistant', 'Hello!!', 'streaming')]).map((p) => p.holder)).not.toContain('h1')
  })

  it('leaves a connection without a window untouched', () => {
    const h = host([textMessage('a', 'assistant', 'Hello', 'streaming')])
    const delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    const delivered = deliverFrame(frame(envelope(delta('!'), 2)), delivery, h.sessions).frame
    expect(delivered.events.map((e) => (e.payload as { event: AgentEvent }).event.type)).toEqual(['content_delta'])
  })
})
