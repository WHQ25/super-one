import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import { EnvironmentSyncBody, EnvironmentSyncToggle, type IncomingBranchItem } from './CheckoutSourcePanel'
import type { CheckoutSourceOption } from './checkout-sources'

const HEAD = 'a'.repeat(40)

const office: CheckoutSourceOption = {
  id: 'node:office',
  group: 'node',
  label: 'Office',
  hostKind: 'cli-node',
  source: { kind: 'node', connectionId: 'office', folderPath: 'remote:office:/srv/app' },
}

const lab: CheckoutSourceOption = {
  id: 'node:lab',
  group: 'node',
  label: 'Lab',
  hostKind: 'cli-node',
  source: { kind: 'node', connectionId: 'lab', folderPath: 'remote:lab:/srv/app' },
}

function branch(option: CheckoutSourceOption, ref: string, extra: Partial<IncomingBranchItem['branch']> = {}): IncomingBranchItem {
  return {
    option,
    branch: { ref, title: ref, head: HEAD, localName: ref, relation: 'new', ...extra },
  }
}

const officeBranches = [
  branch(office, 'feat/x', { checkedOut: true, dirty: { files: 2, insertions: 14, deletions: 3 } }),
  branch(office, 'fix/sidebar', { relation: 'behind', behind: 2 }),
]

type NoticeReason = 'offline' | 'needs-upgrade'

function Frame({
  open = false,
  width = 320,
  items = [],
  loading = false,
  notices = [],
  initialRef,
  searching = false,
}: {
  open?: boolean
  width?: number
  items?: IncomingBranchItem[]
  loading?: boolean
  notices?: Array<{ id: string; label: string; reason: NoticeReason }>
  initialRef?: string
  /** A search with nothing to sync stays blank. */
  searching?: boolean
}) {
  const { t } = useTranslation()
  const reasonKey = {
    offline: 'chat.git.sourceOffline',
    'needs-upgrade': 'chat.git.sourceNeedsUpgrade',
  } as const
  return (
    <div className="overflow-hidden rounded-lg border bg-popover text-popover-foreground" style={{ width }}>
      <EnvironmentSyncToggle
        open={open}
        sectionId="environment-sync"
        onToggle={() => {}}
      />
      {open && (
        <EnvironmentSyncBody
          sectionId="environment-sync"
          folderPath="/repo"
          items={items}
          loading={loading}
          notices={notices.map((notice) => ({ id: notice.id, text: `${notice.label} · ${t(reasonKey[notice.reason])}` }))}
          emptyLabel={searching ? null : t('chat.git.sourceEmpty')}
          initialRef={initialRef}
          onLanded={() => {}}
        />
      )}
    </div>
  )
}

const meta = {
  title: 'Chat/Environment sync',
  component: Frame,
  args: { open: false },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

/** Section closed. The row is the label and icon, with no environment name. */
export const Collapsed: Story = {}

export const OneEnvironment: Story = {
  args: { open: true, items: officeBranches },
}

/** A new branch keeps the remote name and offers only Create Branch. */
export const Actions: Story = {
  args: {
    open: true,
    items: officeBranches,
    initialRef: 'feat/x',
  },
}

export const Diverged: Story = {
  args: {
    open: true,
    items: [branch(office, 'main', { relation: 'diverged' })],
    initialRef: 'main',
  },
}

/** The other environment is ahead, so this branch can fast-forward. */
export const FastForward: Story = {
  args: {
    open: true,
    items: [branch(office, 'fix/sidebar', { relation: 'behind', behind: 2 })],
    initialRef: 'fix/sidebar',
  },
}

/** This branch is ahead, so their branch can catch up. */
export const CatchUp: Story = {
  args: {
    open: true,
    items: [branch(office, 'old', { relation: 'ahead', ahead: 3 })],
    initialRef: 'old',
  },
}

export const SeveralEnvironments: Story = {
  args: {
    open: true,
    items: [
      ...officeBranches,
      branch(lab, 'feat/lab', { relation: 'ahead', ahead: 4 }),
    ],
    notices: [{ id: 'node:home', label: 'Home', reason: 'offline' }],
  },
}

export const Loading: Story = { args: { open: true, loading: true, items: [] } }

export const Empty: Story = { args: { open: true, items: [] } }

/** Searching with nothing to sync shows the row and no empty sentence. */
export const SearchEmpty: Story = { args: { open: true, searching: true, items: [] } }

export const LongNames: Story = {
  args: {
    open: true,
    items: [branch(
      { ...office, label: 'a-very-long-environment-name-that-should-truncate' },
      'feature/a-very-long-branch-name-that-should-truncate-in-the-row',
    )],
  },
}

export const Narrow: Story = { args: { open: true, width: 180, items: officeBranches } }

export const Dark: Story = {
  args: { open: true, items: officeBranches },
  globals: { theme: 'dark' },
}
