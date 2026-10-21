import type { Meta, StoryObj } from '@storybook/react-vite'
import { GitBranchMenu, type GitBranchMenuProps } from './GitBranchMenu'

const local = ['main', 'feat/login']
const tracking = ['origin/main', 'origin/feat/login', 'origin/release/2026']

function Frame({ width = 288, ...props }: GitBranchMenuProps & { width?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-popover text-popover-foreground" style={{ width }}>
      <GitBranchMenu {...props} />
    </div>
  )
}

const meta = {
  title: 'Chat/GitBranchMenu',
  component: Frame,
  args: {
    current: 'main',
    local,
    tracking,
    environmentLabel: 'This PC',
    onSelect: () => {},
    onSelectTracking: () => {},
    onCreate: () => {},
    onFetch: () => {},
  },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const Branches: Story = {}

export const Fetching: Story = { args: { fetching: true } }

export const FetchError: Story = {
  args: { fetchError: 'Office did not answer.' },
}

export const Loading: Story = {
  args: { loading: true, current: null, local: [], tracking: [] },
}

export const Empty: Story = {
  args: { current: null, local: [], tracking: [] },
}

export const LongNames: Story = {
  args: {
    current: 'feature/a-very-long-branch-name-that-should-truncate-in-the-row',
    local: ['feature/a-very-long-branch-name-that-should-truncate-in-the-row', 'main'],
    tracking: ['origin/feature/a-very-long-branch-name-that-should-truncate-in-the-row'],
    currentDetail: 'uncommitted: 12 files +400 -20',
  },
}

export const Narrow: Story = { args: { width: 180 } }

export const Dark: Story = { globals: { theme: 'dark' } }
