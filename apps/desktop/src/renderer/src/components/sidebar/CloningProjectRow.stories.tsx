import type { Meta, StoryObj } from '@storybook/react-vite'
import { CloningProjectRow } from './CloningProjectRow'

const meta = {
  title: 'Sidebar/Cloning Project Row',
  component: CloningProjectRow,
  args: {
    name: 'super-one',
    progress: 42,
  },
  decorators: [
    (Story) => (
      <div className="w-64 rounded-md border bg-sidebar p-2 text-sidebar-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CloningProjectRow>
export default meta
type Story = StoryObj<typeof meta>

export const Indeterminate: Story = {
  args: { progress: null },
}

export const Receiving: Story = {
  args: { progress: 42 },
}

export const LongNameNarrow: Story = {
  args: {
    name: 'very-long-organization-monorepo-project-name',
    progress: 88,
  },
  decorators: [
    (Story) => (
      <div className="w-44 rounded-md border bg-sidebar p-2 text-sidebar-foreground">
        <Story />
      </div>
    ),
  ],
}
