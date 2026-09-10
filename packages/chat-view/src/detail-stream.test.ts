import { expect, it } from 'vitest'
import { applyDetailUpdate, deliverDetail, listenDetail } from './detail-stream'
it('applies append and replacement with explicit offsets', () => {
  expect(applyDetailUpdate('abc', { subscriptionId: 's', revision: 1, offset: 3, text: 'def' })).toBe('abcdef')
  expect(applyDetailUpdate('abc', { subscriptionId: 's', revision: 2, offset: 0, text: 'new' })).toBe('new')
  expect(() => applyDetailUpdate('', { subscriptionId: 's', revision: 3, offset: 9, text: 'lost' })).toThrow('interrupted')
})
it('ignores packets for collapsed or unrelated subscriptions', () => {
  const updates: unknown[] = []
  const remove = listenDetail('open', update => updates.push(update))
  deliverDetail({ subscriptionId: 'other', revision: 0, offset: 0, text: 'hidden' })
  remove()
  deliverDetail({ subscriptionId: 'open', revision: 0, offset: 0, text: 'late' })
  expect(updates).toEqual([])
})
