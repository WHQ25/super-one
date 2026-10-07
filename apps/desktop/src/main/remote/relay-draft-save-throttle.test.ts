import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftChangedEvent } from '@superone/shared/environment/draft-rpc'
import { RELAY_DRAFT_SAVE_INTERVAL_MS, RelayDraftSaveThrottle, type DraftRecipients } from './relay-draft-save-throttle'

const change = (draftId: string, text: string, reason: DraftChangedEvent['reason'] = 'saved'): DraftChangedEvent =>
  ({ type: 'draft_changed', draftId, reason, draft: { id: draftId, text } as DraftChangedEvent['draft'] })

describe('RelayDraftSaveThrottle', () => {
  let sent: Array<{ event: DraftChangedEvent; targets?: string[] }>
  let recipients: DraftRecipients
  let throttle: RelayDraftSaveThrottle

  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    recipients = { lan: ['lan-phone'], relay: ['relay-phone'] }
    throttle = new RelayDraftSaveThrottle((event, targets) => sent.push({ event, targets }), (targets) => ({
      lan: recipients.lan.filter((id) => !targets || targets.includes(id)),
      relay: recipients.relay.filter((id) => !targets || targets.includes(id)),
    }))
  })
  afterEach(() => { throttle.dispose(); vi.useRealTimers() })

  it('sends every save to LAN phones and the latest save to relay phones once per interval', () => {
    throttle.route(change('d1', 'a'))
    throttle.route(change('d1', 'ab'))
    throttle.route(change('d1', 'abc'))
    expect(sent.map((s) => [s.event.draft?.text, s.targets])).toEqual([['a', ['lan-phone']], ['ab', ['lan-phone']], ['abc', ['lan-phone']]])

    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent.at(-1)).toEqual({ event: change('d1', 'abc'), targets: ['relay-phone'] })
    expect(sent).toHaveLength(4)
  })

  it('throttles each draft separately', () => {
    throttle.route(change('d1', 'one'))
    throttle.route(change('d2', 'two'))
    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent.filter((s) => s.targets?.includes('relay-phone')).map((s) => s.event.draftId)).toEqual(['d1', 'd2'])
  })

  it('sends lease and delete changes at once and drops the waiting save', () => {
    throttle.route(change('d1', 'typed'))
    throttle.route(change('d1', 'typed', 'opened'), undefined)
    expect(sent.at(-1)).toEqual({ event: change('d1', 'typed', 'opened'), targets: undefined })

    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent.some((s) => s.targets?.includes('relay-phone'))).toBe(false)
  })

  it('delivers to relay phones present when the interval ends', () => {
    recipients.relay = []
    throttle.route(change('d1', 'a'))
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent).toHaveLength(1)

    recipients.relay = ['relay-phone']
    throttle.route(change('d1', 'ab'))
    recipients.relay = ['relay-phone', 'late-phone']
    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent.at(-1)?.targets).toEqual(['relay-phone', 'late-phone'])
  })

  it('discards waiting saves on dispose', () => {
    throttle.route(change('d1', 'a'))
    throttle.dispose()
    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent).toHaveLength(1)
  })
})
