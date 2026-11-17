import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { StorageActionResult, StorageInventory } from '@superone/shared/desktop-storage'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { StorageSettingsPage } from './StorageSettingsPage'
import { seedWorktreeStorage } from './WorktreeStorageSection.stories'

const GB = 1024 ** 3
const MB = 1024 ** 2
const ROOT = '/Users/dev/Library/Application Support/SuperOne'

export const storageInventoryFixture: StorageInventory = {
  nodeEvents: {
    rows: 1_420_000,
    retentionFloor: '900000',
    lastCompactAt: Date.parse('2026-11-01T08:00:00Z'),
    lastFreedBytes: 400 * MB,
  },
  categories: [
    { id: 'chat-database', bytes: 5 * GB + 360 * MB, path: `${ROOT}/superone.db`, actions: ['reveal'] },
    {
      id: 'backup',
      bytes: 11 * GB + 800 * MB,
      unusedBytes: 800 * MB,
      path: `${ROOT}/backups`,
      count: 2,
      actions: ['reveal', 'delete-backups'],
    },
    { id: 'recovery-leftovers', bytes: 20 * MB, path: `${ROOT}/superone.corrupt-20261001.db`, count: 1, actions: ['reveal', 'delete-leftovers'] },
    { id: 'browser-http-cache', bytes: 823 * MB, path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-http-cache', 'reveal'] },
    { id: 'browser-code-cache', bytes: 337 * MB, path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-code-cache', 'reveal'] },
    { id: 'browser-site-data', bytes: Math.round(3.6 * GB), path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-site-data', 'reveal'] },
    { id: 'node-event-log', bytes: Math.round(2.5 * GB), path: `${ROOT}/node-host/node.db`, actions: ['compact-node-events', 'reveal'] },
    { id: 'sync-attachments', bytes: Math.round(1.3 * GB), path: `${ROOT}/sync`, actions: ['clear-sync-attachments', 'reveal'] },
    { id: 'sync-media', bytes: 360 * MB, path: `${ROOT}/sync`, actions: ['clear-sync-media', 'reveal'] },
    { id: 'app-cache', bytes: 820 * MB, path: `${ROOT}/Cache`, actions: ['clear-app-cache', 'reveal'] },
    { id: 'harness-runtimes', bytes: 900 * MB + 528 * 1024, unusedBytes: 200 * MB + 528 * 1024, path: '/Users/dev/.superone/harness', actions: ['reveal', 'clear-unused-harness-runtimes'] },
    { id: 'logs', bytes: 12 * MB, path: `${ROOT}/logs`, actions: ['clear-logs', 'reveal'] },
  ],
  harnessRuntimes: [
    { id: 'claude', bytes: 570 * MB, unusedBytes: 0, path: '/Users/dev/.superone/harness/claude' },
    { id: 'acp-antigravity', bytes: 528 * 1024, unusedBytes: 528 * 1024, path: '/Users/dev/.superone/harness/acp-antigravity' },
    { id: 'codex', bytes: 330 * MB, unusedBytes: 200 * MB, path: '/Users/dev/.superone/harness/codex' },
  ],
}

const emptyInventory: StorageInventory = {
  nodeEvents: { rows: 0, retentionFloor: '0', lastCompactAt: null, lastFreedBytes: null },
  categories: [
    { id: 'chat-database', bytes: 0, actions: [] },
    { id: 'browser-http-cache', bytes: 0, actions: ['clear-browser-http-cache'] },
    { id: 'browser-code-cache', bytes: 0, actions: ['clear-browser-code-cache'] },
    { id: 'browser-site-data', bytes: 0, actions: ['clear-browser-site-data'] },
    { id: 'node-event-log', bytes: 0, actions: ['compact-node-events'] },
    { id: 'sync-attachments', bytes: 0, actions: ['clear-sync-attachments'] },
    { id: 'sync-media', bytes: 0, actions: ['clear-sync-media'] },
    { id: 'app-cache', bytes: 0, actions: ['clear-app-cache'] },
    { id: 'logs', bytes: 0, actions: ['clear-logs'] },
  ],
}

const longPathInventory: StorageInventory = {
  ...storageInventoryFixture,
  categories: storageInventoryFixture.categories.map((category) => category.id === 'chat-database'
    ? { ...category, path: `${ROOT}/very-long-application-support-directory-name-that-must-truncate/SuperOne/superone.db` }
    : category),
}

type SeedOptions = {
  mode?: 'ready' | 'loading' | 'error'
  actionDelay?: number
  result?: StorageActionResult
}

let inventory = storageInventoryFixture
let mode: SeedOptions['mode'] = 'ready'
let actionDelay = 0
let reads = 0
const compacted: StorageActionResult = {
  action: 'compact-node-events',
  removedBytes: 400 * MB,
  compact: { removedRows: 560_000, freedBytes: 400 * MB, floor: '1400000', vacuum: 'done' },
}
let result: StorageActionResult = compacted

mockIpc('app', 'getStorageInventory', async () => {
  reads += 1
  if (mode === 'loading') await new Promise(() => {})
  if (mode === 'error' && reads === 1) throw new Error('EACCES')
  return inventory
})
mockIpc('app', 'applyStorageAction', async (action: unknown) => {
  await new Promise((resolve) => setTimeout(resolve, actionDelay))
  return { ...result, action }
})
mockIpc('app', 'revealFile', async () => undefined)

function seed(next: StorageInventory, options: SeedOptions = {}) {
  return (Story: () => ReactElement) => {
    inventory = next
    mode = options.mode ?? 'ready'
    actionDelay = options.actionDelay ?? 0
    reads = 0
    result = options.result ?? compacted
    // The page embeds the worktree section, whose mock keeps the last story's state.
    seedWorktreeStorage()
    return <Story />
  }
}

const meta: Meta<typeof StorageSettingsPage> = {
  title: 'Settings/Storage',
  component: StorageSettingsPage,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof StorageSettingsPage>

/** A machine that has been upgraded and used: the bar is the mix, and Optimize is the safe pass. */
export const Ready: Story = { decorators: [seed(storageInventoryFixture)] }

/** One click clears caches and extra chat backups, then compacts. The restore point and site logins stay. */
export const Optimize: Story = {
  decorators: [seed(storageInventoryFixture)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('storage-summary')
    await userEvent.click(canvas.getByTestId('storage-optimize'))
    await expect(canvas.findByTestId('storage-notice')).resolves.toHaveTextContent(/Freed|已释放/)
  },
}

/** Nothing stored yet. Optional rows stay hidden, and every clear is disabled. */
export const Empty: Story = { decorators: [seed(emptyInventory)] }

/** The inventory read has not returned. */
export const Loading: Story = { decorators: [seed(storageInventoryFixture, { mode: 'loading' })] }

/** The folders could not be measured. */
export const Unreadable: Story = { decorators: [seed(storageInventoryFixture, { mode: 'error' })] }

/** Retry after a failed read loads the same inventory. */
export const RetryAfterError: Story = {
  decorators: [seed(storageInventoryFixture, { mode: 'error' })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('storage-error')
    await userEvent.click(canvas.getByRole('button', { name: /retry|重试/i }))
    await expect(canvas.findByTestId('storage-chat-database')).resolves.toBeInTheDocument()
  },
}

/** Deleting chat backups asks first. Confirm is the only path that applies the action. */
export const ConfirmBackupDelete: Story = {
  decorators: [seed(storageInventoryFixture)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await canvas.findByTestId('storage-backup')
    await userEvent.click(within(canvas.getByTestId('storage-backup')).getByRole('button', { name: /delete|删除/i }))
    await expect(body.findByRole('dialog')).resolves.toHaveTextContent(/restore point|恢复点/)
    await userEvent.click(body.getByTestId('storage-confirm'))
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/** Compact reports how many events went and that the file itself shrank. */
export const Compacted: Story = {
  decorators: [seed(storageInventoryFixture)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('storage-node-event-log')
    await userEvent.click(within(canvas.getByTestId('storage-node-event-log')).getByRole('button', { name: /^compact$|^压缩$/i }))
    await expect(canvas.findByTestId('storage-notice')).resolves.toHaveTextContent(/560000|560,000/)
  },
}

/** The rewrite needs about 1.1× the file in free space. Without it, the rows are gone and the file is not. */
export const VacuumSkipped: Story = {
  decorators: [seed(storageInventoryFixture, {
    result: {
      action: 'compact-node-events',
      removedBytes: 400 * MB,
      compact: { removedRows: 560_000, freedBytes: 400 * MB, floor: '1400000', vacuum: 'skipped' },
    },
  })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('storage-node-event-log')
    await userEvent.click(within(canvas.getByTestId('storage-node-event-log')).getByRole('button', { name: /^compact$|^压缩$/i }))
    await expect(canvas.findByTestId('storage-notice')).resolves.toHaveTextContent(/free disk space|剩余空间/)
  },
}

/** The button stays on Compacting until the rewrite returns. */
export const Compacting: Story = {
  decorators: [seed(storageInventoryFixture, { actionDelay: 60_000 })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('storage-node-event-log')
    await userEvent.click(within(canvas.getByTestId('storage-node-event-log')).getByRole('button', { name: /^compact$|^压缩$/i }))
    await expect(within(canvas.getByTestId('storage-node-event-log')).findByRole('button', { name: /compacting|压缩中/i })).resolves.toBeDisabled()
  },
}

/** Settings pane at the narrow width: actions stay on the row, the path truncates under it. */
export const Narrow: Story = {
  decorators: [
    seed(storageInventoryFixture),
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
}

/** Paths stay off the page. A long database path does not widen the card. */
export const LongPath: Story = { decorators: [seed(longPathInventory)] }

export const Dark: Story = { decorators: [seed(storageInventoryFixture)], globals: { theme: 'dark' } }

export const Chinese: Story = { decorators: [seed(storageInventoryFixture)], globals: { locale: 'zh' } }
