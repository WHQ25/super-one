import { describe, expect, it } from 'vitest'
import type { TranscriptWindowPatch } from '../environment/transcript-window'
import { fragmentDigest } from './fragment-message'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from './select-window'
import {
  applyWindowPatch,
  applyWindowResult,
  EMPTY_WINDOW_LOOKUP,
  materializeWindowMessage,
  trimWindowState,
  windowCoverage,
  windowLookup,
} from './window-store'
import { conversation, longReplyText, textMessage, windowSource } from './window-fixtures'

const budget = DEFAULT_WINDOW_BUDGET

describe('window store', () => {
  it('materializes a partial reply with its continuation context and marker', () => {
    const text = longReplyText(100 * 1024)
    const window = selectTranscriptWindow(windowSource([textMessage('a', 'assistant', text)]), {}, budget)
    const { state } = applyWindowResult(null, { ...window, total: 1 }, EMPTY_WINDOW_LOOKUP)
    const message = materializeWindowMessage(state.messages[0])
    expect(message.metadata?.window).toEqual({ omittedBefore: state.messages[0].omittedBefore, omittedAfter: 0 })
    expect(message.content).toHaveLength(1)
    const rendered = message.content[0].type === 'text' ? message.content[0].text : ''
    expect(text.endsWith(rendered.slice(rendered.indexOf('\n') + 1).slice(-1000))).toBe(true)
    expect(materializeWindowMessage(state.messages[0])).toBe(message)
  })

  it('joins an older page onto the shared message', () => {
    const messages = [textMessage('u', 'user', 'go'), textMessage('a', 'assistant', longReplyText(300 * 1024))]
    const source = windowSource(messages)
    const tail = selectTranscriptWindow(source, {}, budget)
    let { state } = applyWindowResult(null, { ...tail, total: 2 }, EMPTY_WINDOW_LOOKUP)
    const older = selectTranscriptWindow(source, { anchor: state.older!, direction: 'before' }, budget)
    state = applyWindowResult(state, { ...older, total: 2 }, EMPTY_WINDOW_LOOKUP, 'older').state
    expect(state.messages).toHaveLength(1)
    const reply = state.messages[0]
    const all = source.at(1).fragments
    expect(reply.fragments.map((f) => f.key)).toEqual(all.slice(reply.omittedBefore).map((f) => f.key))
  })

  it('keeps the held meta and fragments of the shared message when the page saw a newer one', () => {
    const reply = longReplyText(300 * 1024)
    const tail = selectTranscriptWindow(windowSource([textMessage('a', 'assistant', reply, 'streaming')]), {}, budget)
    let { state } = applyWindowResult(null, { ...tail, total: 1 }, EMPTY_WINDOW_LOOKUP)
    const held = state.messages[0]
    const newer = windowSource([textMessage('a', 'assistant', `${reply} more`, 'complete')])
    const older = selectTranscriptWindow(newer, { anchor: state.older!, direction: 'before' }, budget)
    state = applyWindowResult(state, { ...older, total: 1 }, EMPTY_WINDOW_LOOKUP, 'older').state
    const joined = state.messages[0]
    expect(joined.metaDigest).toBe(held.metaDigest)
    expect(joined.fragments.slice(-held.fragments.length)).toEqual(held.fragments)
  })

  it('reports bodies it cannot resolve instead of inventing them', () => {
    const window = selectTranscriptWindow(windowSource(conversation(2)), { have: [{ id: 'm1', meta: 'x', f: [] }] }, budget)
    const claimed = { ...window, total: 2, messages: window.messages.map((m) => ({ ...m, fragments: m.fragments.map(({ body: _body, ...ref }) => ref) })) }
    expect(applyWindowResult(null, claimed, EMPTY_WINDOW_LOOKUP).missing).toEqual(['m0', 'm1'])
  })

  it('reuses cached bodies through a lookup', () => {
    const messages = conversation(4)
    const first = applyWindowResult(null, { ...selectTranscriptWindow(windowSource(messages), {}, budget), total: 4 }, EMPTY_WINDOW_LOOKUP).state
    const again = selectTranscriptWindow(windowSource(messages), { have: windowCoverage(first.messages) }, budget)
    const { state, missing } = applyWindowResult(null, { ...again, total: 4 }, windowLookup(first))
    expect(missing).toEqual([])
    expect(state.messages.map(materializeWindowMessage)).toEqual(first.messages.map(materializeWindowMessage))
  })

  it('appends streamed text, verifies the digest and ignores a repeat', () => {
    const { state } = applyWindowResult(null, { ...selectTranscriptWindow(windowSource([textMessage('a', 'assistant', 'Hello', 'streaming')]), {}, budget), total: 1 }, EMPTY_WINDOW_LOOKUP)
    const held = state.messages[0]
    const fragment = held.fragments[0]
    if (fragment.body.kind !== 'text') throw new Error('text expected')
    const digest = fragmentDigest({ ...fragment.body, text: 'Hello world' })
    const patch: TranscriptWindowPatch = { total: 1, messages: [{ ...held, meta: undefined, fragments: [{ key: fragment.key, digest, append: ' world' }] }] }
    const once = applyWindowPatch(state, patch)
    expect(once.stale).toBe(false)
    expect(materializeWindowMessage(once.state.messages[0]).content[0]).toMatchObject({ text: 'Hello world' })
    const twice = applyWindowPatch(once.state, patch)
    expect(twice.stale).toBe(false)
    expect(twice.state.messages[0]).toBe(once.state.messages[0])
  })

  it('flags a patch whose base it does not hold as stale', () => {
    const { state } = applyWindowResult(null, { ...selectTranscriptWindow(windowSource([textMessage('a', 'assistant', 'Hello')]), {}, budget), total: 1 }, EMPTY_WINDOW_LOOKUP)
    const held = state.messages[0]
    const patch: TranscriptWindowPatch = { total: 1, messages: [{ ...held, meta: undefined, fragments: [{ key: held.fragments[0].key, digest: 'zzzzzzzzzzzzzz', append: '!' }] }] }
    expect(applyWindowPatch(state, patch).stale).toBe(true)
  })

  it('moves the older edge when a patch brings a message that starts mid-way, or drops the first one', () => {
    let { state } = applyWindowResult(null, { ...selectTranscriptWindow(windowSource([textMessage('u', 'user', 'Hi')]), {}, budget), total: 1 }, EMPTY_WINDOW_LOOKUP)
    expect(state.older).toBeNull()
    const reply = selectTranscriptWindow(windowSource([textMessage('u', 'user', 'Hi'), textMessage('a', 'assistant', longReplyText(300 * 1024))]), {}, budget).messages[0]
    state = applyWindowPatch(state, { total: 2, messages: [reply], order: ['a'] }).state
    expect(reply.omittedBefore).toBeGreaterThan(0)
    expect(state.older).toEqual({ messageId: 'a', key: reply.fragments[0].key })
    const pair = selectTranscriptWindow(windowSource([textMessage('u', 'user', 'Hi'), textMessage('b', 'assistant', 'Hello')]), {}, budget)
    state = applyWindowResult(null, { ...pair, total: 2 }, EMPTY_WINDOW_LOOKUP).state
    state = applyWindowPatch(state, { total: 2, messages: [], removed: ['u'] }).state
    expect(state.older).toEqual({ messageId: 'b', key: pair.messages[1].fragments[0].key })
  })

  it('applies removal and reorder', () => {
    const messages = conversation(3)
    const { state } = applyWindowResult(null, { ...selectTranscriptWindow(windowSource(messages), {}, budget), total: 3 }, EMPTY_WINDOW_LOOKUP)
    const next = applyWindowPatch(state, { total: 2, messages: [], removed: ['m1'], order: ['m2', 'm0'] })
    expect(next.state.messages.map((m) => m.id)).toEqual(['m2', 'm0'])
  })

  it('trims the oldest fragments to a byte ceiling', () => {
    const { state } = applyWindowResult(null, { ...selectTranscriptWindow(windowSource([textMessage('a', 'assistant', longReplyText(400 * 1024))]), {}, { ...budget, maxBytes: 512 * 1024, maxFragments: 256, targetChars: 1e6 }), total: 1 }, EMPTY_WINDOW_LOOKUP)
    const trimmed = trimWindowState(state, 20 * 1024)
    expect(trimmed.messages[0].fragments.length).toBeLessThan(state.messages[0].fragments.length)
    expect(trimmed.messages[0].omittedBefore).toBe(state.messages[0].omittedBefore + state.messages[0].fragments.length - trimmed.messages[0].fragments.length)
    expect(trimmed.older?.key).toBe(trimmed.messages[0].fragments[0].key)
  })
})
