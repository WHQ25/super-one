/** @vitest-environment jsdom */

import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { SessionHoverBody, SessionHoverCard, SessionHoverCardTrigger } from './multi-host/SessionHoverCard'
import { PinnedSessionRow } from './PinnedSessionRow'
import { SessionRow } from './SessionRow'
import { useSidebarFocusStore } from './sidebar-focus'
import { useSessionMenuItems } from './useSessionMenuItems'

const FOLDER = '/proj'

const noop = {
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onSettleSession: vi.fn(),
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

function seedStatus(sessionId: string, status: 'idle' | 'streaming' | 'background' | 'error') {
  const project = createDefaultProjectState()
  const live = createDefaultPerSessionState()
  live.status = status
  project._sessions[sessionId] = live
  useChatStore.setState({ activeProject: FOLDER, projectSessions: { [FOLDER]: project } })
}

function menuIds(session: SessionHistoryEntry): string[] {
  const { result } = renderHook(() => useSessionMenuItems(session, FOLDER, noop))
  return result.current.flatMap((entry) => (entry.kind === 'item' ? [entry.id] : []))
}

beforeEach(() => {
  vi.clearAllMocks()
  useScheduledSendsStore.setState({ bySession: {} })
  useChatStore.setState({ projectSessions: {}, activeProject: null })
  useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
  useSidebarFocusStore.setState({ target: null })
})

describe('session focus drill', () => {
  it('opens a parent session on double click and leaves a leaf row alone', () => {
    const session = entry('parent', 'Opening workflow')
    const { rerender } = render(
      <SessionRow
        session={session}
        folderPath={FOLDER}
        hasChildren
        focusEnvironmentId="env-1"
        animateTitle={false}
        {...noop}
      />,
    )
    fireEvent.click(screen.getByText('Opening workflow'))
    expect(noop.onSwitchSession).toHaveBeenCalledWith(FOLDER, 'parent')
    expect(useSidebarFocusStore.getState().target).toBeNull()
    fireEvent.doubleClick(screen.getByText('Opening workflow'))
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'session',
      folderPath: FOLDER,
      sessionId: 'parent',
      environmentId: 'env-1',
    })

    useSidebarFocusStore.setState({ target: null })
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Pin Session' }))
    expect(useSidebarFocusStore.getState().target).toBeNull()

    useSidebarFocusStore.setState({ target: null })
    rerender(
      <SessionRow
        session={entry('leaf', 'Leaf note')}
        folderPath={FOLDER}
        animateTitle={false}
        {...noop}
      />,
    )
    fireEvent.doubleClick(screen.getByText('Leaf note'))
    expect(useSidebarFocusStore.getState().target).toBeNull()
  })
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

  it('keeps the opening spinner in front of the settle control', () => {
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
    expect(openingRow?.querySelector('.lucide-circle-check')).toBeNull()

    const idleRow = screen.getByText('Idle session').closest('.group\\/session')
    expect(idleRow?.querySelector('.lucide-circle-check')).not.toBeNull()
    const idleGlyph = idleRow?.querySelector('.lucide-message-square')
    expect(idleGlyph?.parentElement?.className ?? '').toContain('group-hover/session:opacity-0')
  })
})

describe('SessionRow settle only while idle', () => {
  function rowFor(title: string): Element | null {
    return screen.getByText(title).closest('.group\\/session')
  }

  it('hides the hover control and the context menu while a turn is streaming', () => {
    seedStatus('run', 'streaming')
    render(<SessionRow session={entry('run', 'Streaming')} folderPath={FOLDER} animateTitle={false} {...noop} />)
    const row = rowFor('Streaming')
    expect(row?.querySelector('.lucide-circle-check')).toBeNull()
    expect(row?.querySelector('.relative > span')?.className ?? '').not.toContain('group-hover/session:opacity-0')
    expect(menuIds(entry('run', 'Streaming'))).not.toContain('settle')
  })

  it('hides settle while a background task is running', () => {
    seedStatus('bg', 'background')
    render(<SessionRow session={entry('bg', 'Background')} folderPath={FOLDER} animateTitle={false} {...noop} />)
    expect(rowFor('Background')?.querySelector('.lucide-circle-check')).toBeNull()
    expect(menuIds(entry('bg', 'Background'))).not.toContain('settle')
  })

  it('hides settle during a live voice call', () => {
    useRealtimeCallStore.setState({ sessionId: 'voice', state: 'active' })
    const session = { ...entry('voice', 'Voice'), provider: 'codex' as const }
    render(<SessionRow session={session} folderPath={FOLDER} animateTitle={false} {...noop} />)
    expect(rowFor('Voice')?.querySelector('.lucide-circle-check')).toBeNull()
    expect(menuIds(session)).not.toContain('settle')
  })

  it('hides settle while a spawn child still has an open turn', () => {
    const project = createDefaultProjectState()
    const child = createDefaultPerSessionState()
    child.status = 'streaming'
    child._parentSessionId = 'parent'
    project._sessions.child = child
    useChatStore.setState({ activeProject: FOLDER, projectSessions: { [FOLDER]: project } })
    const session = entry('parent', 'Parent')
    render(<SessionRow session={session} folderPath={FOLDER} animateTitle={false} {...noop} />)
    expect(rowFor('Parent')?.querySelector('.lucide-circle-check')).toBeNull()
    expect(menuIds(session)).not.toContain('settle')
  })

  it('keeps unsettle when a settled parent still has a running child', () => {
    const project = createDefaultProjectState()
    const child = createDefaultPerSessionState()
    child.status = 'streaming'
    child._parentSessionId = 'parent'
    project._sessions.child = child
    useChatStore.setState({ activeProject: FOLDER, projectSessions: { [FOLDER]: project } })
    const session = { ...entry('parent', 'Settled parent'), isSettled: true }
    render(<SessionRow session={session} folderPath={FOLDER} animateTitle={false} {...noop} />)
    expect(menuIds(session)).toContain('settle')
  })

  it('offers settle when the last turn ended in an error', () => {
    seedStatus('err', 'error')
    render(<SessionRow session={entry('err', 'Errored')} folderPath={FOLDER} animateTitle={false} {...noop} />)
    expect(rowFor('Errored')?.querySelector('.lucide-circle-check')).not.toBeNull()
    expect(menuIds(entry('err', 'Errored'))).toContain('settle')
  })

  it('keeps unsettle on a settled row that is still streaming', () => {
    seedStatus('set', 'streaming')
    const session = { ...entry('set', 'Settled busy'), isSettled: true }
    render(<SessionRow session={session} folderPath={FOLDER} animateTitle={false} {...noop} />)
    const row = rowFor('Settled busy')
    const undo = row?.querySelector('.lucide-undo-2')
    expect(undo).not.toBeNull()
    expect(undo?.closest('button')?.className).toContain('w-0')
    expect(row?.querySelector('.lucide-pin')).toBeNull()
    expect(row?.querySelector('.lucide-circle-check')).toBeNull()
    expect(row?.querySelector('.relative > span')?.className ?? '').not.toContain('group-hover/session:opacity-0')
    expect(menuIds(session)).toContain('settle')
    expect(menuIds(session)).not.toContain('pin')
    fireEvent.click(undo?.closest('button') as HTMLButtonElement)
    expect(noop.onSettleSession).toHaveBeenCalledWith('set', false, FOLDER)
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
    // flex-basis 0 so a nowrap title ellipsizes inside the row instead of
    // stretching the row's layout box past the sidebar.
    expect(title).toHaveClass('min-w-0', 'flex-1')
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
    expect(title).toHaveClass('text-sm')
    expect(screen.queryByText('super-one')).toBeNull()
    expect(trigger?.querySelector('.inline-flex')).toHaveStyle({ width: '20px', height: '20px' })
  })

  it('shows a detached worktree commit instead of its folder name', async () => {
    const previous = window.app.getWorktreeInfo
    const getWorktreeInfo = vi.fn().mockResolvedValue({
      isWorktree: true,
      currentBranch: 'abc1234',
      entries: [{
        path: '/repo/.worktrees/m1abc-abc1234',
        branch: '',
        head: 'abc1234deadbeef',
        isMain: false,
        isCurrent: true,
      }],
    })
    Object.assign(window.app, { getWorktreeInfo })
    try {
      render(
        <SessionHoverCard
          open
          model={{
            ...hoverModel,
            worktreeName: null,
            worktreePath: '/repo/.worktrees/m1abc-abc1234',
            projectPath: '/repo',
          }}
        >
          <SessionHoverCardTrigger>
            <button type="button">row</button>
          </SessionHoverCardTrigger>
        </SessionHoverCard>,
      )

      expect(await screen.findByText('abc1234')).toBeInTheDocument()
      expect(screen.queryByText('m1abc-abc1234')).toBeNull()
      expect(getWorktreeInfo).toHaveBeenCalledWith('/repo/.worktrees/m1abc-abc1234')
    } finally {
      Object.assign(window.app, { getWorktreeInfo: previous })
    }
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
