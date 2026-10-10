import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createEventBatcher } from './event-batcher'

const text = (t: string): AgentEvent => ({ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: t } })
const status: AgentEvent = { type: 'status_change', status: 'idle' }

afterEach(() => { vi.useRealTimers() })

describe('createEventBatcher', () => {
  it('holds deltas for the delay and folds them on flush', () => {
    vi.useFakeTimers()
    const sent: AgentEvent[][] = []
    const batcher = createEventBatcher((events) => { sent.push(events) })
    batcher.push(text('a'))
    batcher.push(text('b'))
    expect(sent).toEqual([])
    vi.advanceTimersByTime(33)
    expect(sent).toEqual([[text('ab')]])
  })

  it('sends any other event at once, together with the deltas before it', () => {
    const sent: AgentEvent[][] = []
    const batcher = createEventBatcher((events) => { sent.push(events) })
    batcher.push(text('a'))
    batcher.push(status)
    expect(sent).toEqual([[text('a'), status]])
  })

  it('never mixes groups in one batch', () => {
    const sent: Array<[AgentEvent[], string[] | undefined]> = []
    const batcher = createEventBatcher<string[]>((events, group) => { sent.push([events, group]) })
    batcher.push(text('a'), ['p1'])
    batcher.push(text('b'), ['p2'])
    batcher.flush()
    expect(sent).toEqual([[[text('a')], ['p1']], [[text('b')], ['p2']]])
  })

  it('flushes at the event and byte caps', () => {
    const sent: AgentEvent[][] = []
    const batcher = createEventBatcher((events) => { sent.push(events) }, { maxEvents: 2, maxBytes: 200 })
    batcher.push({ ...text('a'), seq: 1 })
    batcher.push({ ...text('b'), seq: 2 })
    batcher.push({ ...text('c'), seq: 3 })
    expect(sent).toHaveLength(1)
    batcher.push({ ...text('x'.repeat(300)), seq: 4 })
    expect(sent.map((batch) => batch.length)).toEqual([2, 1, 1])
  })

  it('drops the pending batch on clear and stays usable', () => {
    vi.useFakeTimers()
    const sent: AgentEvent[][] = []
    const batcher = createEventBatcher((events) => { sent.push(events) })
    batcher.push(text('a'))
    batcher.clear()
    vi.advanceTimersByTime(33)
    batcher.push(status)
    expect(sent).toEqual([[status]])
  })
})
