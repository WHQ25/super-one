import { describe, it, expect, beforeEach } from 'vitest'
import type { DraftListEntry } from '@superone/shared/environment'
import { DRAFT_SLOT_HOLE, nextDraftSlots, selectVisibleDrafts } from './draft-visibility'
import { _resetDraftSessionMap } from '@/stores/chat-store/helpers/draft-promote'

function draft(id: string, originSessionId: string | null): DraftListEntry {
  return {
    id,
    text: id,
    docJson: null,
    attachments: [],
    projectPath: '/p',
    title: null,
    harness: null,
    model: null,
    permissionMode: null,
    settings: null,
    originSessionId,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingSync: false,
  } as unknown as DraftListEntry
}

beforeEach(() => {
  _resetDraftSessionMap()
})

describe('sidebar draft rows', () => {
  it('lists a draft whose origin session is no longer focused', () => {
    const rows = selectVisibleDrafts([draft('d1', 'sess-a')], {
      activeSessionId: 'sess-b',
      activeDraftId: null,
      resumingDraftId: null,
    })

    expect(rows.map((d) => d.id)).toEqual(['d1'])
  })

  it('hides the draft being edited in the focused composer', () => {
    const rows = selectVisibleDrafts([draft('d1', 'sess-a')], {
      activeSessionId: 'sess-a',
      activeDraftId: null,
      resumingDraftId: null,
    })

    expect(rows).toEqual([])
  })

  it('keeps the row count flat while one draft is swapped for another', () => {
    // Hopping draft A → draft B. Resume promotes A's composer up front but only
    // deletes B's row after an awaited project switch, and that switch is what
    // stops hiding A. Without the resuming guard the list holds both in the gap,
    // so the group expands and then collapses — the shudder.
    const clicked = draft('d-clicked', 'sess-clicked')
    const outgoing = draft('d-outgoing', 'sess-outgoing')
    const listDuringResume = [outgoing, clicked]

    // 1. Editing the outgoing composer; only the clicked draft has a row.
    expect(
      selectVisibleDrafts([clicked], {
        activeSessionId: 'sess-outgoing',
        activeDraftId: null,
        resumingDraftId: null,
      }).map((d) => d.id),
    ).toEqual([clicked.id])

    // 2. Click lands: outgoing is promoted into the list AND focus has moved off
    //    it, so it stops being hidden by ownership — the exact moment both rows
    //    would otherwise be listed.
    expect(
      selectVisibleDrafts(listDuringResume, {
        activeSessionId: 'sess-destination',
        activeDraftId: null,
        resumingDraftId: clicked.id,
      }).map((d) => d.id),
    ).toEqual([outgoing.id])

    // 3. Resume finishes and drops the clicked row. Still exactly one row, so
    //    the group's height target never moved.
    expect(
      selectVisibleDrafts([outgoing], {
        activeSessionId: 'sess-destination',
        activeDraftId: clicked.id,
        resumingDraftId: null,
      }).map((d) => d.id),
    ).toEqual([outgoing.id])
  })

  it('never moves the reserved height across a draft → draft hop', () => {
    // Replays the real commit order. The visible count dips to zero mid-resume
    // (clicked draft dropped on click, outgoing one not yet unhidden), so slots
    // must be frozen or the project list jumps up and back down.
    const clicked = draft('d-clicked', 'sess-clicked')
    const outgoing = draft('d-outgoing', 'sess-outgoing')
    const steps: Array<{ drafts: DraftListEntry[]; sid: string; resuming: string | null }> = [
      // Editing the outgoing composer — only the clicked draft has a row.
      { drafts: [clicked], sid: 'sess-outgoing', resuming: null },
      // Click: clicked draft hidden, outgoing not promoted yet → zero rows.
      { drafts: [clicked], sid: 'sess-outgoing', resuming: clicked.id },
      // Outgoing promoted, but focus has not moved yet → still owned, still zero.
      { drafts: [outgoing, clicked], sid: 'sess-outgoing', resuming: clicked.id },
      // Project switch commits → outgoing surfaces.
      { drafts: [outgoing, clicked], sid: 'sess-destination', resuming: clicked.id },
      // Clicked row deleted, guard released.
      { drafts: [outgoing], sid: 'sess-destination', resuming: null },
    ]

    let slots: string[] = [clicked.id]
    const heights = steps.map((step) => {
      const visible = selectVisibleDrafts(step.drafts, {
        activeSessionId: step.sid,
        activeDraftId: null,
        resumingDraftId: step.resuming,
      })
      slots = nextDraftSlots(slots, visible.map((d) => d.id), !!step.resuming)
      return slots.length
    })

    expect(heights).toEqual([1, 1, 1, 1, 1])
  })

  it('holds every other row still while a middle draft is resumed', () => {
    // Five listed drafts, composer holds unsent text, third row clicked. The two
    // below it must not budge; the two above slide down one slot to make room
    // for the promoted composer, which lands in the top slot.
    const listed = ['d1', 'd2', 'd3', 'd4', 'd5']
    const promoted = 'd-composer'

    // Click: d3 drops out. Nothing else may move, so its slot is held empty.
    const frozen = nextDraftSlots(listed, ['d1', 'd2', 'd4', 'd5'], true)
    expect(frozen).toEqual(['d1', 'd2', DRAFT_SLOT_HOLE, 'd4', 'd5'])

    // Switch lands: the composer surfaces at the head of the list. Now — and
    // only now — the final layout is known, so it is applied in one move.
    const settled = nextDraftSlots(frozen, [promoted, 'd1', 'd2', 'd4', 'd5'], true)
    expect(settled).toEqual([promoted, 'd1', 'd2', 'd4', 'd5'])

    // d4/d5 kept slots 3 and 4 the whole way — they never animate.
    expect(settled.indexOf('d4')).toBe(frozen.indexOf('d4'))
    expect(settled.indexOf('d5')).toBe(frozen.indexOf('d5'))
    // d1/d2 move down exactly one slot, once.
    expect(settled.indexOf('d1')).toBe(frozen.indexOf('d1') + 1)
    expect(settled.indexOf('d2')).toBe(frozen.indexOf('d2') + 1)
  })

  it('follows the list order once no resume is in flight', () => {
    expect(nextDraftSlots(['a', 'b'], ['b'], false)).toEqual(['b'])
    expect(nextDraftSlots(['a', DRAFT_SLOT_HOLE], ['c', 'a'], false)).toEqual(['c', 'a'])
  })

  it('shows the row again when a failed resume clears the guard', () => {
    const drafts = [draft('d1', 'sess-a')]
    const ctx = { activeSessionId: 'sess-b', activeDraftId: null }

    expect(selectVisibleDrafts(drafts, { ...ctx, resumingDraftId: 'd1' })).toHaveLength(0)
    expect(selectVisibleDrafts(drafts, { ...ctx, resumingDraftId: null })).toHaveLength(1)
  })
})
