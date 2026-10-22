import type { Meta, StoryObj } from '@storybook/react-vite'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { PinnedSessionRow } from './PinnedSessionRow'

const session: PinnedSessionEntry = {
  sessionId: 'pin-1',
  title: 'Review the sidebar',
  lastActiveAt: '2026-10-09T00:00:00.000Z',
  messageCount: 2,
  folderPath: 'remote:office:/srv/app',
  folderName: 'app',
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
