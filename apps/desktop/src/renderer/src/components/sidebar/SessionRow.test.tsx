/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { SessionHoverBody, SessionHoverCard, SessionHoverCardTrigger } from './multi-host/SessionHoverCard'
import { PinnedSessionRow } from './PinnedSessionRow'
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

const hoverModel: SessionHoverModel = {
  title: 'Hydrating the remote transcript',
  projectName: 'transcript-viewer',
  environmentLabel: 'This Mac',
  kind: 'local',
  connection: 'connected',
  worktreeName: null,
  lastActiveAt: '0',
  tags: [],
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

  it('keeps the opening spinner in front of the hide control', () => {
    render(
      <div>
        <SessionRow
          session={entry('open', 'Hydrating the remote transcript')}
          folderPath={FOLDER}
          animateTitle={false}
          opening
          {...noop}
        />
        <SessionRow
          session={entry('idle', 'Idle session')}
          folderPath={FOLDER}
          animateTitle={false}
          {...noop}
        />
      </div>,
    )

    const spinner = screen.getByLabelText('Loading...')
    expect(spinner.parentElement?.className ?? '').not.toContain('group-hover/session:opacity-0')
    const openingRow = spinner.closest('.group\\/session')
    expect(openingRow?.querySelector('.lucide-eye-off')).toBeNull()
    expect(openingRow?.querySelector('.lucide-eye')).toBeNull()

    const idleRow = screen.getByText('Idle session').closest('.group\\/session')
    expect(idleRow?.querySelector('.lucide-eye-off')).not.toBeNull()
    const idleGlyph = idleRow?.querySelector('.lucide-message-square')
    expect(idleGlyph?.parentElement?.className ?? '').toContain('group-hover/session:opacity-0')
  })
})

describe('SessionRow hover card', () => {
  it('anchors the card to the session row and keeps the title a direct flex item', () => {
    const { container } = render(
      <SessionRow
        session={entry('open', 'Hydrating the remote transcript')}
        folderPath={FOLDER}
        hover={hoverModel}
        {...noop}
      />,
    )

    const trigger = container.querySelector('[data-slot="hover-card-trigger"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.className).toContain('group/session')
    expect(trigger?.className).toContain('flex')
    expect(trigger?.className).toContain('items-center')
    expect(trigger?.className).toContain('py-1.5')
    const title = trigger?.querySelector('.animated-title-wrap')
    expect(title).not.toBeNull()
    expect(title?.parentElement).toBe(trigger)
  })

  it('anchors a pinned card to the whole pinned row', () => {
    const { container } = render(
      <PinnedSessionRow
        session={{ ...entry('pin', 'Pinned title'), provider: 'claude', folderPath: FOLDER, folderName: 'super-one' }}
        isActive={false}
        status="idle"
        isUnseen={false}
        hover={hoverModel}
        {...noop}
      />,
    )

    const trigger = container.querySelector('[data-slot="hover-card-trigger"]')
    expect(trigger?.className).toContain('group/pin')
    expect(trigger?.className).toContain('flex')
    expect(trigger?.className).toContain('items-center')
    expect(trigger?.className).toContain('py-1.5')
    expect(trigger?.className.split(/\s+/)).not.toContain('flex-1')
    const title = trigger?.querySelector('.animated-title-wrap')
    expect(title?.parentElement).toBe(trigger)
    expect(title).toHaveClass('text-md')
    expect(screen.queryByText('super-one')).toBeNull()
    expect(trigger?.querySelector('.inline-flex')).toHaveStyle({ width: '20px', height: '20px' })
  })

  it('clamps the card title to three lines', () => {
    render(
      <SessionHoverBody
        model={{
          ...hoverModel,
          title: 'Investigate the nightly CI failure that only reproduces on the remote desktop checkout',
        }}
      />,
    )

    expect(screen.getByText(/Investigate the nightly CI failure/)).toHaveClass('line-clamp-3')
  })

  it('still opens the session menu from a right-click on the hovered row', () => {
    const { container } = render(
      <SessionRow
        session={entry('open', 'Hydrating the remote transcript')}
        folderPath={FOLDER}
        hover={hoverModel}
        {...noop}
      />,
    )

    fireEvent.contextMenu(container.querySelector('[data-slot="hover-card-trigger"]')!)
    expect(screen.getByText('Pin Session')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Tags' })).toBeNull()
  })

  it('still opens the pinned session menu from a right-click', () => {
    const { container } = render(
      <PinnedSessionRow
        session={{ ...entry('pin', 'Pinned title'), folderPath: FOLDER, folderName: 'super-one' }}
        isActive={false}
        status="idle"
        isUnseen={false}
        hover={hoverModel}
        {...noop}
      />,
    )

    fireEvent.contextMenu(container.querySelector('[data-slot="hover-card-trigger"]')!)
    expect(screen.getByText('Pin Session')).toBeInTheDocument()
  })

  it('opens on the right of the row, top-aligned, outside the row', () => {
    render(
      <SessionHoverCard model={hoverModel} open>
        <SessionHoverCardTrigger>
          <div className="group/session">Hydrating the remote transcript</div>
        </SessionHoverCardTrigger>
      </SessionHoverCard>,
    )

    const content = document.querySelector('[data-slot="hover-card-content"]')
    expect(content).not.toBeNull()
    expect(content?.getAttribute('data-side')).toBe('right')
    expect(content?.getAttribute('data-align')).toBe('start')
    const trigger = document.querySelector('[data-slot="hover-card-trigger"]')
    expect(trigger?.contains(content)).toBe(false)
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
