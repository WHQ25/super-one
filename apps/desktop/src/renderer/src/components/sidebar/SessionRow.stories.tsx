import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { SessionRow } from './SessionRow'

const FOLDER = '/storybook/super-one'

const noop = {
  onSwitchSession: () => {},
  onPinSession: () => {},
  onHideSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
}

function entry(sessionId: string, title: string, extra?: Partial<SessionHistoryEntry>): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '0', messageCount: 1, ...extra }
}

function armed(sessionId: string) {
  return {
    sessionId,
    sendAt: Date.now() + 3_600_000,
    message: 'Continue',
    armed: true as const,
    source: 'manual' as const,
  }
}

interface RowSpec {
  session: SessionHistoryEntry
  hasChildren?: boolean
  childrenCollapsed?: boolean
  status?: 'streaming' | 'background'
  unseen?: boolean
  pendingPlan?: boolean
}

function Preview({
  rows,
  activeId,
  scheduledIds = [],
  width = 280,
}: {
  rows: RowSpec[]
  activeId?: string
  scheduledIds?: string[]
  width?: number
}) {
  const scheduledKey = scheduledIds.join(',')
  const liveKey = rows.map((row) => `${row.session.sessionId}:${row.status ?? ''}:${row.unseen ? 1 : 0}:${row.pendingPlan ? 1 : 0}`).join('|')
  useLayoutEffect(() => {
    const prevApp = useAppStore.getState()
    const prevChat = useChatStore.getState()
    const prevSched = useScheduledSendsStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = activeId ?? null
    for (const row of rows) {
      if (!row.status && !row.unseen && !row.pendingPlan) continue
      const session = createDefaultPerSessionState()
      if (row.status) session.status = row.status
      if (row.pendingPlan) {
        session.pendingPlanApproval = {
          requestId: 'plan-1',
          planContent: 'Review the approach',
          planFilePath: '/tmp/plan.md',
          allowedPrompts: [],
        }
      }
      project._sessions[row.session.sessionId] = session
      if (row.unseen) project.unseenCompletedSessions.add(row.session.sessionId)
    }
    useAppStore.setState({ currentFolder: FOLDER, tmpFolder: null })
    useChatStore.setState({
      activeProject: FOLDER,
      projectSessions: { [FOLDER]: project },
    })
    useScheduledSendsStore.setState({
      bySession: Object.fromEntries(scheduledIds.map((id) => [id, armed(id)])),
    })
    return () => {
      useAppStore.setState(prevApp)
      useChatStore.setState(prevChat)
      useScheduledSendsStore.setState(prevSched)
    }
  }, [activeId, scheduledKey, liveKey])

  return (
    <div className="bg-sidebar p-1.5 text-sidebar-foreground" style={{ width }} data-sidebar-inner>
      {rows.map(({ session, hasChildren, childrenCollapsed }) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          folderPath={FOLDER}
          hasChildren={hasChildren}
          childrenCollapsed={childrenCollapsed}
          onToggleChildren={hasChildren ? () => {} : undefined}
          {...noop}
        />
      ))}
    </div>
  )
}

const meta = {
  title: 'Sidebar/SessionRow',
  component: SessionRow,
  parameters: { layout: 'centered' },
  args: { session: entry('idle', 'Idle session'), folderPath: FOLDER, ...noop },
} satisfies Meta<typeof SessionRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Preview rows={[{ session: entry('idle', 'Idle session') }]} />,
}

export const ScheduledClocksAlignAtRest: Story = {
  name: 'Scheduled clocks align at rest',
  render: () => (
    <Preview
      activeId="live"
      scheduledIds={['long', 'live', 'nested']}
      rows={[
        { session: entry('long', '补齐 session sync zone 全部 §9 未完成项') },
        { session: entry('live', '实现移动端 Live Activity 与推送通知') },
        { session: entry('nested', '调研移动端 Live Notification'), hasChildren: true, childrenCollapsed: true },
      ]}
    />
  ),
}

export const Selected: Story = {
  render: () => (
    <Preview
      activeId="sel"
      rows={[{ session: entry('sel', 'Selected session') }]}
    />
  ),
}

export const Hidden: Story = {
  render: () => (
    <Preview rows={[{ session: entry('hid', 'Hidden session', { isHidden: true }) }]} />
  ),
}

export const Running: Story = {
  render: () => (
    <Preview
      activeId="run"
      rows={[{ session: entry('run', 'Streaming a long turn'), status: 'streaming' }]}
    />
  ),
}

export const Unseen: Story = {
  render: () => (
    <Preview rows={[{ session: entry('done', 'Turn finished while you were away'), unseen: true }]} />
  ),
}

export const PendingPlan: Story = {
  name: 'Pending plan approval',
  render: () => (
    <Preview rows={[{ session: entry('plan', 'Needs a plan review'), pendingPlan: true }]} />
  ),
}

export const LongTitle: Story = {
  render: () => (
    <Preview
      scheduledIds={['long']}
      rows={[{ session: entry('long', 'A very long session title that should marquee on hover instead of wrapping onto a second line') }]}
    />
  ),
}

export const Narrow: Story = {
  render: () => (
    <Preview
      width={180}
      activeId="live"
      scheduledIds={['a', 'b']}
      rows={[
        { session: entry('a', '补齐 session sync zone 全部 §9 未完成项') },
        { session: entry('b', '实现移动端 Live Activity 与推送通知') },
      ]}
    />
  ),
}

export const WithChildren: Story = {
  render: () => (
    <Preview
      rows={[
        { session: entry('parent', 'Collaboration parent'), hasChildren: true, childrenCollapsed: true },
        { session: entry('open', 'Expanded parent'), hasChildren: true, childrenCollapsed: false },
      ]}
    />
  ),
}

export const HoverRevealsPin: Story = {
  name: 'Hover reveals pin (interactive)',
  render: () => (
    <Preview
      scheduledIds={['hover']}
      rows={[{ session: entry('hover', 'Hover this row to reveal pin') }]}
    />
  ),
}
