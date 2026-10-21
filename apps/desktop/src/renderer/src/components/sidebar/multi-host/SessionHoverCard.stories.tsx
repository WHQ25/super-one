import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionHoverBody, SessionHoverCard } from './SessionHoverCard'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'

function model(extra?: Partial<SessionHoverModel>): SessionHoverModel {
  return {
    title: 'Fix the sidebar scroll jump',
    environmentLabel: 'dev-server',
    kind: 'cli-node',
    connection: 'connected',
    locationKind: 'worktree',
    locationPath: '/srv/super-one/.worktrees/feat-remote-build',
    branch: 'feat/remote-build',
    provider: 'codex',
    acpAgentId: null,
    lastActiveAt: '2026-10-22T08:00:00.000Z',
    parentTitle: null,
    childCount: 0,
    startedFrom: null,
    tags: [],
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
    <div className="bg-popover text-popover-foreground" style={{ width }}>
      {children}
    </div>
  )
}

export const Connected: Story = {
  args: { model: model(), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model()} liveStatus="running" />
    </Frame>
  ),
}

export const Offline: Story = {
  args: { model: model({ connection: 'offline' }), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody model={model({ connection: 'offline', kind: 'remote-desktop', environmentLabel: 'MacBook-B' })} liveStatus="idle" />
    </Frame>
  ),
}

export const Empty: Story = {
  name: 'Empty branch, tags and relations',
  args: { model: model(), children: null },
  render: () => (
    <Frame>
      <SessionHoverBody
        model={model({
          branch: null,
          locationKind: 'checkout',
          locationPath: '/Users/me/notes',
          provider: null,
          parentTitle: null,
          startedFrom: null,
          tags: [],
          lastActiveAt: '',
        })}
      />
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
          locationPath: '/Users/very-long-name/Developer/Projects/super-one/.worktrees/super-one/tn9p6x-a68eb49-extra',
          branch: 'feat/very-long-branch-name-that-should-wrap',
          parentTitle: 'Parent session with a long title that should wrap inside the card',
          childCount: 3,
          startedFrom: 'This Mac',
          tags: ['mobile', 'sidebar', 'release', 'investigation'],
          connection: 'needs-upgrade',
        })}
        liveStatus="background"
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
      <SessionHoverBody model={model({ tags: ['mobile'], startedFrom: 'This Mac' })} liveStatus="unseen" />
    </Frame>
  ),
}

export const PinnedOpen: Story = {
  name: 'Open card on the session title',
  args: { model: model(), children: null },
  render: () => (
    <div className="w-[240px] bg-sidebar p-2 text-sidebar-foreground">
      <SessionHoverCard model={model()} liveStatus="streaming" open>
        <span className="block truncate text-[13px]">Fix the sidebar scroll jump</span>
      </SessionHoverCard>
    </div>
  ),
}
