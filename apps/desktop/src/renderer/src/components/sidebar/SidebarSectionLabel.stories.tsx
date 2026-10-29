import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SidebarSectionLabel } from './SidebarSectionLabel'

const meta = {
  title: 'Sidebar/SidebarSectionLabel',
  component: SidebarSectionLabel,
  args: {
    section: 'pinned',
    count: 2,
    collapsed: false,
    onToggle: () => {},
    children: 'Pinned',
  },
} satisfies Meta<typeof SidebarSectionLabel>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, width = 288 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-sidebar p-2 text-sidebar-foreground" style={{ width }}>
      {children}
    </div>
  )
}

function Rows() {
  return (
    <>
      <div className="truncate px-2.5 py-1.5 text-sm">Review the sidebar</div>
      <div className="truncate px-2.5 py-1.5 text-sm">Draft the release notes for the next build</div>
    </>
  )
}

export const Expanded: Story = {
  render: (args) => (
    <Frame>
      <SidebarSectionLabel {...args} />
      <Rows />
    </Frame>
  ),
}

export const Collapsed: Story = {
  args: { collapsed: true },
  render: (args) => (
    <Frame>
      <SidebarSectionLabel {...args} />
    </Frame>
  ),
}

/** A long title truncates; the count stays on the row. */
export const CollapsedNarrow: Story = {
  args: {
    section: 'drafts',
    count: 12,
    collapsed: true,
    children: 'Drafts with a very long section title',
  },
  render: (args) => (
    <Frame width={160}>
      <SidebarSectionLabel {...args} />
    </Frame>
  ),
}

function TogglePreview() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Frame>
      <SidebarSectionLabel section="pinned" count={2} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)}>
        Pinned
      </SidebarSectionLabel>
      {!collapsed && <Rows />}
    </Frame>
  )
}

export const Toggle: Story = {
  render: () => <TogglePreview />,
}
