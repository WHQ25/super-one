import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionHoverBody, SessionHoverCard } from './SessionHoverCard'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'

const HOUR = 60 * 60 * 1000

function model(extra?: Partial<SessionHoverModel>): SessionHoverModel {
  return {
    title: 'Fix the sidebar scroll jump',
    environmentLabel: 'dev-server',
    kind: 'cli-node',
    connection: 'connected',
    worktreeName: 'feat-remote-build',
    lastActiveAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    tags: ['sidebar'],
    ...extra,
  }
}

const meta = {
  title: 'Sidebar/SessionHoverCard',
  component: SessionHoverCard,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SessionHoverCard>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, width = 320 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-popover p-3 text-popover-foreground" style={{ width }}>
      {children}
    </div>
  )
}

export const Worktree: Story = {
  args: { model: model(), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model()} />
    </Frame>
  ),
}

export const Checkout: Story = {
  name: 'Checkout, no tags, active under a minute ago',
  args: { model: model(), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody
        model={model({ kind: 'local', environmentLabel: 'This Mac', worktreeName: null, tags: [], lastActiveAt: new Date().toISOString() })}
      />
    </Frame>
  ),
}

export const Offline: Story = {
  args: { model: model({ connection: 'offline' }), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model({ connection: 'offline', kind: 'remote-desktop', environmentLabel: 'MacBook-B' })} />
    </Frame>
  ),
}

export const UnknownActivity: Story = {
  name: 'Missing activity time',
  args: { model: model(), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model({ lastActiveAt: '' })} />
    </Frame>
  ),
}

export const LongContent: Story = {
  args: { model: model(), children: null },
  render: () => (
    <Frame width={280}>
      <SessionHoverBody
        model={model({
          title: 'Investigate the nightly CI failure that only reproduces on the remote desktop checkout',
          worktreeName: 'tn9p6x-a68eb49-feat-very-long-branch-name-that-should-wrap',
          tags: ['mobile', 'sidebar', 'release', 'investigation'],
          lastActiveAt: new Date(Date.now() - 40 * 24 * HOUR).toISOString(),
        })}
      />
    </Frame>
  ),
}

export const Narrow: Story = {
  args: { model: model(), children: null },
  render: () => (
    <Frame width={220}>
      <SessionHoverBody model={model({ environmentLabel: 'build-box-with-a-very-long-hostname' })} />
    </Frame>
  ),
}

export const Dark: Story = {
  args: { model: model(), children: null },
  globals: { theme: 'dark' },
  render: () => (
    <Frame>
      <SessionHoverBody model={model({ tags: ['mobile', 'sidebar'] })} />
    </Frame>
  ),
}

export const PinnedOpen: Story = {
  name: 'Open card on the session title',
  args: { model: model(), children: null },
  render: () => (
    <div className="w-[240px] bg-sidebar p-2 text-sidebar-foreground">
      <SessionHoverCard model={model()} open>
        <span className="block truncate text-[13px]">Fix the sidebar scroll jump</span>
      </SessionHoverCard>
    </div>
  ),
}
