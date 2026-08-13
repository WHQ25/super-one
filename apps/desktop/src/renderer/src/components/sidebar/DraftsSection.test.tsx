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
  useDraftsStore.setState({ byConnection: {}, loading: {}, resumingDraftId: null })
})

describe('DraftsSection', () => {
  it('resumes the draft that was clicked', () => {
    const one = draft('d1', 'first draft')
    useDraftsStore.setState({ byConnection: { local: [one] } })

    render(<DraftsSection connectionId="local" />)
    fireEvent.click(screen.getByText('first draft'))

    expect(resumeDraft).toHaveBeenCalledWith('local', one)
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
