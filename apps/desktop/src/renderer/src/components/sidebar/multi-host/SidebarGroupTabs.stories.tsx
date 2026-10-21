import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SidebarGroupBy } from '@/lib/multi-host/types'
import { SidebarGroupTabs } from './SidebarGroupTabs'

const meta = {
  title: 'Sidebar/SidebarGroupTabs',
  component: SidebarGroupTabs,
  parameters: { layout: 'centered' },
  args: { value: 'project' as SidebarGroupBy, onChange: () => {} },
} satisfies Meta<typeof SidebarGroupTabs>

export default meta
type Story = StoryObj<typeof meta>

function Demo({ initial = 'project' as SidebarGroupBy, width = 280 }: { initial?: SidebarGroupBy; width?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="bg-sidebar p-2 text-sidebar-foreground" style={{ width }}>
      <SidebarGroupTabs value={value} onChange={setValue} />
    </div>
  )
}

export const ByProject: Story = {
  render: () => <Demo />,
}

export const ByEnvironment: Story = {
  render: () => <Demo initial="environment" />,
}

export const Narrow: Story = {
  render: () => <Demo width={180} />,
}

export const Dark: Story = {
  globals: { theme: 'dark' },
  render: () => <Demo />,
}
