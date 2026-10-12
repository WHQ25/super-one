import { describe, expect, it } from 'vitest'
import { utf8Length } from './content-digest'
import { DEFAULT_WINDOW_BUDGET, MIN_WINDOW_BYTES, selectTranscriptWindow, windowBudget } from './select-window'
import { windowCoverage, applyWindowResult, EMPTY_WINDOW_LOOKUP } from './window-store'
import { conversation, longReplyText, textMessage, toolTurn, windowSource } from './window-fixtures'

const budget = DEFAULT_WINDOW_BUDGET

describe('selectTranscriptWindow', () => {
  it('returns nothing for an empty session', () => {
    expect(selectTranscriptWindow(windowSource([]), {}, budget)).toEqual({ messages: [], older: null, newer: null })
  })

  it('bounds a cold open of one megabyte reply to its tail', () => {
    const messages = [textMessage('u', 'user', 'Explain everything'), textMessage('a', 'assistant', longReplyText(1024 * 1024))]
    const source = windowSource(messages)
    const window = selectTranscriptWindow(source, {}, budget)
    expect(utf8Length(JSON.stringify(window))).toBeLessThanOrEqual(budget.maxBytes)
    expect(window.messages).toHaveLength(1)
    const [reply] = window.messages
    expect(reply.omittedAfter).toBe(0)
    expect(reply.omittedBefore).toBeGreaterThan(100)
    expect(window.older).toEqual({ messageId: 'a', key: reply.fragments[0].key })
    expect(window.newer).toBeNull()
    expect(source.calls).toEqual([1])
  })

  it('pages older content of the same reply before its anchor', () => {
    const messages = [textMessage('u', 'user', 'Explain'), textMessage('a', 'assistant', longReplyText(200 * 1024))]
    const source = windowSource(messages)
    const tail = selectTranscriptWindow(source, {}, budget)
    const older = selectTranscriptWindow(source, { anchor: tail.older!, direction: 'before' }, budget)
    const olderReply = older.messages[older.messages.length - 1]
    expect(olderReply.omittedAfter).toBe(tail.messages[0].fragments.length)
    expect(olderReply.fragments[olderReply.fragments.length - 1].key).not.toBe(tail.older!.key)
  })

  it('keeps a long tool turn within the fragment budget', () => {
    const window = selectTranscriptWindow(windowSource([textMessage('u', 'user', 'go'), toolTurn('a', 500)]), {}, budget)
    expect(window.messages[0].fragments.length).toBeLessThanOrEqual(budget.maxFragments)
    expect(window.messages[0].omittedBefore).toBeGreaterThan(0)
  })

  it('sends no body the client holds: six cached messages plus two new', () => {
    const before = conversation(6)
    const source = windowSource(before)
    const cached = applyWindowResult(null, { ...selectTranscriptWindow(source, {}, { ...budget, targetChars: 1e5 }), total: 6 }, EMPTY_WINDOW_LOOKUP).state
    expect(cached.messages).toHaveLength(6)
    const after = [...before, ...conversation(2, 'n')]
    const window = selectTranscriptWindow(windowSource(after), { have: windowCoverage(cached.messages) }, { ...budget, targetChars: 1e5 })
    const sent = window.messages.flatMap((message) => message.fragments.filter((f) => f.body).map(() => message.id))
    expect(sent).toEqual(['n0', 'n1'])
    expect(window.messages.filter((message) => message.meta).map((message) => message.id)).toEqual(['n0', 'n1'])
  })

  it('sends only the changed tail of a reply that grew while away', () => {
    const text = longReplyText(40 * 1024)
    const early = [textMessage('u', 'user', 'go'), textMessage('a', 'assistant', text.slice(0, 20 * 1024), 'streaming')]
    const cached = applyWindowResult(null, { ...selectTranscriptWindow(windowSource(early), {}, { ...budget, targetChars: 1e6 }), total: 2 }, EMPTY_WINDOW_LOOKUP).state
    const later = [early[0], textMessage('a', 'assistant', text, 'complete')]
    const window = selectTranscriptWindow(windowSource(later), { have: windowCoverage(cached.messages) }, { ...budget, targetChars: 1e6 })
    const reply = window.messages.find((message) => message.id === 'a')!
    const heldFragments = cached.messages.find((message) => message.id === 'a')!.fragments.length
    const sentIndexes = reply.fragments.flatMap((fragment, i) => (fragment.body ? [i + reply.omittedBefore] : []))
    expect(sentIndexes[0]).toBe(heldFragments - 1)
    expect(reply.meta).toBeDefined()
  })

  it('opens around a history anchor at the start of its message', () => {
    const messages = conversation(40)
    const window = selectTranscriptWindow(windowSource(messages), { anchor: { messageId: 'm20' }, direction: 'around' }, { ...budget, targetChars: 1500 })
    expect(window.messages[0].id).toBe('m20')
    expect(window.newer).not.toBeNull()
    expect(window.older).not.toBeNull()
  })

  it('pages from the far edge of a message whose anchor fragment is gone', () => {
    const messages = [textMessage('u', 'user', 'Explain'), textMessage('a', 'assistant', 'Short answer'), textMessage('n', 'user', 'Next')]
    const source = windowSource(messages)
    const before = selectTranscriptWindow(source, { anchor: { messageId: 'a', key: 'gone' }, direction: 'before' }, budget)
    expect(before.messages.map((m) => m.id)).toEqual(['u', 'a'])
    const after = selectTranscriptWindow(source, { anchor: { messageId: 'a', key: 'gone' }, direction: 'after' }, budget)
    expect(after.messages.map((m) => m.id)).toEqual(['a', 'n'])
  })

  it('rejects an anchor that no longer exists', () => {
    expect(() => selectTranscriptWindow(windowSource(conversation(3)), { anchor: { messageId: 'gone' } }, budget))
      .toThrow(expect.objectContaining({ code: 'not_found' }))
  })

  it('clamps budgets so one fragment always fits', () => {
    expect(windowBudget({ budget: { maxBytes: 1, maxFragments: 0 } })).toMatchObject({ maxBytes: MIN_WINDOW_BYTES, maxFragments: 1 })
    expect(windowBudget({ viewport: { width: 390, height: 844 } }).targetChars).toBeGreaterThan(1000)
  })
})
