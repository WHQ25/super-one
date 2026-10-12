import { describe, expect, it, vi } from 'vitest'
import type { CachedWindow } from '@superone/relay-client'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { TranscriptWindowPatch, TranscriptWindowRequest } from '@superone/shared/environment/transcript-window'
import { fragmentDigest, fragmentMessage } from '@superone/shared/transcript-window/fragment-message'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { conversation, longReplyText, textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import { ChatRuntime } from './runtime'
import { runtimeTestClient, sessionLoadFixture } from './runtime-test-client'

/** A host serving windows over `transcript`, answering every other call like the shared fake. */
function windowHost(transcript: { current: ChatMessage[] }, options: { windows?: boolean } = {}) {
  const client = runtimeTestClient()
  const answer = client.dispatch.getMockImplementation()!
  const windows: TranscriptWindowRequest[] = []
  client.dispatch.mockImplementation(async (call) => {
    if (call.method === 'session.transcriptWindow') {
      if (options.windows === false) throw Object.assign(new Error('unsupported'), { code: 'unsupported' })
      windows.push(call as unknown as TranscriptWindowRequest)
      const selected = selectTranscriptWindow(windowSource(transcript.current), call as unknown as TranscriptWindowRequest, DEFAULT_WINDOW_BUDGET)
      return { sessionId: 's', schema: 1, ...selected, total: transcript.current.length,
        ...(call.includeState === false ? {} : { state: { status: 'idle', sessionProvider: 'claude' } }),
        cursor: { sequence: '1', epoch: 'epoch', version: 1 } }
    }
    if (call.method === 'session.load') {
      const message = transcript.current.find((row) => row.id === call.anchorId)
      return sessionLoadFixture({ messages: message ? [message] : transcript.current.slice(-8) })
    }
    return answer(call)
  })
  return { client, windows }
}

function cache() {
  const stored = new Map<string, CachedWindow>()
  return {
    stored,
    hooks: {
      pairingId: () => 'pair',
      transcriptWindow: { viewport: () => ({ width: 390, height: 844 }) },
      transcripts: {
        get: () => null, put: vi.fn(),
        getWindow: (_pairing: string, path: string, sid: string) => stored.get(`${path}:${sid}`) ?? null,
        putWindow: (_pairing: string, path: string, sid: string, window: CachedWindow) => { stored.set(`${path}:${sid}`, window) },
      },
    },
  }
}

const event = (value: Partial<AgentEvent> & { type: AgentEvent['type'] }) => ({ environmentId: 'desktop', sessionId: 's', ...value }) as AgentEvent

/** The patch a host sends when `id`'s text grew from `before` to `after`. */
function appendPatch(id: string, before: string, after: string, total: number): TranscriptWindowPatch {
  const grown = fragmentMessage(textMessage(id, 'assistant', after, 'streaming'))
  const previous = fragmentMessage(textMessage(id, 'assistant', before, 'streaming'))
  const fragment = grown.fragments[0]
  const body = fragment.body.kind === 'text' ? fragment.body.text : ''
  return { total, messages: [{ id, index: total - 1, metaDigest: grown.metaDigest, ...(grown.metaDigest === previous.metaDigest ? {} : { meta: grown.meta }),
    fragments: [{ key: fragment.key, digest: fragmentDigest(fragment.body), append: body.slice(before.length) }], omittedBefore: 0, omittedAfter: 0 }] }
}

describe('ChatRuntime transcript windows', () => {
  it('opens as a window and follows appended text without whole-message events', async () => {
    const transcript = { current: [textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Hello', 'streaming')] }
    const { client, windows } = windowHost(transcript)
    const { hooks, stored } = cache()
    const runtime = new ChatRuntime(client as never, () => {}, hooks)
    await runtime.open('/p', 's')
    expect(runtime.windowMode).toBe(true)
    expect(windows[0]).toMatchObject({ viewport: { width: 390, height: 844 } })
    expect(runtime.messages.map((m) => m.id)).toEqual(['u', 'a'])
    runtime.ingest([event({ type: 'transcript_window', patch: appendPatch('a', 'Hello', 'Hello world', 2) })])
    runtime.flush()
    expect(runtime.messages[1].content[0]).toMatchObject({ text: 'Hello world' })
    runtime.dispose()
    expect(stored.get('/p:s')?.window.messages.map((m) => m.id)).toEqual(['u', 'a'])
  })

  it('keeps its own optimistic bubble until the window carries it, without a duplicate', async () => {
    const transcript = { current: [textMessage('u', 'user', 'Hi')] }
    const { client } = windowHost(transcript)
    const runtime = new ChatRuntime(client as never, () => {}, cache().hooks)
    await runtime.open('/p', 's')
    runtime.send('Next question', { clientMessageId: 'mine' })
    runtime.ingest([event({ type: 'status_change', status: 'streaming' })])
    expect(runtime.messages.map((m) => m.id)).toEqual(['u', 'mine'])
    const echoed = fragmentMessage(textMessage('mine', 'user', 'Next question'))
    runtime.ingest([event({ type: 'transcript_window', patch: { total: 2, messages: [{ id: 'mine', index: 1, metaDigest: echoed.metaDigest, meta: echoed.meta,
      fragments: echoed.fragments.map(({ key, digest, body }) => ({ key, digest, body })), omittedBefore: 0, omittedAfter: 0 }] } })])
    expect(runtime.messages.map((m) => m.id)).toEqual(['u', 'mine'])
    runtime.dispose()
  })

  it('keeps unchanged window rows identical across a state-only batch, so nothing repaints', async () => {
    const { client } = windowHost({ current: [textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', 'Hello')] })
    const runtime = new ChatRuntime(client as never, () => {}, cache().hooks)
    await runtime.open('/p', 's')
    const [user, reply] = runtime.messages
    runtime.ingest([event({ type: 'status_change', status: 'streaming' })])
    runtime.ingest([event({ type: 'message_usage', messageId: 'a', inputTokens: 1, outputTokens: 2 })])
    expect(runtime.messages[0]).toBe(user)
    expect(runtime.messages[1]).toBe(reply)
    runtime.dispose()
  })

  it('drops transcript content the reducer derived from a host event', async () => {
    const { client } = windowHost({ current: [textMessage('u', 'user', 'Hi')] })
    const runtime = new ChatRuntime(client as never, () => {}, cache().hooks)
    await runtime.open('/p', 's')
    runtime.ingest([event({ type: 'message_start', message: textMessage('ghost', 'assistant', '', 'streaming') })])
    expect(runtime.messages.map((m) => m.id)).toEqual(['u'])
    expect(runtime.session.lastAssistantMessageId).toBe('ghost')
    runtime.dispose()
  })

  it('loads the earlier part of a partial reply and returns it in the window order', async () => {
    const transcript = { current: [textMessage('u', 'user', 'Explain'), textMessage('a', 'assistant', longReplyText(300 * 1024))] }
    const { client, windows } = windowHost(transcript)
    const runtime = new ChatRuntime(client as never, () => {}, cache().hooks)
    await runtime.open('/p', 's')
    const partial = runtime.messages[0]
    expect(partial.metadata?.window?.omittedBefore).toBeGreaterThan(0)
    expect(runtime.hasMoreHistory).toBe(true)
    const page = await runtime.loadWindowPage('older')
    expect(windows.at(-1)).toMatchObject({ direction: 'before', includeState: false, anchor: { messageId: 'a' } })
    expect(page.replace).toBe(false)
    expect(page.messageOrder).toEqual(['a'])
    const grown = page.messages[0]
    expect(grown.metadata?.window?.omittedBefore).toBeLessThan(partial.metadata!.window!.omittedBefore)
    expect((grown.content[0] as { text: string }).text.length).toBeGreaterThan((partial.content[0] as { text: string }).text.length)
    const full = await runtime.loadFullMessage('a')
    expect(full.metadata?.window).toBeUndefined()
    runtime.dispose()
  })

  it('reopens from its cached window claiming the fragments it holds', async () => {
    const transcript = { current: conversation(6) }
    const { client, windows } = windowHost(transcript)
    const { hooks } = cache()
    const first = new ChatRuntime(client as never, () => {}, hooks)
    await first.open('/p', 's')
    first.dispose()
    transcript.current = [...transcript.current, ...conversation(2, 'n')]
    const paint = vi.fn()
    const second = new ChatRuntime(client as never, paint, hooks)
    await second.open('/p', 's')
    expect(windows.at(-1)?.have?.length).toBe(6)
    expect(paint.mock.calls[0]?.[1]).toBe(true)
    expect(second.messages.map((m) => m.id)).toEqual([...conversation(6).map((m) => m.id), 'n0', 'n1'])
    second.dispose()
  })

  it('restores the legacy way on a host without windows and stops asking it', async () => {
    const { client } = windowHost({ current: [textMessage('u', 'user', 'Hi')] }, { windows: false })
    const runtime = new ChatRuntime(client as never, () => {}, cache().hooks)
    await runtime.open('/p', 's')
    expect(runtime.windowMode).toBe(false)
    await runtime.open('/p', 's')
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'session.transcriptWindow')).toHaveLength(1)
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'session.load')).toHaveLength(2)
    runtime.dispose()
  })

  it('reads the window again when a patch cannot be applied', async () => {
    const { client, windows } = windowHost({ current: [textMessage('a', 'assistant', 'Hello', 'streaming')] })
    const runtime = new ChatRuntime(client as never, () => {}, cache().hooks)
    await runtime.open('/p', 's')
    const stale = appendPatch('a', 'Hello', 'Hello!', 1)
    stale.messages[0].fragments[0].digest = 'not-the-digest'
    runtime.ingest([event({ type: 'transcript_window', patch: stale })])
    await vi.waitFor(() => expect(windows).toHaveLength(2))
    runtime.dispose()
  })
})
