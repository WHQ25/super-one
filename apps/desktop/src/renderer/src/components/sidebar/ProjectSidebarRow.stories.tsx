import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { ProjectSidebarRow } from './ProjectSidebarRow'

const FOLDER = '/storybook/collaboration'
const parent: SessionHistoryEntry = {
  sessionId: 'parent', title: 'Build the account opening workflow',
  lastActiveAt: '2026-10-09T00:00:00.000Z', messageCount: 1, provider: 'claude',
}
const callbacks = {
  onSwitchSession: () => {}, onPinSession: () => {}, onHideSession: () => {},
  onRenameSession: () => {}, onDeleteSession: () => {}, onToggleExpand: () => {},
  onEditProject: () => {}, onRemoveProject: () => {}, onNewSession: () => {},
  onLoadMoreSessions: async () => [],
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
          hasMoreSessions={false}
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
