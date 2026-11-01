import { describe, expect, it } from 'vitest'
import { DRAFT_SLOT_HOLE, nextDraftSlots } from './draft-slots'

describe('draft row slots', () => {
  it('holds every other row still while a middle draft is resumed', () => {
    const listed = ['d1', 'd2', 'd3', 'd4', 'd5']
    const promoted = 'd-composer'

    const frozen = nextDraftSlots(listed, ['d1', 'd2', 'd4', 'd5'], true)
    expect(frozen).toEqual(['d1', 'd2', DRAFT_SLOT_HOLE, 'd4', 'd5'])

    const settled = nextDraftSlots(frozen, [promoted, 'd1', 'd2', 'd4', 'd5'], true)
    expect(settled).toEqual([promoted, 'd1', 'd2', 'd4', 'd5'])
    expect(settled.indexOf('d4')).toBe(frozen.indexOf('d4'))
    expect(settled.indexOf('d5')).toBe(frozen.indexOf('d5'))
    expect(settled.indexOf('d1')).toBe(frozen.indexOf('d1') + 1)
    expect(settled.indexOf('d2')).toBe(frozen.indexOf('d2') + 1)
  })

  it('keeps the reserved height while one draft is swapped for another', () => {
    let slots = ['d-clicked']
    const steps: Array<{ visible: string[]; resuming: boolean }> = [
      { visible: [], resuming: true },
      { visible: [], resuming: true },
      { visible: ['d-outgoing'], resuming: true },
      { visible: ['d-outgoing'], resuming: false },
    ]
    const heights = steps.map((step) => {
      slots = nextDraftSlots(slots, step.visible, step.resuming)
      return slots.length
    })
    expect(heights).toEqual([1, 1, 1, 1])
    expect(slots).toEqual(['d-outgoing'])
  })

  it('follows the list once no resume is in flight', () => {
    expect(nextDraftSlots(['a', 'b'], ['b'], false)).toEqual(['b'])
    expect(nextDraftSlots(['a', DRAFT_SLOT_HOLE], ['c', 'a'], false)).toEqual(['c', 'a'])
  })
})
