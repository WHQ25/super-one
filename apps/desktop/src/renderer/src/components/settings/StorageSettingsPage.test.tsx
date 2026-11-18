/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageActionResult, StorageInventory } from '@superone/shared/desktop-storage'
import { StorageSettingsPage } from './StorageSettingsPage'

const GB = 1024 ** 3
const MB = 1024 ** 2
const ROOT = '/Users/dev/Library/Application Support/SuperOne'

const full: StorageInventory = {
  nodeEvents: {
    rows: 1420,
    retentionFloor: '900',
    lastCompactAt: Date.parse('2026-11-01T08:00:00Z'),
    lastFreedBytes: 40 * MB,
  },
  categories: [
    { id: 'chat-database', bytes: 5 * GB + 360 * MB, path: `${ROOT}/superone.db`, actions: ['reveal'] },
    { id: 'backup', bytes: 11 * GB + 800 * MB, unusedBytes: 800 * MB, path: `${ROOT}/backups`, count: 2, actions: ['reveal', 'delete-backups'] },
    { id: 'browser-http-cache', bytes: 823 * MB, path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-http-cache', 'reveal'] },
    { id: 'browser-code-cache', bytes: 337 * MB, path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-code-cache', 'reveal'] },
    { id: 'browser-site-data', bytes: 3 * GB, path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-site-data', 'reveal'] },
    { id: 'node-event-log', bytes: 2 * GB, path: `${ROOT}/node-host/node.db`, actions: ['compact-node-events', 'reveal'] },
    { id: 'sync-attachments', bytes: 1 * GB, path: `${ROOT}/sync`, actions: ['clear-sync-attachments', 'reveal'] },
    { id: 'sync-media', bytes: 360 * MB, path: `${ROOT}/sync`, actions: ['clear-sync-media', 'reveal'] },
    { id: 'app-cache', bytes: 820 * MB, path: `${ROOT}/Cache`, actions: ['clear-app-cache', 'reveal'] },
    { id: 'harness-runtimes', bytes: 900 * MB, unusedBytes: 200 * MB, path: '/Users/dev/.superone/harness', actions: ['reveal', 'clear-unused-harness-runtimes'] },
    { id: 'logs', bytes: 12 * MB, path: `${ROOT}/logs`, actions: ['clear-logs', 'reveal'] },
  ],
  harnessRuntimes: [
    { id: 'claude', bytes: 570 * MB, unusedBytes: 0, path: '/Users/dev/.superone/harness/claude' },
    { id: 'codex', bytes: 330 * MB, unusedBytes: 200 * MB, path: '/Users/dev/.superone/harness/codex' },
  ],
}

const empty: StorageInventory = {
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

function stub(options: { inventory?: StorageInventory; result?: StorageActionResult; failLoad?: boolean; failAction?: boolean } = {}) {
  const getStorageInventory = options.failLoad
    ? vi.fn().mockRejectedValue(new Error('EACCES'))
    : vi.fn().mockResolvedValue(options.inventory ?? full)
  const applyStorageAction = options.failAction
    ? vi.fn().mockRejectedValue(new Error('busy'))
    : vi.fn().mockImplementation(async (action: string) => options.result ?? { action, removedBytes: MB })
  const revealFile = vi.fn().mockResolvedValue(undefined)
  // The worktree section loads on its own; its states are covered in WorktreeStorageSection.test.tsx.
  const getStorageWorktrees = vi.fn().mockResolvedValue([])
  const retrySyncZoneHandoffs = vi.fn().mockResolvedValue({ retried: 2, recovered: 2 })
  Object.assign(window.app, {
    getStorageInventory,
    applyStorageAction,
    revealFile,
    getStorageWorktrees,
    retrySyncZoneHandoffs,
  })
  return { getStorageInventory, applyStorageAction, revealFile, retrySyncZoneHandoffs }
}

function row(id: string) {
  return within(screen.getByTestId(`storage-${id}`))
}

beforeEach(() => { stub() })

describe('storage settings', () => {
  it('shows what is on disk and keeps the chat database reveal-only', async () => {
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('storage-chat-database')).toHaveTextContent('5.4 GB')
    const chat = screen.getByTestId('storage-chat-database').textContent ?? ''
    expect(chat.indexOf('Total')).toBeLessThan(chat.indexOf('Optimizable'))
    expect(screen.getByTestId('storage-chat-database')).toHaveTextContent('0 B')
    expect(screen.getByTestId('storage-chat-database').querySelectorAll('[data-storage-track]')).toHaveLength(1)
    expect(screen.getByTestId('storage-chat-database').querySelector('[data-storage-part="optimizable"]')).not.toBeInTheDocument()
    const backupTrack = screen.getByTestId('storage-backup').querySelector('[data-storage-track]')
    expect(backupTrack?.querySelector('[data-storage-part="optimizable"]')).toHaveAttribute('data-storage-fill', 'hatch')
    expect(screen.queryByText(`${ROOT}/superone.db`)).not.toBeInTheDocument()
    expect(screen.getByTestId('storage-section-database')).toHaveTextContent('11.8 GB')
    expect(screen.getByTestId('storage-section-database')).toHaveTextContent('17.1 GB')
    expect(screen.getByTestId('storage-backup')).toHaveTextContent('11.8 GB')
    expect(backupTrack?.querySelector('[data-storage-part="optimizable"]')).toHaveStyle({ width: '100%' })
    expect(screen.getByTestId('storage-node-event-log')).toHaveTextContent('1420 events')
    expect(screen.queryByTestId('storage-harness-runtimes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('storage-cursor-sdk')).not.toBeInTheDocument()
    expect(screen.queryByText('Harness Runtimes')).not.toBeInTheDocument()
    expect(screen.getByTestId('storage-harness-claude')).toHaveTextContent('0 B')
    expect(screen.getByTestId('storage-harness-codex')).toHaveTextContent('200.0 MB')
    expect(screen.queryByTestId('storage-harness-cursor')).not.toBeInTheDocument()
    expect(screen.queryByText('Resume state for Cursor sessions')).not.toBeInTheDocument()
    expect(row('chat-database').getByRole('button', { name: 'Reveal' }).className.split(/\s+/)).not.toContain('border')
    expect(row('backup').getByRole('button', { name: 'Delete' }).className).toContain('hover:text-destructive')
    expect(row('browser-http-cache').getByRole('button', { name: 'Clear' }).className.split(/\s+/)).not.toContain('border')
    expect(row('browser-http-cache').getByRole('button', { name: 'Clear' }).className).toContain('hover:text-destructive')
    expect(row('chat-database').getByRole('button', { name: 'Reveal' })).toBeEnabled()
    expect(row('chat-database').queryByRole('button', { name: /delete|clear/i })).not.toBeInTheDocument()
  })

  it('shows a skeleton while the inventory is still loading', async () => {
    let resolveInventory: (inventory: StorageInventory) => void = () => {}
    stub()
    window.app.getStorageInventory = () => new Promise((resolve) => { resolveInventory = resolve })
    render(<StorageSettingsPage />)
    const loading = await screen.findByTestId('storage-loading')
    expect(loading.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByTestId('storage-summary')).not.toBeInTheDocument()
    resolveInventory(full)
    expect(await screen.findByTestId('storage-summary')).toBeInTheDocument()
  })

  it('hides empty optional rows and disables actions that would remove nothing', async () => {
    stub({ inventory: empty })
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('storage-chat-database')).toHaveTextContent('0 B')
    expect(screen.queryByTestId('storage-backup')).not.toBeInTheDocument()
    expect(screen.queryByTestId('storage-recovery-leftovers')).not.toBeInTheDocument()
    expect(screen.queryByTestId('storage-cursor-sdk')).not.toBeInTheDocument()
    expect(screen.queryByTestId('storage-harness-cursor')).not.toBeInTheDocument()
    expect(screen.queryByTestId('storage-harness-runtimes')).not.toBeInTheDocument()
    expect(row('chat-database').queryByRole('button')).not.toBeInTheDocument()
    expect(row('browser-http-cache').getByRole('button', { name: 'Clear' })).toBeDisabled()
    expect(row('node-event-log').getByRole('button', { name: 'Compact' })).toBeDisabled()
    expect(row('logs').getByRole('button', { name: 'Clear' })).toBeDisabled()
    expect(screen.getByTestId('storage-optimize')).toBeDisabled()
    expect(screen.getByTestId('storage-summary')).not.toHaveTextContent('HTTP cache')
  })

  it('reveals the chat database and clears the HTTP cache without asking', async () => {
    const { revealFile, applyStorageAction, getStorageInventory } = stub()
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-chat-database')
    await userEvent.click(row('chat-database').getByRole('button', { name: 'Reveal' }))
    expect(revealFile).toHaveBeenCalledWith(`${ROOT}/superone.db`)

    await userEvent.click(row('browser-http-cache').getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledWith('clear-browser-http-cache'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(getStorageInventory).toHaveBeenCalledTimes(2))
  })

  it('asks before deleting chat backups, and cancel leaves them alone', async () => {
    const { applyStorageAction } = stub()
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-backup')
    await userEvent.click(row('backup').getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('restore point')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(applyStorageAction).not.toHaveBeenCalled()
  })

  it('deletes chat backups only after confirm', async () => {
    const { applyStorageAction } = stub()
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-backup')
    await userEvent.click(row('backup').getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByTestId('storage-confirm'))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledWith('delete-backups'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('compacts the event log and says whether the file could shrink', async () => {
    const { applyStorageAction } = stub({
      result: {
        action: 'compact-node-events',
        removedBytes: 40 * MB,
        compact: { removedRows: 1200, freedBytes: 40 * MB, floor: '900', vacuum: 'skipped' },
      },
    })
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-node-event-log')
    await userEvent.click(row('node-event-log').getByRole('button', { name: 'Compact' }))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledWith('compact-node-events'))
    expect(await screen.findByTestId('storage-notice')).toHaveTextContent('Removed 1200 events (40.0 MB)')
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Not enough free disk space')
  })

  it('offers to delete the leftover Antigravity runtime entirely', async () => {
    stub({
      inventory: {
        ...empty,
        categories: [
          ...empty.categories,
          {
            id: 'harness-runtimes',
            bytes: 28,
            unusedBytes: 28,
            path: '/Users/dev/.superone/harness',
            actions: ['reveal', 'clear-unused-harness-runtimes'],
          },
        ],
        harnessRuntimes: [
          { id: 'acp-antigravity', bytes: 28, unusedBytes: 28, path: '/Users/dev/.superone/harness/acp-antigravity' },
        ],
      },
    })
    render(<StorageSettingsPage />)
    const row = await screen.findByTestId('storage-harness-acp-antigravity')
    expect(row).toHaveTextContent('agy')
    expect(row).toHaveTextContent('28 B')
    await userEvent.click(within(row).getByRole('button', { name: 'Clear Unused' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('agy CLI')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('current copy stays')
  })

  it('clears extra copies of the harness whose row was confirmed', async () => {
    const { applyStorageAction } = stub()
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-harness-codex')
    await userEvent.click(row('harness-codex').getByRole('button', { name: 'Clear Unused' }))
    await userEvent.click(screen.getByTestId('storage-confirm'))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledWith('clear-unused-harness-runtimes', 'codex'))
  })

  it('disables clearing unused harness copies when every installed version is still in use', async () => {
    const used = {
      ...full,
      categories: full.categories.map((category) => category.id === 'harness-runtimes' ? { ...category, unusedBytes: 0 } : category),
      harnessRuntimes: full.harnessRuntimes?.map((runtime) => ({ ...runtime, unusedBytes: 0 })),
    }
    stub({ inventory: used })
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-harness-codex')
    expect(row('harness-codex').getByRole('button', { name: 'Clear Unused' })).toBeDisabled()
    expect(screen.getByTestId('storage-harness-codex')).not.toHaveTextContent('unused.')
  })

  it('asks before clearing site data', async () => {
    const { applyStorageAction } = stub()
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-browser-site-data')
    await userEvent.click(row('browser-site-data').getByRole('button', { name: 'Clear' }))
    expect(applyStorageAction).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('signs you out')
    await userEvent.click(screen.getByTestId('storage-confirm'))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledWith('clear-browser-site-data'))
  })

  it('says so when the inventory cannot be read, and retry reads it again', async () => {
    const getStorageInventory = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue(full)
    Object.assign(window.app, { getStorageInventory, applyStorageAction: vi.fn(), revealFile: vi.fn() })
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('storage-error')).toHaveTextContent('could not be read')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('storage-chat-database')).toBeInTheDocument()
    expect(getStorageInventory).toHaveBeenCalledTimes(2)
  })

  it('optimizes in one step including upgrade backups and unused runtimes without touching chat or logins', async () => {
    const releases: Array<() => void> = []
    const hold = () => new Promise<void>((resolve) => { releases.push(resolve) })
    const afterHttpCache = {
      ...full,
      categories: full.categories.map((category) => (
        category.id === 'browser-http-cache' ? { ...category, bytes: 0 } : category
      )),
    }
    let scans = 0
    const getStorageInventory = vi.fn(async () => {
      scans += 1
      return scans === 1 ? full : afterHttpCache
    })
    const applyStorageAction = vi.fn(async (action: string) => {
      if (action === 'clear-browser-http-cache' || action === 'clear-browser-code-cache') await hold()
      if (action === 'compact-node-events') {
        return {
          action,
          removedBytes: 0,
          compact: { removedRows: 10, freedBytes: 40 * MB, floor: '9', vacuum: 'skipped' as const },
        }
      }
      return { action, removedBytes: 10 * MB }
    })
    Object.assign(window.app, { getStorageInventory, applyStorageAction, revealFile: vi.fn() })
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('storage-summary')).toHaveTextContent('26.3 GB')
    expect(screen.getByTestId('storage-summary')).toHaveTextContent('13.9 GB')
    expect(screen.getByTestId('storage-summary')).not.toHaveTextContent('Also compacts')
    expect(screen.getByTestId('storage-summary')).not.toHaveTextContent('HTTP cache')
    const optimize = screen.getByTestId('storage-optimize')
    expect(optimize.querySelector('.lucide-wand')).toBeInTheDocument()
    const browserBar = screen.getByTestId('storage-summary').querySelector('.bg-chart-2')
    expect(browserBar?.className).toContain('transition-[width]')
    const browserWidth = browserBar?.getAttribute('style')

    await userEvent.click(optimize)
    await waitFor(() => expect(optimize).toHaveTextContent('Optimizing…'))
    expect(optimize.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.getByTestId('storage-summary')).toHaveTextContent('26.3 GB')

    releases[0]?.()
    await waitFor(() => expect(screen.getByTestId('storage-summary')).toHaveTextContent('25.5 GB'))
    expect(screen.getByTestId('storage-summary')).toHaveTextContent('13.1 GB')
    expect(screen.getByTestId('storage-summary')).toHaveTextContent('3.3 GB')
    expect(screen.getByTestId('storage-browser-http-cache')).toHaveTextContent('0 B')
    expect(screen.getByTestId('storage-summary').querySelector('.bg-chart-2')?.getAttribute('style')).not.toBe(browserWidth)
    expect(optimize).toHaveTextContent('Optimizing…')
    expect(screen.queryByTestId('storage-notice')).not.toBeInTheDocument()

    releases[1]?.()
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledTimes(6))
    expect(applyStorageAction.mock.calls.map((call) => call[0])).toEqual([
      'clear-browser-http-cache',
      'clear-browser-code-cache',
      'clear-app-cache',
      'delete-backups',
      'clear-unused-harness-runtimes',
      'compact-node-events',
    ])
    expect(getStorageInventory).toHaveBeenCalledTimes(7)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByTestId('storage-notice')).toHaveTextContent('Freed 50.0 MB')
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Not enough free disk space to shrink the event log')
  })

  it('keeps the measured sizes when optimize stops early', async () => {
    const applyStorageAction = vi.fn(async (action: string) => {
      if (action === 'clear-app-cache') throw new Error('EPERM')
      return { action, removedBytes: 10 * MB }
    })
    Object.assign(window.app, {
      getStorageInventory: vi.fn().mockResolvedValue(full),
      applyStorageAction,
      revealFile: vi.fn(),
    })
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-summary')
    await userEvent.click(screen.getByTestId('storage-optimize'))
    expect(await screen.findByTestId('storage-notice')).toHaveTextContent('Optimize stopped before it finished')
    expect(screen.getByTestId('storage-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('storage-error')).not.toBeInTheDocument()
    expect(applyStorageAction.mock.calls.map((call) => call[0])).toEqual([
      'clear-browser-http-cache',
      'clear-browser-code-cache',
      'clear-app-cache',
    ])
  })

  it('matches top summary optimizable space with single backup and codex previous version', async () => {
    const singleBackupAndCodex: StorageInventory = {
      nodeEvents: { rows: 0, retentionFloor: '0', lastCompactAt: null, lastFreedBytes: null },
      categories: [
        { id: 'chat-database', bytes: Math.round(1.2 * GB), path: `${ROOT}/superone.db`, actions: ['reveal'] },
        { id: 'backup', bytes: Math.round(992.4 * MB), unusedBytes: 0, path: `${ROOT}/backups`, count: 1, actions: ['reveal', 'delete-backups'] },
        { id: 'browser-http-cache', bytes: Math.round(59.8 * 1024), path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-http-cache', 'reveal'] },
        { id: 'browser-code-cache', bytes: 0, path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-code-cache', 'reveal'] },
        { id: 'browser-site-data', bytes: Math.round(368.3 * MB), path: `${ROOT}/Partitions/browser`, actions: ['clear-browser-site-data', 'reveal'] },
        { id: 'node-event-log', bytes: 0, path: `${ROOT}/node-host/node.db`, actions: ['compact-node-events', 'reveal'] },
        { id: 'sync-attachments', bytes: Math.round(31.4 * MB), path: `${ROOT}/sync`, actions: ['clear-sync-attachments', 'reveal'] },
        { id: 'sync-media', bytes: 0, path: `${ROOT}/sync`, actions: ['clear-sync-media', 'reveal'] },
        { id: 'app-cache', bytes: Math.round(12.1 * MB), unusedBytes: Math.round(703.9 * 1024), path: `${ROOT}/Cache`, actions: ['clear-app-cache', 'reveal'] },
        { id: 'harness-runtimes', bytes: Math.round(1302.3 * MB), unusedBytes: Math.round(339.5 * MB), path: '/Users/dev/.superone/harness', actions: ['reveal', 'clear-unused-harness-runtimes'] },
        { id: 'logs', bytes: 0, path: `${ROOT}/logs`, actions: ['clear-logs', 'reveal'] },
      ],
      harnessRuntimes: [
        { id: 'claude', bytes: Math.round(613.5 * MB), unusedBytes: 0, path: '/Users/dev/.superone/harness/claude' },
        { id: 'codex', bytes: Math.round(688.8 * MB), unusedBytes: Math.round(339.5 * MB), path: '/Users/dev/.superone/harness/codex' },
      ],
    }
    const { applyStorageAction } = stub({ inventory: singleBackupAndCodex })
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('storage-summary')).toHaveTextContent('1.3 GB')
    expect(screen.getByTestId('storage-section-database')).toHaveTextContent('992.4 MB')
    expect(screen.getByTestId('storage-section-runtimes')).toHaveTextContent('339.5 MB')
    await userEvent.click(screen.getByTestId('storage-optimize'))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledTimes(4))
    expect(applyStorageAction.mock.calls.map((call) => call[0])).toEqual([
      'clear-browser-http-cache',
      'clear-app-cache',
      'delete-backups',
      'clear-unused-harness-runtimes',
    ])
  })

  it('shows the error again when an action fails', async () => {
    stub({ failAction: true })
    render(<StorageSettingsPage />)
    await screen.findByTestId('storage-app-cache')
    await userEvent.click(row('app-cache').getByRole('button', { name: 'Clear' }))
    expect(await screen.findByTestId('storage-error')).toBeInTheDocument()
  })

  it('counts deleted-session sync leftovers as optimizable and sweeps them during optimize', async () => {
    const withSyncUnused: StorageInventory = {
      ...full,
      categories: full.categories.map((category) => (
        category.id === 'sync-attachments'
          ? { ...category, unusedBytes: 200 * MB }
          : category.id === 'sync-media'
            ? { ...category, unusedBytes: 50 * MB }
            : category
      )),
    }
    const { applyStorageAction } = stub({ inventory: withSyncUnused })
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('storage-section-sync')).toHaveTextContent('250.0 MB')
    expect(screen.getByTestId('storage-sync-attachments')).toHaveTextContent('200.0 MB')
    expect(screen.getByTestId('storage-sync-media')).toHaveTextContent('50.0 MB')
    expect(screen.queryByTestId('session-storage-stuck')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry upload/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clean up/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('storage-optimize'))
    await waitFor(() => expect(applyStorageAction).toHaveBeenCalledWith('reclaim-sync-zone'))
    expect(applyStorageAction.mock.calls.filter((call) => call[0] === 'reclaim-sync-zone')).toHaveLength(1)
  })

  it('shows sync upload failures inside Session Files and retries handoffs without touching committing files', async () => {
    const { retrySyncZoneHandoffs, getStorageInventory } = stub({
      inventory: {
        ...full,
        syncIssues: {
          failedHandoffs: { files: 2, bytes: 5 * MB, lastError: 'SQLITE_BUSY' },
          needsRedelivery: { files: 1, bytes: 3 * MB },
        },
      },
    })
    render(<StorageSettingsPage />)
    expect(await screen.findByTestId('session-storage-stuck')).toHaveTextContent(/5\.0 MB in 2 files/)
    expect(screen.getByTestId('session-storage-stuck')).toHaveTextContent(/SQLITE_BUSY/)
    const redelivery = screen.getByTestId('session-storage-needs-redelivery')
    expect(redelivery).toHaveTextContent(/3\.0 MB in 1 files/)
    expect(redelivery).toHaveTextContent(/re-run the action/i)

    const retryButtons = screen.getAllByRole('button', { name: /retry upload/i })
    expect(retryButtons).toHaveLength(1)
    await userEvent.click(retryButtons[0])
    await waitFor(() => expect(retrySyncZoneHandoffs).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getStorageInventory).toHaveBeenCalledTimes(2))
  })
})
