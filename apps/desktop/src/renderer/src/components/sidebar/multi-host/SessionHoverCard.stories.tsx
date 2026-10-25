import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionHoverBody, SessionHoverCard, SessionHoverCardTrigger } from './SessionHoverCard'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'

const HOUR = 60 * 60 * 1000

function model(extra?: Partial<SessionHoverModel>): SessionHoverModel {
  return {
    title: 'Fix the sidebar scroll jump',
    projectName: 'super-one',
    environmentLabel: 'dev-server',
    kind: 'cli-node',
    connection: 'connected',
    worktreeName: 'feat/remote-build',
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

/** A detached worktree shows the short commit, the same text as the workdir chip. */
export const Detached: Story = {
  args: { model: model({ worktreeName: 'abc1234', checkoutKind: 'commit' }), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model({ worktreeName: 'abc1234', checkoutKind: 'commit' })} />
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

export const WithoutProject: Story = {
  name: 'No project to name',
  args: { model: model({ projectName: null }), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model({ projectName: null })} />
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
  name: 'Long title clamps to three lines',
  args: { model: model(), children: null },
  render: () => (
    <Frame width={280}>
      <SessionHoverBody
        model={model({
          title: 'Investigate the nightly CI failure that only reproduces on the remote desktop checkout',
          worktreeName: 'feat/very-long-branch-name-that-should-wrap-onto-the-next-line',
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
      <SessionHoverBody
        model={model({ environmentLabel: 'build-box-with-a-very-long-hostname', projectName: 'customer-portal-monorepo-legacy-migration' })}
      />
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
  name: 'Open card beside the session row',
  args: { model: model(), children: null },
  render: () => (
    <div className="w-[240px] bg-sidebar p-2 text-sidebar-foreground">
      <SessionHoverCard model={model()} open>
        <SessionHoverCardTrigger>
          <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]">
            <span className="block min-w-0 flex-1 truncate">Fix the sidebar scroll jump</span>
          </div>
        </SessionHoverCardTrigger>
      </SessionHoverCard>
    </div>
  ),
}
