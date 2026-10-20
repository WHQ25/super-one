import { describe, expect, it } from 'vitest'
import type { SessionLoadResult } from '@superone/shared/environment'
import type { ContentBlock } from '@superone/shared/agent-types'
import type { TranscriptWindowRequest, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import type { FoldRange } from '@superone/shared/transcript-window/folds'
import { foldMessageFragments, selectFoldPage } from '@superone/shared/transcript-window/folds'
import { fragmentMessage } from '@superone/shared/transcript-window/fragment-message'
import { selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP } from '@superone/shared/transcript-window/window-store'
import { TranscriptWindowSync } from '@superone/shared/transcript-window/window-sync'
import { conversation, processTurn, textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import {
  DESKTOP_FOLD_BUDGET,
  DESKTOP_WINDOW_BUDGET,
  loadRemoteTranscriptWindow,
  presentDesktopWindowPatch,
  readDesktopSessionWindow,
} from './remote-transcript-window'

const cursor = { sequence: '1', epoch: 'e', version: 1 }

function windowResult(
  messages: ReturnType<typeof conversation>,
  request: TranscriptWindowRequest,
): TranscriptWindowResult {
  const source = windowSource(messages)
  const selected = selectTranscriptWindow(source, request, request.budget ?? DESKTOP_WINDOW_BUDGET)
  return {
    sessionId: request.sessionId,
    schema: 1,
    messages: selected.messages,
    older: selected.older,
    newer: selected.newer,
    total: messages.length,
    state: { status: 'idle' },
    cursor,
  }
}

describe('loadRemoteTranscriptWindow', () => {
  it('sends coverage on the way back to a held session', async () => {
    const messages = conversation(4)
    const requests: TranscriptWindowRequest[] = []
    const call = async (request: TranscriptWindowRequest & { holder: string }) => {
      requests.push(request)
      return windowResult(messages, request)
    }
    const first = await loadRemoteTranscriptWindow(call, null, { sessionId: 's' })
    const second = await loadRemoteTranscriptWindow(call, first.held, { sessionId: 's' })
    expect(requests[0].holder).toBe('desktop:s')
    expect(requests[0].folds).toBe(true)
    expect(requests[0].have).toBeUndefined()
    expect(requests[1].have?.length).toBeGreaterThan(0)
    expect(requests[1].budget).toEqual(DESKTOP_WINDOW_BUDGET)
    expect(second.snapshot.messages.map((message) => message.id)).toEqual(first.snapshot.messages.map((message) => message.id))
    expect(second.snapshot.messages[0]?.content[0]).toMatchObject({ type: 'text' })
  })

  it('keeps an already paged prefix when the tail is read again', async () => {
    const messages = conversation(3)
    const full = windowResult(messages, { sessionId: 's' })
    const first = await loadRemoteTranscriptWindow(async () => full, null, { sessionId: 's' })
    const tail: TranscriptWindowResult = {
      ...full,
      messages: full.messages.slice(-1),
      older: { messageId: messages[2].id },
      newer: null,
    }
    const again = await loadRemoteTranscriptWindow(async () => tail, first.held, { sessionId: 's' })
    expect(again.snapshot.messages.map((message) => message.id)).toEqual(['m0', 'm1', 'm2'])
    expect(again.snapshot.transcriptWindow?.older).toBeNull()
  })

  it('joins an adjacent tail and replaces the held range across a gap', async () => {
    const messages = conversation(6)
    const full = windowResult(messages, { sessionId: 's' })
    const held = await loadRemoteTranscriptWindow(async () => ({ ...full, messages: full.messages.slice(0, 2), older: null, newer: null }), null, { sessionId: 's' })
    const adjacent = await loadRemoteTranscriptWindow(async () => ({ ...full, messages: full.messages.slice(2, 3), older: { messageId: 'm2' }, newer: null }), held.held, { sessionId: 's' })
    expect(adjacent.snapshot.messages.map((message) => message.id)).toEqual(['m0', 'm1', 'm2'])
    expect(adjacent.snapshot.transcriptWindow?.older).toBeNull()
    const gapped = await loadRemoteTranscriptWindow(async () => ({ ...full, messages: full.messages.slice(-1), older: { messageId: 'm5' }, newer: null }), held.held, { sessionId: 's' })
    expect(gapped.snapshot.messages.map((message) => message.id)).toEqual(['m5'])
    expect(gapped.snapshot.transcriptWindow?.older).toEqual({ messageId: 'm5' })
  })

  it('replaces a detached window with the live tail', async () => {
    const messages = conversation(3)
    const full = windowResult(messages, { sessionId: 's' })
    const detached: TranscriptWindowResult = {
      ...full,
      messages: full.messages.slice(0, 2),
      newer: { messageId: messages[1].id },
      older: null,
    }
    const held = await loadRemoteTranscriptWindow(async () => detached, null, { sessionId: 's' })
    const tail: TranscriptWindowResult = {
      ...full,
      messages: full.messages.slice(-1),
      older: { messageId: messages[2].id },
      newer: null,
    }
    const replaced = await loadRemoteTranscriptWindow(async () => tail, held.held, { sessionId: 's' })
    expect(replaced.snapshot.messages.map((message) => message.id)).toEqual(['m2'])
  })

  it('pages a long session back to its first message', async () => {
    const messages = conversation(300)
    let held = null as Awaited<ReturnType<typeof loadRemoteTranscriptWindow>>['held'] | null
    const read = () => loadRemoteTranscriptWindow(
      async (request) => windowResult(messages, request),
      held,
      held?.current.older
        ? { sessionId: 's', anchor: held.current.older, direction: 'before' as const }
        : { sessionId: 's' },
    )
    let loaded = await read()
    held = loaded.held
    expect(loaded.snapshot.messages[0]?.id).not.toBe('m0')
    expect(loaded.snapshot.transcriptWindow?.older).not.toBeNull()
    for (let i = 0; i < 20 && loaded.snapshot.transcriptWindow?.older; i++) {
      loaded = await read()
      held = loaded.held
    }
    expect(loaded.snapshot.messages[0]?.id).toBe('m0')
    expect(loaded.snapshot.transcriptWindow?.total).toBe(300)
  })

  it('keeps a loaded fold page when a later read replaces the window', async () => {
    const reply = processTurn('a', 12)
    const range: FoldRange = { start: 0, end: reply.content.length - 2, summary: { segments: 5, toolCalls: 12, files: [], added: 0, removed: 0, contentKey: 'thinking::0' } }
    const folded = foldMessageFragments(fragmentMessage(reply), [range])
    const selected = selectTranscriptWindow({ count: 1, at: () => folded, indexOf: () => 0 }, {}, DESKTOP_WINDOW_BUDGET)
    const result: TranscriptWindowResult = { sessionId: 's', schema: 1, ...selected, total: 1, state: {}, cursor }
    const first = await loadRemoteTranscriptWindow(async () => result, null, { sessionId: 's' })
    const notice = first.snapshot.messages[0]?.content.find((block) => block.type === 'notice' && block.fold)
    const key = notice?.type === 'notice' ? notice.fold?.key : undefined
    expect(key).toBeTruthy()
    const inner = folded.folds.get(key!)!
    const fold = folded.fragments.find((fragment) => fragment.key === key)!
    const revision = fold.body.kind === 'fold' ? fold.body.revision : ''
    const { start, end } = selectFoldPage(inner, undefined, { ...DESKTOP_FOLD_BUDGET, maxFragments: 5 })!
    expect(first.held.applyFoldPage({
      sessionId: 's', messageId: 'a', fold: key!, revision,
      fragments: inner.entries.slice(start, end).map(({ key: fragmentKey, digest, body }) => ({ key: fragmentKey, digest, body })),
      rest: { ...range.summary, toolCalls: 1, fragments: inner.entries.length - end },
    }, undefined)).toBe(true)
    const after = first.held.foldRequest('a', key!)?.after
    expect(after).toBeTruthy()

    let claimed = false
    const again = await loadRemoteTranscriptWindow(async (request) => {
      if (request.have && !claimed) {
        claimed = true
        return { ...result, messages: result.messages.map((message) => ({ ...message, meta: undefined, metaDigest: 'missing', fragments: [] })) }
      }
      return result
    }, first.held, { sessionId: 's' })
    expect(claimed).toBe(true)
    expect(again.held).toBe(first.held)
    expect(again.held.foldRequest('a', key!)).toEqual({ revision, after })
  })
})

describe('readDesktopSessionWindow', () => {
  it('falls back to session.load when the host does not serve the window', async () => {
    const legacy: SessionLoadResult = {
      sessionId: 's',
      state: {},
      messages: [textMessage('a', 'user', 'hi')],
      before: null,
      cursor,
    }
    const loaded = await readDesktopSessionWindow({
      held: null,
      input: { sessionId: 's' },
      window: async () => {
        throw Object.assign(new Error('unknown method: session.transcriptWindow'), { code: 'not_found' })
      },
      load: async () => legacy,
    })
    expect(loaded.via).toBe('load')
    expect(loaded.held).toBeNull()
    expect(loaded.snapshot).toBe(legacy)
  })

  it('leaves other window failures to the caller', async () => {
    await expect(readDesktopSessionWindow({
      held: null,
      input: { sessionId: 's' },
      window: async () => { throw new Error('offline') },
      load: async () => { throw new Error('load should not run') },
    })).rejects.toThrow('offline')
  })
})

describe('presentDesktopWindowPatch', () => {
  it('gives the chat the painted rows and keeps fragment bodies in main', () => {
    const secret = 'tool body that stays on the host'
    const result = windowResult([textMessage('a', 'assistant', secret)], { sessionId: 's' })
    const sync = new TranscriptWindowSync(applyWindowResult(null, result, EMPTY_WINDOW_LOOKUP).state)
    const held = sync.current.messages[0]!
    const presented = presentDesktopWindowPatch(sync, {
      type: 'transcript_window', holder: 'desktop:s',
      patch: {
        total: result.total,
        messages: [{
          id: held.id, index: held.index, metaDigest: held.metaDigest,
          omittedBefore: held.omittedBefore, omittedAfter: held.omittedAfter,
          fragments: held.fragments.map((fragment) => ({ key: fragment.key, digest: fragment.digest })),
        }],
      },
    })
    expect(presented?.rows?.map((message) => message.id)).toEqual(['a'])
    expect(presented?.rows?.[0]?.content[0]).toMatchObject({ text: secret })
    expect(presented?.patch.messages).toEqual([])
    expect(presented?.edges).toEqual({ older: null, newer: null, total: 1 })
  })

  it('sends only the row a patch changed', () => {
    const result = windowResult([textMessage('a', 'assistant', 'kept'), textMessage('b', 'assistant', 'live')], { sessionId: 's' })
    const sync = new TranscriptWindowSync(applyWindowResult(null, result, EMPTY_WINDOW_LOOKUP).state)
    const live = sync.current.messages[1]!
    const presented = presentDesktopWindowPatch(sync, {
      type: 'transcript_window', holder: 'desktop:s',
      patch: {
        total: result.total,
        order: ['a', 'b'],
        messages: [{
          id: live.id, index: live.index, metaDigest: live.metaDigest,
          omittedBefore: live.omittedBefore, omittedAfter: live.omittedAfter,
          fragments: live.fragments.map((fragment) => ({ key: fragment.key, digest: fragment.digest })),
        }],
      },
    })
    expect(presented?.rows?.map((message) => message.id)).toEqual(['b'])
    expect(presented?.patch).toEqual({ messages: [], total: result.total, order: ['a', 'b'] })
    expect(presentDesktopWindowPatch(sync, {
      type: 'transcript_window', holder: 'desktop:s',
      patch: { total: 1, messages: [{ id: 'missing', index: 9, metaDigest: 'nope', omittedBefore: 0, omittedAfter: 0, fragments: [] }] },
    })).toBeNull()
  })
})

describe('DESKTOP_FOLD_BUDGET', () => {
  it('reads about one page of tool rows, not the whole window', () => {
    const tools = 80
    const content: ContentBlock[] = Array.from({ length: tools }, (_, i) => {
      const toolUseId = `t${i}`
      return [
        { type: 'tool_use' as const, toolName: 'Read', toolUseId, status: 'complete' as const, input: '{}' },
        { type: 'tool_result' as const, toolUseId, summary: 'ok' },
      ]
    }).flat()
    const message = { id: 'a', role: 'assistant' as const, status: 'complete' as const, createdAt: '', providerId: 'claude', content }
    const folded = foldMessageFragments(fragmentMessage(message), [{
      start: 0, end: content.length - 1,
      summary: { segments: tools, toolCalls: tools, files: [], added: 0, removed: 0, contentKey: 'tool:t0' },
    }])
    const inner = folded.folds.values().next().value!
    const page = selectFoldPage(inner, undefined, DESKTOP_FOLD_BUDGET)!
    const calls = inner.entries.slice(page.start, page.end).filter((fragment) => fragment.body.kind === 'block' && fragment.body.block.type === 'tool_use').length
    expect(DESKTOP_WINDOW_BUDGET).toEqual({ maxBytes: 512 * 1024, maxFragments: 160, targetChars: 18_000 })
    expect(DESKTOP_FOLD_BUDGET.maxFragments).toBeLessThanOrEqual(DESKTOP_WINDOW_BUDGET.maxFragments)
    expect(calls).toBeGreaterThanOrEqual(20)
    expect(calls).toBeLessThanOrEqual(30)
    expect(page.end).toBeLessThan(inner.entries.length)
  })
})
