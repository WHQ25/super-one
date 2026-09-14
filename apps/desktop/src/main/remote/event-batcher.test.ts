import { afterEach, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { RemoteEventBatcher } from './event-batcher'

afterEach(() => vi.useRealTimers())
const delta = (text: string, seq?: number): AgentEvent => ({ type: 'content_delta', messageId: 'm', sessionId: 's', delta: { type: 'text', text }, ...(seq == null ? {} : { seq }) })

it('batches frames but preserves sequenced deltas and flushes completion in order', () => {
  vi.useFakeTimers()
  const send = vi.fn()
  const batcher = new RemoteEventBatcher(send)
  batcher.push(delta('a', 1), ['phone'])
  batcher.push(delta('b', 2), ['phone'])
  expect(send).not.toHaveBeenCalled()
  batcher.push({ type: 'message_complete', messageId: 'm' } as AgentEvent, ['phone'])
  expect(send.mock.calls[0]![0].map((e: AgentEvent) => e.type)).toEqual(['content_delta', 'content_delta', 'message_complete'])
  vi.advanceTimersByTime(40)
  expect(send).toHaveBeenCalledTimes(1)
})

it('keeps recipients separate, folds only safe deltas, and discards pending work on disposal', () => {
  vi.useFakeTimers()
  const send = vi.fn()
  const batcher = new RemoteEventBatcher(send)
  batcher.push(delta('a'), ['one'])
  batcher.push(delta('b'), ['one'])
  batcher.push(delta('c'), ['two'])
  expect(send.mock.calls[0]![0][0].delta.text).toBe('ab')
  expect(send.mock.calls[0]![1]).toEqual(['one'])
  batcher.dispose()
  vi.advanceTimersByTime(40)
  expect(send).toHaveBeenCalledTimes(1)
})
