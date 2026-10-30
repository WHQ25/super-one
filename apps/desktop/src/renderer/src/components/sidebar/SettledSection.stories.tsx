import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { PROJECT_SETTLED_COLLAPSE_KEY, settledPanelId } from './sidebar-section-collapse'
import { SettledSection, type SettledSectionProps } from './SettledSection'

const FOLDER = '/storybook/super-one'

const callbacks = {
  onSwitchSession: () => {},
  onPinSession: () => {},
  onSettleSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
}

function entry(sessionId: string, title: string): PinnedSessionEntry {
  return {
    sessionId,
    title,
    lastActiveAt: '2026-10-09T00:00:00.000Z',
    messageCount: 2,
    provider: 'claude',
    isSettled: true,
    folderPath: FOLDER,
    folderName: 'super-one',
  }
}

const base: Omit<SettledSectionProps, 'sessions'> = {
  folderPath: FOLDER,
  ...callbacks,
}

function rememberOpen() {
  localStorage.setItem(PROJECT_SETTLED_COLLAPSE_KEY, JSON.stringify({ [FOLDER]: false }))
}

function Frame({ children, width = 288 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-sidebar text-sidebar-foreground" style={{ width }} data-sidebar-inner>
      {children}
    </div>
  )
}

const meta = {
  title: 'Sidebar/SettledSection',
  component: SettledSection,
  args: { ...base, sessions: [entry('set-1', 'Finished the sidebar pass')] },
} satisfies Meta<typeof SettledSection>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {
  render: (args) => {
    localStorage.removeItem(PROJECT_SETTLED_COLLAPSE_KEY)
    return (
      <Frame>
        <SettledSection {...args} />
      </Frame>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByRole('button', { name: /Settled/ })
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(header.querySelector('[data-slot="section-count"]')).toHaveTextContent('1')
    await expect(canvasElement.querySelector('[data-slot="settled-divider"]')).toBeNull()
    const panel = canvasElement.querySelector(`[id="${settledPanelId(FOLDER)}"]`)
    await expect(panel).toHaveAttribute('inert')
    await expect(panel?.textContent).toContain('Finished the sidebar pass')
  },
}

/** The folded badge is the project's settled count, including pages still off screen. */
export const TotalCount: Story = {
  name: 'Folded count is the project total',
  args: { count: 48 },
  render: (args) => {
    localStorage.removeItem(PROJECT_SETTLED_COLLAPSE_KEY)
    return (
      <Frame>
        <SettledSection {...args} />
      </Frame>
    )
  },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByRole('button', { name: /Settled/ })
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    const count = header.querySelector('[data-slot="section-count"]')
    await expect(count).toHaveTextContent('48')
    await expect(count).not.toHaveClass('rounded-full')
    await expect(within(canvasElement).getAllByText(/Finished|Settled/).length).toBeGreaterThan(0)
  },
}

export const Expanded: Story = {
  render: (args) => {
    rememberOpen()
    return (
      <Frame>
        <SettledSection {...args} />
      </Frame>
    )
  },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByRole('button', { name: /Settled/ })
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(header.querySelector('[data-slot="section-count"]')).toBeNull()
    const divider = canvasElement.querySelector('[data-slot="settled-divider"]')
    await expect(divider).toHaveClass('bg-sidebar-hover')
    await expect(header).toContainElement(divider)
  },
}

export const Empty: Story = {
  args: { sessions: [] },
  render: (args) => (
    <Frame>
      <SettledSection {...args} />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /Settled/ })).toBeNull()
  },
}

export const LongTitle: Story = {
  args: {
    sessions: [entry('set-long', 'Settled after the release notes, the migration, and the follow-up review were all done')],
  },
  render: (args) => {
    rememberOpen()
    return (
      <Frame>
        <SettledSection {...args} />
      </Frame>
    )
  },
}

export const Narrow: Story = {
  args: {
    sessions: [entry('set-narrow', 'A settled session with a long title in a narrow sidebar')],
  },
  render: (args) => {
    rememberOpen()
    return (
      <Frame width={160}>
        <SettledSection {...args} />
      </Frame>
    )
  },
}

/** A full page scrolls inside the group. The next page loads from that scroll, with no Show more button. */
export const ScrollForMore: Story = {
  args: {
    hasMore: true,
    sessions: Array.from({ length: 12 }, (_, index) => entry(`set-${index}`, `Settled session ${index}`)),
  },
  render: (args) => {
    rememberOpen()
    return (
      <Frame>
        <SettledSection {...args} />
      </Frame>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Settled session 0')).toBeInTheDocument()
    await expect(canvas.getByText('Settled session 11')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Show More' })).toBeNull()
    await expect(canvasElement.querySelector('[data-settled-list]')).not.toBeNull()
  },
}

export const Dark: Story = {
  globals: { theme: 'dark' },
  render: (args) => {
    rememberOpen()
    return (
      <Frame>
        <SettledSection {...args} />
      </Frame>
    )
  },
}
