import { describe, expect, it } from 'vitest'
import type { ChatMessage, RealtimeTimelineSegment } from './agent-types'
import {
  buildRealtimeConversationTurns,
  dedupeSegmentsByItem,
  isRealtimeDelegationMessage,
  isRealtimeVoiceMessage,
  mergeRealtimeTranscript,
  suppressRealtimeStartupEcho,
} from './realtime-transcript'

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 8, 0, 0, seconds)).toISOString()
const ms = (seconds: number) => Date.UTC(2026, 8, 8, 0, 0, seconds)

function message(id: string, role: ChatMessage['role'], text: string, seconds: number): ChatMessage {
  return {
    id, role, content: [{ type: 'text', text }], providerId: 'codex',
    status: 'complete', createdAt: at(seconds),
  }
}

function segment(
  id: string,
  role: RealtimeTimelineSegment['role'],
  text: string,
  extra: Partial<RealtimeTimelineSegment> = {},
): RealtimeTimelineSegment {
  return { id, realtimeSessionId: 'rt-1', role, text, ...extra }
}

const textOf = (rows: ChatMessage[]) => rows.map((row) => (
  row.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
))

describe('mergeRealtimeTranscript', () => {
  it('returns the spine untouched when there is no voice', () => {
    const spine = [message('u1', 'user', 'typed', 10), message('a1', 'assistant', 'answer', 11)]
    expect(mergeRealtimeTranscript(spine, undefined)).toEqual(spine)
    expect(mergeRealtimeTranscript(spine, [])).toEqual(spine)
  })

  it('splices spoken turns at their wall clock', () => {
    const spine = [
      message('u1', 'user', 'typed first', 10),
      message('a1', 'assistant', 'answered first', 20),
      message('u2', 'user', 'typed last', 40),
      message('a2', 'assistant', 'answered last', 50),
    ]
    const segments = [
      segment('local-1', 'user', 'spoken question', { sourceItemId: 'item-1', startedAtMs: ms(30) }),
      segment('local-2', 'assistant', 'spoken answer', { sourceItemId: 'item-2', startedAtMs: ms(31) }),
    ]
    expect(textOf(mergeRealtimeTranscript(spine, segments))).toEqual([
      'typed first', 'answered first', 'spoken question', 'spoken answer', 'typed last', 'answered last',
    ])
  })

  it('carries the whole conversation when the spine is empty', () => {
    // A voice-only session persists nothing to chat_messages at all.
    const segments = [
      segment('local-1', 'user', 'hello', { startedAtMs: ms(1) }),
      segment('local-2', 'assistant', 'hi there', { startedAtMs: ms(2) }),
      segment('local-3', 'user', 'and again', { startedAtMs: ms(3) }),
    ]
    expect(textOf(mergeRealtimeTranscript([], segments))).toEqual(['hello', 'hi there', 'and again'])
  })

  it('joins consecutive assistant utterances into one turn', () => {
    const segments = [
      segment('local-1', 'user', 'question', { startedAtMs: ms(1) }),
      segment('local-2', 'assistant', 'first half', { startedAtMs: ms(2) }),
      segment('local-3', 'assistant', 'second half', { startedAtMs: ms(3) }),
    ]
    expect(textOf(mergeRealtimeTranscript([], segments))).toEqual(['question', 'first half\n\nsecond half'])
  })

  it('keeps an unstamped turn where the previous one left the cursor', () => {
    const spine = [message('u1', 'user', 'typed first', 10), message('u2', 'user', 'typed last', 40)]
    const segments = [
      segment('local-1', 'user', 'stamped', { startedAtMs: ms(20) }),
      segment('local-2', 'user', 'unstamped'),
    ]
    expect(textOf(mergeRealtimeTranscript(spine, segments))).toEqual([
      'typed first', 'stamped', 'unstamped', 'typed last',
    ])
  })

  it('ignores localOrder, which inverts across an app restart', () => {
    // The voice row was written in an earlier run with a high process-global seq;
    // the typed rows come from this run with a low one. Wall clock is the truth.
    const spine = [message('u1', 'user', 'typed later', 90)]
    const segments = [segment('local-1', 'user', 'spoken earlier', { localOrder: 40_000, startedAtMs: ms(10) })]
    expect(textOf(mergeRealtimeTranscript(spine, segments))).toEqual(['spoken earlier', 'typed later'])
  })

  it('orders voice by provider position only when every segment carries one', () => {
    const ordered = [
      segment('a', 'user', 'second', { position: 2, startedAtMs: ms(1) }),
      segment('b', 'user', 'first', { position: 1, startedAtMs: ms(2) }),
    ]
    expect(textOf(mergeRealtimeTranscript([], ordered))).toEqual(['first', 'second'])

    // A partial set must not sort the stamped rows out of the incoming stream.
    const partial = [
      segment('a', 'user', 'arrived first', { startedAtMs: ms(1) }),
      segment('b', 'user', 'arrived second', { position: 1, startedAtMs: ms(2) }),
    ]
    expect(textOf(mergeRealtimeTranscript([], partial))).toEqual(['arrived first', 'arrived second'])
  })

  it('collapses an utterance present in both the database row and the live replay', () => {
    // index.ts persists before broadcasting, so every event replayed out of the
    // restore buffer is already in the snapshot the phone just fetched.
    const fromDatabase = segment('local-uuid', 'user', 'said once', { sourceItemId: 'item-9', startedAtMs: ms(5) })
    const fromLiveStream = segment('item-9', 'user', 'said once', { sourceItemId: 'item-9' })
    expect(textOf(mergeRealtimeTranscript([], [fromDatabase, fromLiveStream]))).toEqual(['said once'])
  })

  it('drops the realtime delegation envelope', () => {
    const spine = [
      message('deleg', 'user', '<realtime_delegation><input>go look</input></realtime_delegation>', 10),
      message('a1', 'assistant', 'looked', 11),
    ]
    expect(textOf(mergeRealtimeTranscript(spine, []))).toEqual(['looked'])
  })

  it('hides only the first voice turn when it echoes the previous typed user row', () => {
    const spine = [message('u1', 'user', 'hello', 10), message('a1', 'assistant', 'hi', 11)]
    const segments = [
      segment('voice-u1', 'user', 'hello', { position: 12 }),
      segment('voice-a1', 'assistant', 'hi again', { position: 13 }),
      segment('voice-u2', 'user', 'hello', { position: 14, startedAtMs: ms(14) }),
      segment('voice-a2', 'assistant', 'second reply', { position: 15, startedAtMs: ms(15) }),
    ]

    expect(textOf(mergeRealtimeTranscript(spine, segments))).toEqual([
      'hello',
      'hi',
      'hello',
      'second reply',
    ])
  })

  it('keeps a stamped first voice turn even when the user repeats the previous typed row', () => {
    const spine = [message('u1', 'user', 'hello', 10), message('a1', 'assistant', 'hi', 11)]
    const segments = [
      segment('voice-u1', 'user', 'hello', { position: 12, startedAtMs: ms(12) }),
      segment('voice-a1', 'assistant', 'hi again', { position: 13, startedAtMs: ms(13) }),
    ]

    expect(textOf(mergeRealtimeTranscript(spine, segments))).toEqual([
      'hello',
      'hi',
      'hello',
      'hi again',
    ])
  })
})

describe('restored startup echo suppression', () => {
  it.each(['event-seq', 'local-order'] as const)('does not compare %s to provider positions', (source) => {
    const typed = message('typed', 'user', 'previous request', 1)
    if (source === 'event-seq') typed._lastAppliedSeq = 50_000
    else typed.metadata = { codexTimeline: { provenance: 'codex', localOrder: 50_000 } }
    const echo = segment('echo', 'user', 'previous request', { position: 2 })
    expect(suppressRealtimeStartupEcho([typed], [echo])).toEqual([])
  })

  it('does not treat a local voice sequence as a provider position after restart', () => {
    const typed = message('typed', 'user', 'previous request', 1)
    typed.metadata = { codexTimeline: { provenance: 'codex', position: 200 } }
    const echo = segment('echo', 'user', 'previous request', { localOrder: 2 })
    expect(suppressRealtimeStartupEcho([typed], [echo])).toEqual([])
  })

  it('ignores a typed message known to follow the voice turn', () => {
    const typed = message('typed', 'user', 'same words', 10)
    typed.metadata = { codexTimeline: { provenance: 'codex', position: 20 } }
    const spoken = segment('spoken', 'user', 'same words', { position: 2 })
    expect(suppressRealtimeStartupEcho([typed], [spoken])).toEqual([spoken])
  })

  it('sorts a restored provider timeline before identifying its startup echo', () => {
    const typed = message('typed', 'user', 'previous request', 1)
    const segments = [
      segment('reply', 'assistant', 'echo reply', { position: 3 }),
      segment('echo', 'user', 'previous request', { position: 2 }),
      segment('new', 'user', 'new question', { position: 4, startedAtMs: ms(4) }),
    ]
    expect(textOf(mergeRealtimeTranscript([typed], segments))).toEqual(['previous request', 'new question'])
  })

  it('preserves an assistant-first greeting and subsequent repeated user speech', () => {
    const typed = message('typed', 'user', 'hello', 1)
    const segments = [segment('greeting', 'assistant', 'Welcome'), segment('spoken', 'user', 'hello')]
    expect(suppressRealtimeStartupEcho([typed], segments)).toEqual(segments)
  })
})

describe('dedupeSegmentsByItem', () => {
  it('keeps local stamps a provider refresh does not republish', () => {
    const local = segment('local-uuid', 'user', 'hi', { sourceItemId: 'item-1', startedAtMs: ms(5), localOrder: 7 })
    const canonical = segment('item-1', 'user', 'hi there', { sourceItemId: 'item-1', position: 3 })
    expect(dedupeSegmentsByItem([local, canonical])).toEqual([
      { ...local, ...canonical, startedAtMs: ms(5), localOrder: 7 },
    ])
  })
})

describe('buildRealtimeConversationTurns', () => {
  it('opens a new turn on a new realtime session even mid-speaker', () => {
    const turns = buildRealtimeConversationTurns([
      segment('a', 'assistant', 'call one'),
      { ...segment('b', 'assistant', 'call two'), realtimeSessionId: 'rt-2' },
    ])
    expect(turns).toHaveLength(2)
    expect(turns[1].realtimeSessionId).toBe('rt-2')
  })
})

describe('message predicates', () => {
  it('recognises projected voice rows and delegation envelopes', () => {
    const [voice] = mergeRealtimeTranscript([], [segment('a', 'user', 'spoken')])
    expect(isRealtimeVoiceMessage(voice)).toBe(true)
    expect(isRealtimeVoiceMessage(message('u1', 'user', 'typed', 1))).toBe(false)
    expect(isRealtimeDelegationMessage(
      message('d', 'user', '<realtime_delegation><input>x</input></realtime_delegation>', 1),
    )).toBe(true)
    expect(isRealtimeDelegationMessage(message('u1', 'user', 'typed', 1))).toBe(false)
  })
})
