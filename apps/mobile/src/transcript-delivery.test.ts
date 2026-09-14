import { afterEach, expect, it, vi } from 'vitest'
import type { HostInbound } from '@superone/chat-view'
import type { ChatMessage } from '@superone/shared/agent-types'
import { TranscriptDelivery, TRANSCRIPT_RETRY_MS } from './transcript-delivery'

const row = (id: string, text = id): ChatMessage => ({
  id, role: 'assistant', status: 'complete', providerId: 'claude', createdAt: '', content: [{ type: 'text', text }],
})
function setup() {
  vi.useFakeTimers()
  const send = vi.fn<(message: HostInbound) => void>()
  const delivery = new TranscriptDelivery(send)
  const receipt = () => {
    const envelope = send.mock.lastCall![0]
    if (!('delivery' in envelope) || !envelope.delivery) throw new Error('Missing receipt')
    return envelope.delivery
  }
  const acknowledge = () => { const ack = receipt(); delivery.acknowledge(ack.channelId, ack.sequence) }
  return { delivery, send, receipt, acknowledge }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('retries the final paint even when no further agent events arrive', () => {
  const { delivery, send, acknowledge } = setup()
  delivery.publish({ messages: [] })
  acknowledge()
  delivery.publish({ messages: [row('answer')], sessionStatus: 'idle' })
  const missed = send.mock.lastCall![0]
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS)
  expect(send.mock.lastCall![0]).toBe(missed)
  acknowledge()
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS * 3)
  expect(send).toHaveBeenCalledTimes(3)
})

it('coalesces a slow document into the latest state while retaining optional artwork and ordering', () => {
  const { delivery, send, acknowledge } = setup()
  const history = row('history')
  delivery.publish({ messages: [history] })
  delivery.publish({ messages: [history, row('live', '1')], mentionArtwork: { 'miniapp:one': 'icon' } })
  for (let i = 2; i <= 100; i++) delivery.publish({ messages: [history, row('live', String(i))], sessionStatus: 'streaming' })
  expect(send).toHaveBeenCalledTimes(1)
  acknowledge()
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.lastCall![0]).toMatchObject({
    type: 'applyReductionPatch', messagePatches: [row('live', '100')],
    messageOrder: ['history', 'live'], mentionArtwork: { 'miniapp:one': 'icon' }, sessionStatus: 'streaming',
  })
  acknowledge()
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS * 2)
  expect(send).toHaveBeenCalledTimes(2)
})

it('replaces outstanding session paints on hydrate and ignores old receipts', () => {
  const { delivery, send, receipt, acknowledge } = setup()
  delivery.publish({ messages: [row('old')] })
  const old = receipt()
  delivery.publish({ messages: [row('old-pending')] })
  delivery.publish({ messages: [row('new')] }, true)
  const current = send.mock.lastCall![0]
  delivery.acknowledge(old.channelId, old.sequence)
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS)
  expect(send.mock.lastCall![0]).toBe(current)
  expect(current).toMatchObject({ type: 'hydrate', messages: [row('new')] })
  acknowledge()
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS * 2)
  expect(send).toHaveBeenCalledTimes(3)
})

it('retries a native injection error and cancels outstanding work on disposal', () => {
  const { delivery, send } = setup()
  send.mockImplementationOnce(() => { throw new Error('WebView unavailable') })
  expect(() => delivery.publish({ messages: [row('answer')] })).not.toThrow()
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS)
  expect(send).toHaveBeenCalledTimes(2)
  delivery.dispose()
  vi.advanceTimersByTime(TRANSCRIPT_RETRY_MS * 3)
  expect(send).toHaveBeenCalledTimes(2)
})
