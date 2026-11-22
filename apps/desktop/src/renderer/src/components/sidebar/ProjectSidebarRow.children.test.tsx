/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import { useChatStore } from '@/stores/chat'
import type { SessionActivity } from '@superone/shared/session-activity'

const folder: RecentFolder = {
  id: 'nested',
  name: 'super-one',
  path: '/storybook/nested',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
}

const callbacks = {
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onSettleSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onToggleExpand: vi.fn(),
  onEditProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onNewSession: vi.fn(),
}

function session(sessionId: string, title: string, extra?: Partial<SessionHistoryEntry>): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '0', messageCount: 1, ...extra }
}

describe('project child lists', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
    useChatStore.setState({ activeProject: null, projectSessions: {}, agentTitles: {} })
  })

  it('starts the named child lists open and leaves the others collapsed', async () => {
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        isExpanded
        sessions={[
          session('open-parent', 'Open parent', { childCount: 1 }),
          session('closed-parent', 'Closed parent', { childCount: 1 }),
        ]}
        childSessions={{
          'open-parent': [session('open-child', 'Open child', { parentSessionId: 'open-parent' })],
          'closed-parent': [session('closed-child', 'Closed child', { parentSessionId: 'closed-parent' })],
        }}
        initialExpandedChildIds={['open-parent']}
      />,
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Open child').closest('[data-child-session-list]')).not.toBeNull()
    expect(screen.queryByText('Closed child')).toBeNull()
    // Long nowrap titles must shrink with the list. Otherwise the row's layout
    // box runs past the sidebar and the hover card anchors to that hidden edge.
    expect(screen.getByText('Open parent').closest('[data-active-session-list]')).toHaveClass('min-w-0')
    expect(screen.getByText('Open child').closest('[data-child-session-list]')).toHaveClass('min-w-0')
  })

  it('reveals a remote running child without loading its transcript or opening the child list', async () => {
    const isExpanded = true
    const path = 'remote:conn-b:/work/app'
    const onLoadChildSessions = vi.fn()
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={{ ...folder, path }}
        isExpanded={isExpanded}
        sessions={[session('parent', 'Remote parent', { childCount: 30 })]}
        onLoadChildSessions={onLoadChildSessions}
      />,
    )
    expect(screen.queryByText('Remote running child')).toBeNull()

    const activity: SessionActivity = {
      sessionId: 'remote-child', projectPath: path, status: 'streaming', provider: 'codex',
      title: 'Remote running child', parentSessionId: 'parent',
      pendingCount: 0, pendingReason: { en: null, zh: null },
    }
    // The running notice can precede the title and collaboration relationship.
    act(() => useChatStore.getState().handleAgentEvent({
      type: 'session_activity', activity: { ...activity, title: null, parentSessionId: undefined },
    }))
    expect(screen.queryByText('Remote running child')).toBeNull()
    act(() => useChatStore.getState().handleAgentEvent({ type: 'session_activity', activity }))

    const title = await screen.findByText('Remote running child')
    const parentRow = screen.getByText('Remote parent').closest('.group\\/session')!
    expect(parentRow.parentElement?.parentElement).toContainElement(title)
    expect(title.closest('.group\\/session')?.querySelector('.lucide-corner-down-right')).not.toBeNull()
    expect(onLoadChildSessions).not.toHaveBeenCalled()
    expect(useChatStore.getState().projectSessions[path]._sessions['remote-child'].messages).toEqual([])

    // A completion stays visible until it is read on the source node or a phone.
    act(() => useChatStore.getState().handleAgentEvent({
      type: 'session_activity', activity: { ...activity, status: 'idle', completedMessageId: 'done' }, completed: true,
    }))
    expect(screen.getByText('Remote running child')).toBeInTheDocument()
    act(() => useChatStore.getState().handleAgentEvent({
      type: 'session_activity', activity: { ...activity, status: 'idle', completedMessageId: 'done', seenCompletedMessageId: 'done' },
    }))
    expect(screen.queryByText('Remote running child')).toBeNull()
  })

  it('hides a remote running child while the project is collapsed, and keeps one that needs input', async () => {
    const path = 'remote:conn-b:/work/app'
    const { rerender } = render(
      <ProjectSidebarRow
        {...callbacks}
        folder={{ ...folder, path }}
        isExpanded={false}
        sessions={[session('parent', 'Remote parent', { childCount: 30 })]}
      />,
    )
    const running: SessionActivity = {
      sessionId: 'remote-child', projectPath: path, status: 'streaming', provider: 'codex',
      title: 'Remote running child', parentSessionId: 'parent',
      pendingCount: 0, pendingReason: { en: null, zh: null },
    }
    act(() => useChatStore.getState().handleAgentEvent({ type: 'session_activity', activity: running }))
    expect(screen.queryByText('Remote running child')).toBeNull()

    act(() => useChatStore.getState().handleAgentEvent({
      type: 'session_activity',
      activity: { ...running, status: 'idle', pendingCount: 1, title: 'Approve the command' },
    }))
    expect(await screen.findByText('Approve the command')).toBeInTheDocument()
    expect(screen.getByText('Remote parent')).toBeInTheDocument()

    rerender(
      <ProjectSidebarRow
        {...callbacks}
        folder={{ ...folder, path }}
        isExpanded
        sessions={[session('parent', 'Remote parent', { childCount: 30 })]}
      />,
    )
    expect(screen.getByText('Approve the command')).toBeInTheDocument()
  })

  it('reveals a listed remote child whose activity placeholder has no messages', async () => {
    const path = 'remote:conn-b:/work/app'
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={{ ...folder, path }}
        isExpanded
        sessions={[session('parent', 'Remote parent', { childCount: 2 })]}
        childSessions={{ parent: [
          session('remote-child', 'Listed child', { parentSessionId: 'parent' }),
          session('idle-child', 'Idle sibling', { parentSessionId: 'parent' }),
        ] }}
      />,
    )
    expect(screen.queryByText('Listed child')).toBeNull()
    act(() => useChatStore.getState().handleAgentEvent({
      type: 'session_activity', activity: {
        sessionId: 'remote-child', projectPath: path, status: 'streaming', provider: 'claude',
        pendingCount: 0, pendingReason: { en: null, zh: null },
      },
    }))
    expect(await screen.findByText('Listed child')).toBeInTheDocument()
    expect(screen.queryByText('Idle sibling')).toBeNull()
  })

  it('keeps an unseen parent visible when collapsed, but hides unseen children', () => {
    useChatStore.setState({
      projectSessions: {
        [folder.path]: {
          _activeSessionId: null,
          _sessions: {},
          unseenCompletedSessions: new Set(['unseen-parent', 'unseen-child', 'unseen-child-of-idle']),
          hasUnseenActivity: false,
        } as never,
      },
    })
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        isExpanded={false}
        sessions={[
          session('unseen-parent', 'Unseen parent', { childCount: 1 }),
          session('idle-parent', 'Idle parent', { childCount: 1 }),
        ]}
        childSessions={{
          'unseen-parent': [session('unseen-child', 'Unseen child', { parentSessionId: 'unseen-parent' })],
          'idle-parent': [session('unseen-child-of-idle', 'Unseen child of idle', { parentSessionId: 'idle-parent' })],
        }}
      />,
    )

    expect(screen.getByText('Unseen parent')).toBeInTheDocument()
    expect(screen.queryByText('Unseen child')).toBeNull()
    expect(screen.queryByText('Idle parent')).toBeNull()
    expect(screen.queryByText('Unseen child of idle')).toBeNull()
  })
})
