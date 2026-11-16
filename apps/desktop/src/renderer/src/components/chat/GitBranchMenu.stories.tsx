import type { Meta, StoryObj } from '@storybook/react-vite'
import { GitBranchMenu, type GitBranchMenuProps } from './GitBranchMenu'
import { CheckoutSourceFooter, RelationPill } from './CheckoutSourcePanel'
import type { CheckoutSourceOption } from './checkout-sources'

const SOURCES: CheckoutSourceOption[] = [
  { id: 'node:office', group: 'node', label: 'office', hostKind: 'cli-node', source: { kind: 'node', connectionId: 'office', folderPath: 'remote:office:/srv/app' } },
  { id: 'remote:origin', group: 'remote', label: 'origin', detail: 'github.com/acme/app', source: { kind: 'remote', remote: 'origin' } },
  { id: 'pr', group: 'pr', label: 'Pull Requests', disabled: 'gh-unavailable', source: { kind: 'pr' } },
]

const local = ['main', 'feat/login']

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
    onSelect: () => {},
    onCreate: () => {},
  },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const Branches: Story = {}

export const Loading: Story = {
  args: { loading: true, current: null, local: [] },
}

export const Empty: Story = {
  args: { current: null, local: [] },
}

export const LongNames: Story = {
  args: {
    current: 'feature/a-very-long-branch-name-that-should-truncate-in-the-row',
    local: ['feature/a-very-long-branch-name-that-should-truncate-in-the-row', 'main'],
    currentDetail: 'uncommitted: 12 files +400 -20',
  },
}

export const Narrow: Story = { args: { width: 180 } }

export const Dark: Story = { globals: { theme: 'dark' } }

/** Branches checked out from a source carry its badge; the footer opens a source. */
export const WithSources: Story = {
  args: {
    local: ['main', 'feat/remote-checkout', 'fix/sidebar-hover', 'pr/479-sidebar-hover'],
    badge: (branch: string) => branch === 'feat/remote-checkout'
      ? <button type="button" aria-label="Sync from office"><RelationPill relation="behind" behind={3}><span>office</span></RelationPill></button>
      : branch === 'fix/sidebar-hover'
        ? <button type="button"><RelationPill relation="diverged"><span>origin</span></RelationPill></button>
        : branch === 'pr/479-sidebar-hover'
          ? <span className="rounded-full border px-1.5 text-[11px] text-muted-foreground">#479</span>
          : null,
    footer: <CheckoutSourceFooter options={SOURCES} selected={SOURCES[0]!} onOpen={() => {}} />,
  },
}

