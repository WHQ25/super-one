import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { PinnedSessionEntry, SessionHistoryEntry } from '@superone/shared/agent-types'
import { PROJECT_SETTLED_COLLAPSE_KEY, settledPanelId } from './sidebar-section-collapse'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import type { SessionActivity } from '@superone/shared/session-activity'

const FOLDER = '/storybook/collaboration'
const parent: SessionHistoryEntry = {
  sessionId: 'parent', title: 'Build the account opening workflow',
  lastActiveAt: '2026-10-09T00:00:00.000Z', messageCount: 1, provider: 'claude',
}
const callbacks = {
  onSwitchSession: () => {}, onPinSession: () => {}, onSettleSession: () => {},
  onRenameSession: () => {}, onDeleteSession: () => {}, onToggleExpand: () => {},
  onEditProject: () => {}, onRemoveProject: () => {}, onNewSession: () => {},
}

function Preview({ width = 280 }: { width?: number }) {
  useLayoutEffect(() => {
    const previousChat = useChatStore.getState()
    const previousScheduled = useScheduledSendsStore.getState()
    const project = createDefaultProjectState()
    const child = createDefaultPerSessionState()
    child._title = 'M2-3 — Bind the phone number and build the opening wizard'
    child.status = 'streaming'
    child._historyHydrated = false
    child.messages = [{
      id: 'initial-task', role: 'user', status: 'complete', providerId: 'claude',
      createdAt: '2026-10-09T00:00:00.000Z', content: [{ type: 'text', text: 'Build the opening wizard' }],
      metadata: { source: 'collaboration', collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionId: 'parent' } },
    }]
    project._activeSessionId = 'parent'
    project._sessions = { child }
    useChatStore.setState({ activeProject: FOLDER, projectSessions: { [FOLDER]: project } })
    useScheduledSendsStore.setState({ bySession: {} })
    return () => {
      useChatStore.setState(previousChat)
      useScheduledSendsStore.setState(previousScheduled)
    }
  }, [])

  const finishHydration = () => {
    useChatStore.setState((state) => {
      const project = state.projectSessions[FOLDER]
      return { projectSessions: { ...state.projectSessions, [FOLDER]: {
        ...project, _sessions: { ...project._sessions, child: {
          ...project._sessions.child, _parentSessionId: 'parent', _historyHydrated: true,
        } },
      } } }
    })
  }

  return (
    <div style={{ width }}>
      <button className="mb-3 rounded border px-2 py-1 text-xs" onClick={finishHydration}>Complete child hydration</button>
      <div className="bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
        <ProjectSidebarRow
          {...callbacks}
          folder={{ id: 'collaboration', name: 'super-sub', path: FOLDER, addedAt: '2026-10-09T00:00:00.000Z', lastOpened: '2026-10-09T00:00:00.000Z' }}
          sessions={[parent]}
          isExpanded={false}
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'Sidebar/ProjectSidebarRow', component: Preview,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

export const ChildHydration: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const matchesTitle = (_text: string, element: Element | null) => element?.classList.contains('animated-title-inner') === true && !!element.textContent?.includes('M2-3')
    await expect(canvas.queryByText(matchesTitle)).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Complete child hydration' }))
    const title = await canvas.findByText(matchesTitle)
    const row = title.closest('.group\\/session')
    await expect(row).not.toBeNull()
    await expect(row?.querySelector('.lucide-corner-down-right')).not.toBeNull()
  },
}

export const NarrowChildHydration: Story = { ...ChildHydration, args: { width: 220 } }

const REMOTE_FOLDER = 'remote:storybook-node:/work/app'

/** Remote list summaries arrive without a child page or any transcript messages. */
function RemoteChildPreview({ width = 280, expanded = true }: { width?: number; expanded?: boolean }) {
  useLayoutEffect(() => {
    const previous = useChatStore.getState()
    useChatStore.setState({ activeProject: null, projectSessions: {}, agentTitles: {} })
    return () => { useChatStore.setState(previous) }
  }, [])
  const activity: SessionActivity = {
    sessionId: 'remote-child', projectPath: REMOTE_FOLDER, status: 'streaming', provider: 'codex',
    title: 'Check the remote build', parentSessionId: 'parent',
    pendingCount: 0, pendingReason: { en: null, zh: null },
  }
  const publish = (patch: Partial<SessionActivity>, completed = false) => {
    useChatStore.getState().handleAgentEvent({ type: 'session_activity', activity: { ...activity, ...patch }, completed })
  }
  return (
    <div style={{ width }}>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <button className="rounded border px-2 py-1" onClick={() => publish({})}>Start remote child</button>
        <button className="rounded border px-2 py-1" onClick={() => publish({ status: 'idle', completedMessageId: 'done' }, true)}>Finish child</button>
        <button className="rounded border px-2 py-1" onClick={() => publish({ status: 'idle', completedMessageId: 'done', seenCompletedMessageId: 'done' })}>Read completion</button>
      </div>
      <div className="bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
        <ProjectSidebarRow
          {...callbacks}
          folder={{ id: 'remote', name: 'Remote project', path: REMOTE_FOLDER, addedAt: '2026-10-09T00:00:00.000Z', lastOpened: '2026-10-09T00:00:00.000Z' }}
          sessions={[{ ...parent, childCount: 30 }]}
          isExpanded={expanded}
        />
      </div>
    </div>
  )
}

export const RemoteChildActivity: Story = {
  render: () => <RemoteChildPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Check the remote build')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Start remote child' }))
    const title = await canvas.findByText('Check the remote build')
    await expect(title.closest('.group\\/session')?.querySelector('.lucide-corner-down-right')).not.toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Finish child' }))
    await expect(canvas.getByText('Check the remote build')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Read completion' }))
    await expect(canvas.queryByText('Check the remote build')).not.toBeInTheDocument()
  },
}

export const NarrowCollapsedRemoteChildActivity: Story = {
  ...RemoteChildActivity,
  render: () => <RemoteChildPreview width={220} expanded={false} />,
}

export const SessionsOnly: Story = {
  render: () => (
    <div className="w-[280px] bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      <ProjectSidebarRow
        {...callbacks}
        sessionsOnly
        folder={{ id: 'merged', name: 'super-one', path: '/storybook/merged', addedAt: '2026-10-09T00:00:00.000Z', lastOpened: '2026-10-09T00:00:00.000Z' }}
        sessions={[parent]}
        isExpanded
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Build the account opening workflow')).toBeInTheDocument()
    await expect(canvas.queryByText('super-one')).not.toBeInTheDocument()
    await expect(canvas.queryByText('No sessions')).not.toBeInTheDocument()
  },
}

/** Folder and chevron share one slot. Search, automation, and new session stay hidden until hover. */
export const HoverActions: Story = {
  render: () => (
    <div className="w-[280px] bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      <ProjectSidebarRow
        {...callbacks}
        folder={{ id: 'hover', name: 'super-one', path: '/storybook/hover', addedAt: '2026-10-09T00:00:00.000Z', lastOpened: '2026-10-09T00:00:00.000Z' }}
        sessions={[parent]}
        isExpanded
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByText('super-one').closest('.h-9')
    const actions = row?.querySelector('[data-slot="project-row-actions"]')
    await expect(canvas.getByText('super-one')).toBeInTheDocument()
    await expect(canvas.getByText('Build the account opening workflow')).toBeInTheDocument()
    await expect(row?.querySelector('.lucide-chevron-right')).toHaveClass('hidden', 'group-hover:block')
    await expect(row?.querySelector('.lucide-folder-open')).toHaveClass('group-hover:hidden')
    await expect(actions).toHaveClass('invisible', 'opacity-0', 'group-hover:opacity-100')
    await expect(within(actions as HTMLElement).getByRole('button', { name: 'Search sessions…', hidden: true })).toBeInTheDocument()
    await expect(within(actions as HTMLElement).getByRole('button', { name: 'New Automation', hidden: true })).toBeInTheDocument()
    await expect(within(actions as HTMLElement).getByRole('button', { name: 'New Session', hidden: true })).toBeInTheDocument()
  },
}

export const LoadingSessions: Story = {
  render: () => (
    <div className="w-[280px] bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      <ProjectSidebarRow
        {...callbacks}
        folder={{ id: 'loading', name: 'super-one', path: '/storybook/loading', addedAt: '2026-10-09T00:00:00.000Z', lastOpened: '2026-10-09T00:00:00.000Z' }}
        sessions={[]}
        sessionsLoading
        isExpanded
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const spinner = canvas.getByLabelText('Loading...')
    const row = spinner.closest('.h-9')
    await expect(row).not.toBeNull()
    await expect(spinner).toHaveClass('size-3.5')
    await expect(spinner).not.toHaveClass('group-hover:hidden')
    await expect(row?.querySelector('.lucide-chevron-right')).toHaveClass('!hidden')
    await expect(canvas.queryByText('Loading...')).not.toBeInTheDocument()
    await expect(canvas.queryByText('No sessions')).not.toBeInTheDocument()
  },
}

/** A project that only has finished work shows Settled, not an empty session line. */
export const OnlySettled: Story = {
  render: () => (
    <div className="w-[280px] bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      <ProjectSidebarRow
        {...callbacks}
        folder={{ id: 'settled', name: 'super-one', path: '/storybook/settled', addedAt: '2026-10-09T00:00:00.000Z', lastOpened: '2026-10-09T00:00:00.000Z' }}
        sessions={[]}
        settledSessions={[{
          sessionId: 'settled',
          title: 'Finished the opening review',
          lastActiveAt: '2026-10-09T00:00:00.000Z',
          messageCount: 3,
          provider: 'claude',
          isSettled: true,
          folderPath: '/storybook/settled',
          folderName: 'super-one',
        } satisfies PinnedSessionEntry]}
        isExpanded
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByRole('button', { name: /Settled/ })
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText('No sessions')).not.toBeInTheDocument()
    const panel = canvasElement.querySelector(`[id="${settledPanelId('/storybook/settled')}"]`)
    await expect(panel).toHaveAttribute('hidden')
    await expect(canvas.queryByText('Finished the opening review')).toBeNull()
  },
}

const NESTED_FOLDER = '/storybook/nested-project'

function session(sessionId: string, title: string, extra?: Partial<SessionHistoryEntry>): SessionHistoryEntry {
  return {
    sessionId,
    title,
    lastActiveAt: '2026-10-09T00:00:00.000Z',
    messageCount: 2,
    provider: 'claude',
    ...extra,
  }
}

function child(parentSessionId: string, sessionId: string, title: string): SessionHistoryEntry {
  return session(sessionId, title, { parentSessionId })
}

const nestedRoots: SessionHistoryEntry[] = [
  session('review', 'Release review', { childCount: 1 }),
  session('digest', 'Send the weekly digest'),
  session('opening', 'Account opening', { childCount: 2 }),
  session('sidebar', 'Migrate the sidebar', { childCount: 40 }),
  session('nightly', 'Nightly checks', { childCount: 6 }),
  session('relay', 'Relay notes'),
]

const nestedChildren: Record<string, SessionHistoryEntry[]> = {
  review: [child('review', 'review-upload', 'Fix the flaky upload')],
  opening: [
    child('opening', 'opening-phone', 'Bind the phone number'),
    child('opening', 'opening-wizard', 'Build the opening wizard'),
  ],
  sidebar: Array.from({ length: 40 }, (_, index) => child('sidebar', `sidebar-${index}`, `Sidebar child ${index}`)),
}

const nestedSettled: PinnedSessionEntry[] = Array.from({ length: 36 }, (_, index) => ({
  ...session(`settled-${index}`, `Settled session ${index}`),
  isSettled: true,
  folderPath: NESTED_FOLDER,
  folderName: 'super-one',
}))

function rememberSettledOpen(folderPath: string) {
  localStorage.setItem(PROJECT_SETTLED_COLLAPSE_KEY, JSON.stringify({ [folderPath]: false }))
}

/** One project: inline attention, a short child list, a paged child list, and Settled. */
function AllNestingPreview() {
  rememberSettledOpen(NESTED_FOLDER)
  useLayoutEffect(() => {
    const previousApp = useAppStore.getState()
    const previousChat = useChatStore.getState()
    const previousScheduled = useScheduledSendsStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = 'opening-wizard'
    const streaming = createDefaultPerSessionState()
    streaming.status = 'streaming'
    project._sessions['review-upload'] = streaming
    project.unseenCompletedSessions.add('review-upload')
    useAppStore.setState({ currentFolder: NESTED_FOLDER, tmpFolder: null })
    useChatStore.setState({ activeProject: NESTED_FOLDER, projectSessions: { [NESTED_FOLDER]: project } })
    useScheduledSendsStore.setState({
      bySession: {
        digest: {
          sessionId: 'digest',
          sendAt: Date.now() + 3_600_000,
          message: 'Continue',
          armed: true,
          source: 'manual',
        },
      },
    })
    return () => {
      useAppStore.setState(previousApp)
      useChatStore.setState(previousChat)
      useScheduledSendsStore.setState(previousScheduled)
    }
  }, [])

  return (
    <div className="w-[288px] bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      <ProjectSidebarRow
        {...callbacks}
        folder={{
          id: 'nested',
          name: 'super-one',
          path: NESTED_FOLDER,
          addedAt: '2026-10-09T00:00:00.000Z',
          lastOpened: '2026-10-09T00:00:00.000Z',
        }}
        sessions={nestedRoots}
        childSessions={nestedChildren}
        childSessionsHasMore={{ sidebar: true }}
        initialExpandedChildIds={['opening', 'sidebar']}
        sessionsHasMore
        settledSessions={nestedSettled}
        settledCount={40}
        settledHasMore
        isExpanded
      />
    </div>
  )
}

export const AllNesting: Story = {
  render: () => <AllNestingPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const inline = canvas.getByText('Fix the flaky upload')
    await expect(inline.closest('[data-child-session-list]')).toBeNull()
    await expect(inline.closest('[data-active-session-list]')).not.toBeNull()
    await expect(canvas.getByText('Send the weekly digest')).toBeInTheDocument()

    const shortChild = canvas.getByText('Bind the phone number')
    const shortList = shortChild.closest('[data-child-session-list]')
    await expect(shortList).not.toBeNull()
    await expect(shortList).toHaveClass('max-h-36')

    const longChild = canvas.getByText('Sidebar child 0')
    const longList = longChild.closest('[data-child-session-list]')
    await expect(longList).not.toBeNull()
    await expect(longList).not.toBe(shortList)
    await expect(longList).toHaveClass('max-h-36')
    await expect(canvas.queryByText('Sidebar child 39')).toBeNull()
    await expect(canvas.queryByText('Nightly child')).toBeNull()

    await expect(canvasElement.querySelector('[data-active-session-list]')).toHaveClass('max-h-64')
    const settled = canvas.getByRole('button', { name: /Settled/ })
    await expect(settled).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Settled session 0')).toBeInTheDocument()
    await expect(canvas.queryByText('Settled session 35')).toBeNull()
  },
}
