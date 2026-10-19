/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { SessionRow } from './SessionRow'

const FOLDER = '/proj'

const noop = {
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onHideSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
}

function entry(sessionId: string, title: string): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '0', messageCount: 1 }
}

function hoverActionButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('button')).filter((btn) =>
    btn.className.split(/\s+/).includes('w-0'),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useScheduledSendsStore.setState({ bySession: {} })
})

describe('SessionRow opening icon', () => {
  it('replaces the leading glyph without adding a row', () => {
    const { container } = render(
      <SessionRow
        session={entry('open', 'Hydrating the remote transcript')}
        folderPath={FOLDER}
        animateTitle={false}
        opening
        {...noop}
      />,
    )

    const spinner = screen.getByLabelText('Loading...')
    const row = spinner.closest('.group\\/session')
    expect(row).not.toBeNull()
    expect(row?.querySelector('.session-row-title')).toHaveTextContent('Hydrating the remote transcript')
    expect(container.querySelectorAll('.group\\/session')).toHaveLength(1)
  })
})

describe('SessionRow scheduled icon', () => {
  it('replaces the leading message glyph and leaves hover actions collapsed at rest', () => {
    const sendAt = Date.now() + 3_600_000
    useScheduledSendsStore.setState({
      bySession: {
        short: { sessionId: 'short', sendAt, message: 'Continue', armed: true, source: 'manual' },
        nested: { sessionId: 'nested', sendAt, message: 'Continue', armed: true, source: 'manual' },
      },
    })

    const { container } = render(
      <div>
        <SessionRow
          session={entry('short', 'Short title')}
          folderPath={FOLDER}
          animateTitle={false}
          {...noop}
        />
        <SessionRow
          session={entry('nested', 'Parent with collab children')}
          folderPath={FOLDER}
          animateTitle={false}
          hasChildren
          childrenCollapsed
          onToggleChildren={vi.fn()}
          {...noop}
        />
      </div>,
    )

    expect(screen.getAllByLabelText(/Scheduled for/i)).toHaveLength(2)

    const actions = hoverActionButtons(container)
    // One pin on the short row; expand + pin on the nested row.
    expect(actions).toHaveLength(3)
    for (const btn of actions) {
      const tokens = btn.className.split(/\s+/)
      expect(tokens).toContain('w-0')
      expect(tokens).toContain('p-0')
      expect(tokens).not.toContain('p-0.5')
      expect(tokens).toContain('group-hover/session:w-3')
      expect(tokens).toContain('group-hover/session:p-0.5')
    }

    for (const clock of screen.getAllByLabelText(/Scheduled for/i)) {
      const row = clock.closest('.group\\/session')!
      const title = row.querySelector('.session-row-title')!
      expect(clock.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(row.querySelector('.lucide-message-square')).toBeNull()
    }
  })
})
