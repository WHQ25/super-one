import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../agent-types'
import type { TranscriptFoldResult } from '../environment/transcript-window'
import { foldMessageFragments, selectFoldPage, type FoldRange } from './folds'
import { MessageFragmenter } from './fragment-message'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow, type WindowSource } from './select-window'
import { processTurn } from './window-fixtures'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP } from './window-store'
import { TranscriptWindowSync } from './window-sync'

const TOOLS = 12
const reply = processTurn('a', TOOLS)
/** Reasoning and every call and result: everything but the closing text. */
const range: FoldRange = { start: 0, end: reply.content.length - 2, summary: { segments: 5, toolCalls: TOOLS, files: [], added: 0, removed: 0, contentKey: 'thinking::0' } }

function source(message: ChatMessage, folded: boolean): WindowSource {
  const fragments = new MessageFragmenter().fragment(message)
  return { count: 1, at: () => folded ? foldMessageFragments(fragments, [range]) : fragments, indexOf: () => 0 }
}

function open(folded = true): { sync: TranscriptWindowSync; window: WindowSource } {
  const window = source(reply, folded)
  const selected = selectTranscriptWindow(window, {}, DEFAULT_WINDOW_BUDGET)
  return { sync: new TranscriptWindowSync(applyWindowResult(null, { ...selected, total: 1 }, EMPTY_WINDOW_LOOKUP).state), window }
}

/** The page a host serves after `after`, as `WindowViews.fold` cuts it. */
function page(window: WindowSource, after: string | undefined, maxFragments: number): TranscriptFoldResult {
  const fragments = window.at(0) as ReturnType<typeof foldMessageFragments>
  const [key, inner] = [...fragments.folds][0]
  const fold = fragments.fragments.find((fragment) => fragment.key === key)!
  const { start, end } = selectFoldPage(inner, after, { ...DEFAULT_WINDOW_BUDGET, maxFragments })!
  return {
    sessionId: 's', messageId: 'a', fold: key, revision: fold.body.kind === 'fold' ? fold.body.revision : '',
    fragments: inner.entries.slice(start, end).map(({ key, digest, body }) => ({ key, digest, body })),
    rest: end < inner.entries.length ? { ...range.summary, toolCalls: 1, fragments: inner.entries.length - end } : null,
  }
}

const foldOf = (message: ChatMessage) => message.content.find((block) => block.type === 'notice' && block.fold)

describe('transcript window folds', () => {
  it('paints a fold as a notice the Detail header counts', () => {
    const { sync } = open()
    const [message] = sync.messages()
    expect(message.content.map((block) => block.type)).toEqual(['notice', 'text'])
    const fold = foldOf(message)
    expect(fold?.type === 'notice' && fold.fold).toMatchObject({ messageId: 'a', toolCalls: TOOLS, fragments: range.end + 1 })
    expect(message.metadata?.window).toBeUndefined()
  })

  it('splices pages in order and keeps the rest folded after them', () => {
    const { sync, window } = open()
    const key = (foldOf(sync.messages()[0]) as Extract<ChatMessage['content'][number], { type: 'notice' }>).fold!.key
    const first = page(window, undefined, 5)
    expect(sync.foldRequest('a', key)).toEqual({ revision: first.revision })
    expect(sync.applyFoldPage(first, undefined)).toBe(true)
    let [message] = sync.messages()
    const loaded = first.fragments.length
    expect(message.content.slice(0, -2).length).toBe(loaded)
    const rest = foldOf(message)
    expect(rest?.type === 'notice' && rest.fold).toMatchObject({ key, after: first.fragments.at(-1)!.key, toolCalls: 1 })
    expect(sync.foldRequest('a', key)).toEqual({ revision: first.revision, after: first.fragments.at(-1)!.key })

    // A read that raced this one joins nothing.
    const before = sync.messages()
    expect(sync.applyFoldPage(first, undefined)).toBe(true)
    expect(sync.messages()).toBe(before)

    const second = page(window, first.fragments.at(-1)!.key, 1000)
    expect(second.rest).toBeNull()
    sync.applyFoldPage(second, first.fragments.at(-1)!.key)
    ;[message] = sync.messages()
    expect(message.content).toEqual(reply.content)
  })

  it('drops a page for a fold that changed', () => {
    const { sync, window } = open()
    expect(sync.applyFoldPage({ ...page(window, undefined, 5), revision: 'other' }, undefined)).toBe(false)
    expect(sync.applyFoldPage({ ...page(window, undefined, 5), fold: 'fold:gone' }, undefined)).toBe(false)
  })

  it('keeps a settled reply whole when the fragments behind its new fold were already shown', () => {
    const { sync } = open(false)
    expect(sync.messages()[0].content).toEqual(reply.content)
    const folded = selectTranscriptWindow(source(reply, true), {}, DEFAULT_WINDOW_BUDGET)
    expect(sync.applyPatch({ messages: folded.messages, total: 1 })).toBe(true)
    expect(sync.messages()[0].content).toEqual(reply.content)
  })
})
