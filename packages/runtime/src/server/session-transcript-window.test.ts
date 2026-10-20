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
import { deliverFrame, deliverLoad, subscribeDetail } from './session-delivery'

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
  it('keeps absolute indexes when the host serves a bounded transcript', async () => {
    const messages = Array.from({ length: 250 }, (_, index) => textMessage(`m${index}`, 'user', `row ${index}`))
    let loaded = false
    const sessions = {
      get: (id: string) => (id === 's' ? { projectId: 'p' } : null),
      messages: () => messages.slice(-8),
      load: () => { loaded = true; throw new Error('full load') },
      readTranscriptWindow: async (input: { read: (view: { transcript: { count: number; messageAt: (index: number) => ChatMessage; indexOf: (id: string) => number }; state: Record<string, unknown>; cursor: { sequence: string; epoch: string; version: number } }) => unknown }) => input.read({
        transcript: { count: messages.length, messageAt: (index) => messages[index]!, indexOf: (id) => messages.findIndex((message) => message.id === id) },
        state: { status: 'streaming' },
        cursor: { sequence: '3', epoch: 'e', version: 9 },
      }),
    } as unknown as SessionHostPort
    const result = await window(context(sessions))
    expect(loaded).toBe(false)
    expect(result.total).toBe(250)
    expect(result.messages[0]?.index).toBeGreaterThan(200)
    expect(result.cursor).toEqual({ sequence: '3', epoch: 'e', version: 9 })
    expect(result.state).toMatchObject({ status: 'streaming' })
  })

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

  it('withholds content when every reader of the session takes patches', async () => {
    const h = host([textMessage('a', 'assistant', 'Hello', 'streaming')])
    const ctx = context(h.sessions, new ConnectionDelivery(deliveryPolicy('relay', 'desktop')))
    await window(ctx, { holder: 'phone-1' })
    h.set([textMessage('a', 'assistant', 'Hello!', 'streaming')])
    const delivered = deliverFrame(frame(envelope(delta('!'), 2)), ctx.delivery, h.sessions).frame
    const events = delivered.events.map((e) => (e.payload as { event: AgentEvent }).event)
    expect(events.map((e) => e.type)).toEqual(['transcript_window'])
    expect(events[0]).toMatchObject({ holder: 'phone-1' })
  })

  it('withholds content when the desktop is showing the session, and still patches a routed phone', async () => {
    const h = host([textMessage('a', 'assistant', 'Hello', 'streaming')])
    const ctx = context(h.sessions, new ConnectionDelivery(deliveryPolicy('relay', 'desktop')))
    await window(ctx, { holder: 'phone-1' })
    await window(ctx, { holder: 'desktop:s' })
    h.set([textMessage('a', 'assistant', 'Hello!', 'streaming')])
    const delivered = deliverFrame(frame(envelope(delta('!'), 2)), ctx.delivery, h.sessions).frame
    const events = delivered.events.map((e) => (e.payload as { event: AgentEvent }).event)
    expect(events.map((e) => e.type)).toEqual(['transcript_window', 'transcript_window'])
    expect(events.filter((event) => event.type === 'transcript_window').map((event) => event.holder)).toEqual(['phone-1', 'desktop:s'])
    expect(JSON.stringify(delivered)).not.toContain('Hello!')
  })

  it('sends a desktop on a direct link the tool shell, and the body only as detail', async () => {
    const command = `echo ${'x'.repeat(50_000)}`
    const h = host([textMessage('a', 'assistant', 'Hello', 'streaming')])
    const ctx = context(h.sessions, new ConnectionDelivery(deliveryPolicy('lan', 'desktop')))
    const opened = await window(ctx, { holder: 'desktop:s' })
    expect(opened.summarized).toBe(true)
    const tool: AgentEvent = {
      type: 'content_delta', sessionId: 's', messageId: 'a',
      delta: { type: 'tool_use', toolName: 'Bash', toolUseId: 't', input: JSON.stringify({ command }), status: 'streaming' },
    }
    h.set([{
      ...textMessage('a', 'assistant', 'Hello!', 'streaming'),
      content: [
        { type: 'text', text: 'Hello!' },
        { type: 'tool_use', toolName: 'Bash', toolUseId: 't', input: JSON.stringify({ command }), status: 'streaming' },
      ],
    }])
    const delivered = deliverFrame(frame(envelope(delta('!'), 2), envelope(tool, 3)), ctx.delivery, h.sessions).frame
    const events = delivered.events.map((e) => (e.payload as { event: AgentEvent }).event)
    expect(events.map((event) => event.type)).toEqual(['content_delta', 'transcript_window'])
    expect(events[0]).toMatchObject({ delta: { type: 'tool_use', toolUseId: 't', remoteDetail: '["a","tool","t"]' } })
    expect(events[1]).toMatchObject({ holder: 'desktop:s' })
    expect(JSON.stringify(delivered)).not.toContain(command)
  })

  it('carries a todo list on the window and on the live result, and leaves a later load whole', async () => {
    const todos = [{ content: 'Ship the window', status: 'in_progress', activeForm: 'Shipping', description: 'detail' }]
    const input = JSON.stringify({ todos })
    const command = `echo ${'secret-body-'.repeat(200)}`
    const reply: ChatMessage = {
      id: 'a', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude',
      content: [
        { type: 'thinking', thinking: 'private plan' },
        { type: 'tool_use', toolName: 'TodoWrite', toolUseId: 'tw', input, status: 'complete' },
        { type: 'tool_result', toolUseId: 'tw', summary: 'ok' },
        { type: 'tool_use', toolName: 'Bash', toolUseId: 'sh', input: JSON.stringify({ command }), status: 'complete' },
        { type: 'tool_result', toolUseId: 'sh', summary: 'ran' },
      ],
    }
    const h = host([reply])
    const ctx = context(h.sessions, new ConnectionDelivery(deliveryPolicy('lan', 'desktop')))
    const opened = await window(ctx, { holder: 'desktop:s' })
    expect(opened.summarized).toBe(true)
    const painted = applyWindowResult(null, opened, EMPTY_WINDOW_LOOKUP).state.messages.map((message) => materializeWindowMessage(message))
    const todoResult = painted[0]?.content.find((block) => block.type === 'todo_result')
    expect(todoResult).toMatchObject({
      todoToolName: 'TodoWrite',
      toolTodos: [{ content: 'Ship the window', status: 'in_progress', activeForm: 'Shipping', description: 'detail' }],
    })
    expect(JSON.stringify(painted)).not.toContain(command)

    const loaded = deliverLoad(await h.sessions.load({ sessionId: 's' }), ctx.delivery)
    expect(loaded.summarized).toBeUndefined()
    expect(loaded.messages).toEqual([reply])
    const detail = subscribeDetail(ctx.delivery, h.sessions, { sessionId: 's', detailRef: '["a","tool","sh"]', subscriptionId: 'sub' })
    expect(detail.text).toContain(command)

    const result: AgentEvent = { type: 'content_delta', sessionId: 's', messageId: 'a', delta: { type: 'tool_result', toolUseId: 'tw', summary: 'ok' } }
    const delivered = deliverFrame(frame(envelope(result, 2)), ctx.delivery, h.sessions).frame
    const events = delivered.events.map((e) => (e.payload as { event: AgentEvent }).event)
    expect(events[0]).toMatchObject({
      delta: { type: 'todo_result', todoToolName: 'TodoWrite', toolTodos: [expect.objectContaining({ content: 'Ship the window' })] },
    })
  })

  it('keeps two desktop sessions patching while one streams', async () => {
    const messages = [textMessage('a', 'assistant', 'Hello', 'streaming')]
    const views = new WindowViews()
    const budget = { maxBytes: 64 * 1024, maxFragments: 8, targetChars: 1000 }
    views.serve({ sessionId: 'a', holder: 'desktop:a', messages, request: {}, budget })
    views.serve({ sessionId: 'b', holder: 'desktop:b', messages, request: {}, budget })
    const next = [textMessage('a', 'assistant', 'Hello!', 'streaming')]
    expect(views.patches('a', next).map((patch) => patch.holder)).toEqual(['desktop:a'])
    expect(views.patches('b', next).map((patch) => patch.holder)).toEqual(['desktop:b'])
    expect(views.holderIds('a')).toEqual(['desktop:a'])
    expect(views.holderIds('b')).toEqual(['desktop:b'])
  })

  it('names a session whose holder the window cap evicted, so the client reads it again', () => {
    const messages = [textMessage('a', 'assistant', 'Hello', 'streaming')]
    const budget = { maxBytes: 64 * 1024, maxFragments: 8, targetChars: 1000 }
    const h = host(messages)
    const delivery = new ConnectionDelivery(deliveryPolicy('relay', 'desktop'))
    for (let i = 0; i <= 64; i++) delivery.windows.serve({ sessionId: `s${i}`, holder: `desktop:s${i}`, messages, request: {}, budget })
    const delivered = deliverFrame(frame(envelope(delta('!'), 2)), delivery, h.sessions).frame
    expect(delivered.resnapshot).toEqual(['s0'])
    expect(delivery.windows.holderIds('s0')).toEqual([])
    expect(delivery.windows.drainEvicted()).toEqual([])
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

  it('patches a sparse absolute window the same way as the full transcript', () => {
    const all = Array.from({ length: 30 }, (_, index) => textMessage(`m${index}`, 'assistant', `body ${index} ${'y'.repeat(80)}`))
    const budget = { maxBytes: 128 * 1024, maxFragments: 8, targetChars: 1000 }
    const fullViews = new WindowViews()
    const sparseViews = new WindowViews()
    const full = fullViews.serve({ sessionId: 's', holder: 'h', messages: all, request: {}, budget })
    const seen = new Set<number>()
    const sparse = sparseViews.serve({
      sessionId: 's', holder: 'h', request: {}, budget,
      transcript: { count: all.length, messageAt: (index) => { seen.add(index); return all[index]! }, indexOf: (id) => all.findIndex((message) => message.id === id) },
    })
    expect(sparse.total).toBe(full.total)
    expect(sparse.messages).toEqual(full.messages)
    expect(Math.min(...seen)).toBeGreaterThan(0)
    expect(seen.size).toBeLessThanOrEqual(sparse.messages.length + 1)
    const next = [...all, textMessage('newer', 'assistant', 'tail')]
    expect(sparseViews.patches('s', next)).toEqual(fullViews.patches('s', next))
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
