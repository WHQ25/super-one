import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { PinnedSessionRow } from './PinnedSessionRow'

const session: PinnedSessionEntry = {
  sessionId: 'pin-1',
  title: 'Review the sidebar',
  lastActiveAt: '2026-10-09T00:00:00.000Z',
  messageCount: 2,
  provider: 'claude',
  folderPath: 'remote:office:/srv/app',
  folderName: 'app',
}

const hover: SessionHoverModel = {
  title: 'Review the sidebar',
  projectName: 'app',
  environmentLabel: 'This Mac',
  kind: 'local',
  connection: 'connected',
  worktreeName: null,
  lastActiveAt: '2026-10-09T00:00:00.000Z',
  tags: ['review'],
}

const callbacks = {
  onSwitchSession: () => {},
  onPinSession: () => {},
  onHideSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
}

const meta = {
  title: 'Sidebar/PinnedSessionRow',
  component: PinnedSessionRow,
  args: {
    session,
    isActive: false,
    status: 'idle',
    isUnseen: false,
    hover,
    ...callbacks,
  },
} satisfies Meta<typeof PinnedSessionRow>

export default meta
type Story = StoryObj<typeof meta>

export const Online: Story = {
  render: (args) => (
    <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
      <PinnedSessionRow {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement.querySelector('.animated-title-wrap')).toHaveClass('text-sm')
    await expect(canvas.queryByText('app')).toBeNull()
    await expect(canvasElement.querySelector('[data-slot="hover-card-trigger"]')).toBeTruthy()
    const icon = canvasElement.querySelector('.session-icon-ground')
    await expect(icon?.getBoundingClientRect().width ?? 0).toBeGreaterThan(14)
    await userEvent.hover(canvas.getByText('Review the sidebar'))
    await expect(await within(document.body).findByText('review')).toBeInTheDocument()
  },
}

/** Single-host rows have no hover card, so the project name stays on the row. */
export const WithoutHoverCard: Story = {
  args: { hover: null },
  render: (args) => (
    <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
      <PinnedSessionRow {...args} />
    </div>
  ),
}

export const Active: Story = {
  args: { isActive: true },
  render: (args) => (
    <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
      <PinnedSessionRow {...args} />
    </div>
  ),
}

export const LongTitle: Story = {
  args: {
    session: {
      ...session,
      title: 'Investigate the nightly failure that only reproduces on the remote desktop checkout after the catalog refresh',
    },
  },
  render: (args) => (
    <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
      <PinnedSessionRow {...args} />
    </div>
  ),
}

/** Dimmed, with the disconnected icon, when the session's node is offline. */
export const Offline: Story = {
  args: { environmentOffline: true },
  render: (args) => (
    <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
      <PinnedSessionRow {...args} />
    </div>
  ),
}
