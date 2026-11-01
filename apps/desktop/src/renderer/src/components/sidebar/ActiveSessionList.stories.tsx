import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { ActiveSessionList } from './ActiveSessionList'
import { SessionRow } from './SessionRow'

const FOLDER = '/storybook/super-one'

const callbacks = {
  onSwitchSession: () => {},
  onPinSession: () => {},
  onSettleSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
}

function entry(sessionId: string, title: string): SessionHistoryEntry {
  return {
    sessionId,
    title,
    lastActiveAt: '2026-10-09T00:00:00.000Z',
    messageCount: 2,
    provider: 'claude',
  }
}

function Frame({ children, width = 288 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-sidebar text-sidebar-foreground" style={{ width }} data-sidebar-inner>
      {children}
    </div>
  )
}

function Rows({ sessions }: { sessions: SessionHistoryEntry[] }) {
  return sessions.map((session) => (
    <SessionRow key={session.sessionId} session={session} folderPath={FOLDER} {...callbacks} />
  ))
}

const shortList = [entry('live-1', 'Fix the sidebar scroll')]

const meta = {
  title: 'Sidebar/ActiveSessionList',
  component: ActiveSessionList,
  args: { children: null },
} satisfies Meta<typeof ActiveSessionList>

export default meta
type Story = StoryObj<typeof meta>

/** A handful of sessions stays at content height. Nothing asks for another page. */
export const Short: Story = {
  render: () => (
    <Frame>
      <ActiveSessionList>
        <Rows sessions={shortList} />
      </ActiveSessionList>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Fix the sidebar scroll')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Show More' })).toBeNull()
  },
}

/** A full page scrolls inside the project. The next page loads from that scroll, with no Show more button. */
export const ScrollForMore: Story = {
  render: () => (
    <Frame>
      <ActiveSessionList hasMore onLoadMore={() => {}}>
        <Rows sessions={Array.from({ length: 16 }, (_, index) => entry(`live-${index}`, `Active session ${index}`))} />
      </ActiveSessionList>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Active session 0')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Show More' })).toBeNull()
    const list = canvasElement.querySelector('[data-active-session-list]')
    const viewport = list?.querySelector('[data-slot="scroll-area-viewport"]')
    await expect(list).not.toBeNull()
    await expect(list).toHaveClass('max-h-64')
    await expect(viewport).toHaveClass('scroll-edge-fade-y')
  },
}

/** Children under one parent scroll in their own list, shorter than the active list. */
export const ChildScroll: Story = {
  render: () => (
    <Frame>
      <ActiveSessionList kind="child" hasMore onLoadMore={() => {}}>
        <Rows sessions={Array.from({ length: 12 }, (_, index) => entry(`child-${index}`, `Child session ${index}`))} />
      </ActiveSessionList>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Child session 0')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Show More' })).toBeNull()
    const list = canvasElement.querySelector('[data-child-session-list]')
    await expect(list).not.toBeNull()
    await expect(list).toHaveClass('max-h-36')
    await expect(canvasElement.querySelector('[data-active-session-list]')).toBeNull()
  },
}

/** More rows than the viewport. Only the window is mounted; the tail stays out of the document. */
export const VirtualWindow: Story = {
  render: () => (
    <Frame>
      <ActiveSessionList>
        {Array.from({ length: 40 }, (_, index) => (
          <SessionRow key={`live-${index}`} session={entry(`live-${index}`, `Active session ${index}`)} folderPath={FOLDER} {...callbacks} />
        ))}
      </ActiveSessionList>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Active session 0')).toBeInTheDocument()
    await expect(canvas.queryByText('Active session 39')).toBeNull()
    const list = canvasElement.querySelector('[data-active-session-list]')
    await expect(list).toHaveClass('max-h-64')
  },
}

/**
 * One expanded parent. Children are direct rows, paged by scroll, and only the
 * window is mounted. The tail stays out of the document.
 */
export const NestedChildren: Story = {
  render: () => (
    <Frame>
      <ActiveSessionList>
        <div>
          <SessionRow session={entry('parent', 'Parent session')} folderPath={FOLDER} hasChildren {...callbacks} />
          <ActiveSessionList kind="child" hasMore onLoadMore={() => {}}>
            {Array.from({ length: 40 }, (_, index) => (
              <SessionRow
                key={`child-${index}`}
                session={entry(`child-${index}`, `Child session ${index}`)}
                folderPath={FOLDER}
                childSession
                {...callbacks}
              />
            ))}
          </ActiveSessionList>
        </div>
        <SessionRow session={entry('next', 'Next root session')} folderPath={FOLDER} {...callbacks} />
      </ActiveSessionList>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Parent session')).toBeInTheDocument()
    await expect(canvas.getByText('Child session 0')).toBeInTheDocument()
    await expect(canvas.queryByText('Child session 39')).toBeNull()
    const list = canvasElement.querySelector('[data-child-session-list]')
    await expect(list).not.toBeNull()
    await expect(list).toHaveClass('max-h-36')
    await expect(canvasElement.querySelector('[data-active-session-list]')).toHaveClass('max-h-64')
  },
}

export const LongTitle: Story = {
  render: () => (
    <Frame>
      <ActiveSessionList>
        <Rows sessions={[entry('live-long', 'Keep paging the active list after the release notes, the migration, and the follow-up review')]} />
      </ActiveSessionList>
    </Frame>
  ),
}

export const Narrow: Story = {
  render: () => (
    <Frame width={160}>
      <ActiveSessionList hasMore>
        <Rows sessions={[entry('live-narrow', 'A long active session title in a narrow sidebar')]} />
      </ActiveSessionList>
    </Frame>
  ),
}
