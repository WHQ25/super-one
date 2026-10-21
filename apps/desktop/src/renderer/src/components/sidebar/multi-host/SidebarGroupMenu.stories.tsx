import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SidebarGroupBy } from '@/lib/multi-host/types'
import { SidebarGroupMenu } from './SidebarGroupMenu'

const meta = {
  title: 'Sidebar/SidebarGroupMenu',
  component: SidebarGroupMenu,
  parameters: { layout: 'centered' },
  args: { value: 'project' as SidebarGroupBy, onChange: () => {} },
} satisfies Meta<typeof SidebarGroupMenu>

export default meta
type Story = StoryObj<typeof meta>

function Demo({ initial = 'project' as SidebarGroupBy, width = 280 }: { initial?: SidebarGroupBy; width?: number }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  return (
    <div className="flex items-center bg-sidebar p-2 text-sidebar-foreground" style={{ width }}>
      <span className="truncate px-1.5 py-0.5 text-sm font-medium text-sidebar-foreground/70">{t('sidebar.projects')}</span>
      <SidebarGroupMenu value={value} onChange={setValue} open />
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
