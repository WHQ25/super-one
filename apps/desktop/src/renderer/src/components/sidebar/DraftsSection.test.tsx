/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import type { DraftListEntry } from '@superone/shared/environment'

const { resumeDraft } = vi.hoisted(() => ({
  resumeDraft: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/draft-resume', () => ({ resumeDraft }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { DraftsSection } from './DraftsSection'
import { useDraftsStore } from '@/stores/drafts'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'

function draft(id: string, title: string): DraftListEntry {
  return {
    id,
    text: title,
    docJson: null,
    attachments: [],
    projectPath: '/p',
    title,
    harness: null,
    model: null,
    permissionMode: null,
    settings: null,
    originSessionId: `sess-${id}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingSync: false,
  } as unknown as DraftListEntry
}

beforeEach(() => {
  vi.clearAllMocks()
  useDraftsStore.setState({ byConnection: {}, loading: {}, resumingDraftId: null, discardedIds: {} })
  useScheduledSendsStore.setState({ bySession: {} })
})

describe('DraftsSection', () => {
  it('resumes the draft that was clicked', () => {
    const one = draft('d1', 'first draft')
    useDraftsStore.setState({ byConnection: { local: [one] } })

    render(<DraftsSection connectionId="local" />)
    fireEvent.click(screen.getByText('first draft'))

    expect(resumeDraft).toHaveBeenCalledWith('local', one)
  })

  it('leads with the clock once the draft has a send queued behind it', () => {
    const one = draft('d1', 'first draft')
    useDraftsStore.setState({ byConnection: { local: [one] } })
    useScheduledSendsStore.setState({
      bySession: {
        'sess-d1': {
          sessionId: 'sess-d1',
          sendAt: Date.now() + 3_600_000,
          message: 'first draft',
          armed: true,
          source: 'manual',
        },
      },
    })

    render(<DraftsSection connectionId="local" />)

    // The draft is no longer a note to self — it is the message that goes out
    // at that time, and it is the only place that promise is visible: the
    // session it will create is deliberately kept out of the list until then.
    expect(screen.getByLabelText('sidebar.scheduledFor')).toBeInTheDocument()
  })

  it('cancels the queued send when the draft it mirrors is deleted', () => {
    const clearScheduledSend = vi.fn()
    Object.assign(window.app, { clearScheduledSend })
    useDraftsStore.setState({ byConnection: { local: [draft('d1', 'first draft')] } })
    useScheduledSendsStore.setState({
      bySession: {
        'sess-d1': {
          sessionId: 'sess-d1',
          sendAt: Date.now() + 3_600_000,
          message: 'first draft',
          armed: true,
          source: 'manual',
        },
      },
    })

    render(<DraftsSection connectionId="local" />)
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    // Otherwise the schedule keeps mirroring text the user just threw away.
    expect(clearScheduledSend).toHaveBeenCalledWith('sess-d1')
  })

  it('positions every row by slot rather than by flow', () => {
    // Slot-based means removing a row animates the ones below to a new offset
    // instead of letting the browser snap them up, which is what happened while
    // the flying copy was still mid-flight out of the vacated slot.
    useDraftsStore.setState({
      byConnection: { local: [draft('d1', 'first draft'), draft('d2', 'second draft')] },
    })

    const { container } = render(<DraftsSection connectionId="local" />)

    const wrappers = container.querySelectorAll('.absolute')
    expect(wrappers).toHaveLength(2)
    expect((wrappers[0] as HTMLElement).style.transform).not.toContain('36')
    expect((wrappers[1] as HTMLElement).style.transform).toContain('36')
  })

  it('keeps rows slot-positioned across a middle draft being resumed', () => {
    // Five drafts listed, third row clicked, then the promoted composer arrives.
    // Rows stay absolutely positioned by slot throughout — a regression to flow
    // layout would let the browser reflow them the instant d3 leaves the list.
    // Which slot each row settles in is asserted against nextDraftSlots in
    // draft-visibility.test.ts; jsdom does not run motion, so the settled
    // transforms are not observable here.
    const listed = [1, 2, 3, 4, 5].map((n) => draft(`d${n}`, `draft ${n}`))
    useDraftsStore.setState({ byConnection: { local: listed } })

    const { container } = render(<DraftsSection connectionId="local" />)
    const slotOf = (title: string) => {
      const row = screen.getByText(title).closest('.absolute') as HTMLElement
      return row.style.transform
    }
    const before = { d4: slotOf('draft 4'), d5: slotOf('draft 5') }

    fireEvent.click(screen.getByText('draft 3'))
    act(() => {
      useDraftsStore.setState({ resumingDraftId: 'd3' })
    })

    // Mid-resume: d3 is gone from the list, and the rows below still carry the
    // slot transform they were rendered with rather than having reflowed.
    expect(slotOf('draft 4')).toBe(before.d4)
    expect(slotOf('draft 5')).toBe(before.d5)
    // d3 is out of the list — the only copy left is the one flying out.
    expect(screen.getByText('draft 3').closest('.pointer-events-none')).not.toBeNull()

    // Switch lands: the promoted composer surfaces at the head of the list.
    act(() => {
      useDraftsStore.setState({
        byConnection: { local: [draft('d-composer', 'composer'), ...listed] },
      })
    })

    expect(slotOf('draft 4')).toBe(before.d4)
    expect(slotOf('draft 5')).toBe(before.d5)
    expect(screen.getByText('composer')).toBeInTheDocument()
  })

  it('tombstones the row when the trash is clicked so a later flush cannot resurrect it', async () => {
    const one = draft('d1', 'first draft')
    useDraftsStore.setState({ byConnection: { local: [one] } })
    const deleteDraft = vi.fn(async () => {})
    window.environment = {
      ...(window.environment ?? {}),
      listDrafts: vi.fn(async () => [one]),
      deleteDraft,
      upsertDraft: vi.fn(async (d: { id: string }) => d),
    } as unknown as typeof window.environment

    render(<DraftsSection connectionId="local" />)
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(useDraftsStore.getState().isDraftDiscarded('d1')).toBe(true)
    expect(useDraftsStore.getState().byConnection.local?.map((d) => d.id) ?? []).toEqual([])
    expect(deleteDraft).toHaveBeenCalledWith('local', 'd1')
  })

  it('leaves a copy of the clicked row behind to fly out after it drops from the list', () => {
    const one = draft('d1', 'first draft')
    useDraftsStore.setState({ byConnection: { local: [one] } })

    const { container } = render(<DraftsSection connectionId="local" />)
    fireEvent.click(screen.getByText('first draft'))

    // Resume hides the row the moment it is clicked. Without the flying copy the
    // draft would blink out of the sidebar with no exit at all.
    act(() => {
      useDraftsStore.setState({ resumingDraftId: one.id })
    })

    // The only row left is the flying copy — the real one is out of the list.
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1)
    const flying = container.querySelector('.pointer-events-none')
    expect(flying).not.toBeNull()
    expect(within(flying as HTMLElement).getByText('first draft')).toBeInTheDocument()
  })
})
