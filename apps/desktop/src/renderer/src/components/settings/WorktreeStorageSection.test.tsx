/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StorageWorktree, StorageWorktreeRemoval } from '@superone/shared/desktop-storage'
import { WorktreeStorageSection } from './WorktreeStorageSection'

const MB = 1024 ** 2
const ROOT = '/Users/dev/.worktrees'

const used: StorageWorktree = { path: `${ROOT}/app/used`, repo: 'app', branch: 'feat/live', bytes: 300 * MB, inUse: true, dirty: true }
const idle: StorageWorktree = { path: `${ROOT}/app/idle`, repo: 'app', branch: 'fix/old', bytes: 100 * MB, inUse: false, dirty: false }
const detached: StorageWorktree = { path: `${ROOT}/app/detached`, repo: 'app', branch: null, bytes: 50 * MB, inUse: false, dirty: false }
const dirty: StorageWorktree = { path: `${ROOT}/docs/dirty`, repo: 'docs', branch: 'draft', bytes: 20 * MB, inUse: false, dirty: true }

function stub(options: { lists?: StorageWorktree[][]; failLoad?: boolean; removal?: (paths: string[]) => StorageWorktreeRemoval } = {}) {
  const lists = options.lists ?? [[used, idle, detached, dirty]]
  let reads = 0
  const getStorageWorktrees = options.failLoad
    ? vi.fn().mockRejectedValueOnce(new Error('EACCES')).mockResolvedValue(lists[0])
    : vi.fn().mockImplementation(async () => lists[Math.min(reads++, lists.length - 1)])
  const removeStorageWorktrees = vi.fn().mockImplementation(async (paths: string[]) =>
    options.removal ? options.removal(paths) : { removed: paths, failed: [] })
  const revealFile = vi.fn().mockResolvedValue(undefined)
  Object.assign(window.app, { getStorageWorktrees, removeStorageWorktrees, revealFile })
  return { getStorageWorktrees, removeStorageWorktrees, revealFile }
}

function rowFor(name: string): HTMLElement {
  return screen.getAllByTestId('storage-worktree').find((row) => row.textContent?.includes(name))!
}

describe('worktree storage section', () => {
  it('summarizes worktrees in use and lists only the unused ones for removal', async () => {
    stub()
    render(<WorktreeStorageSection />)

    expect(await screen.findByTestId('storage-worktrees-in-use')).toHaveTextContent('300.0 MB')
    expect(screen.getAllByTestId('storage-worktree')).toHaveLength(3)
    expect(screen.queryByText('app/used')).not.toBeInTheDocument()
    expect(rowFor('app/idle')).toHaveTextContent('fix/old')
    expect(rowFor('app/detached')).toHaveTextContent('Detached')
    expect(rowFor('docs/dirty')).toHaveTextContent('uncommitted changes')
    // Total 470 MB, of which the 170 MB of unused worktrees can be freed.
    expect(screen.getByTestId('storage-worktrees-space')).toHaveTextContent(/470\.0 MB.*170\.0 MB/)
  })

  it('removes the clean unused worktrees in one pass and leaves the one with uncommitted changes', async () => {
    const { getStorageWorktrees, removeStorageWorktrees } = stub()
    render(<WorktreeStorageSection />)

    await userEvent.click(await screen.findByTestId('storage-worktrees-remove-unused'))
    expect(removeStorageWorktrees).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('150.0 MB')
    await userEvent.click(screen.getByTestId('storage-worktrees-confirm'))

    expect(removeStorageWorktrees).toHaveBeenCalledWith([idle.path, detached.path])
    expect(await screen.findByTestId('storage-worktrees-notice')).toHaveTextContent('Removed 2 worktrees and freed 150.0 MB.')
    await waitFor(() => expect(screen.getAllByTestId('storage-worktree')).toHaveLength(1))
    expect(getStorageWorktrees).toHaveBeenCalledTimes(1)
  })

  it('warns about lost changes before removing a single worktree with uncommitted changes', async () => {
    const { removeStorageWorktrees } = stub()
    render(<WorktreeStorageSection />)
    await screen.findByTestId('storage-worktrees-in-use')

    await userEvent.click(within(rowFor('docs/dirty')).getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('uncommitted changes that will be lost')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(removeStorageWorktrees).not.toHaveBeenCalled()

    await userEvent.click(within(rowFor('docs/dirty')).getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByTestId('storage-worktrees-confirm'))
    expect(removeStorageWorktrees).toHaveBeenCalledWith([dirty.path])
  })

  it('reports worktrees that could not be removed and counts only what was freed', async () => {
    const { getStorageWorktrees } = stub({
      lists: [[idle, detached]],
      removal: () => ({ removed: [idle.path], failed: [{ path: detached.path, error: 'Worktree is in use' }] }),
    })
    render(<WorktreeStorageSection />)

    await userEvent.click(await screen.findByTestId('storage-worktrees-remove-unused'))
    await userEvent.click(screen.getByTestId('storage-worktrees-confirm'))

    expect(await screen.findByTestId('storage-worktrees-notice')).toHaveTextContent('1 worktree could not be removed. Freed 100.0 MB.')
    expect(screen.getAllByTestId('storage-worktree')).toHaveLength(1)
    expect(rowFor('app/detached')).toBeInTheDocument()
    expect(getStorageWorktrees).toHaveBeenCalledTimes(1)
  })

  it('has nothing to remove when every worktree is in use or none exist', async () => {
    stub({ lists: [[used]] })
    const { unmount } = render(<WorktreeStorageSection />)
    await screen.findByTestId('storage-worktrees-in-use')
    expect(screen.getByTestId('storage-worktrees-remove-unused')).toBeDisabled()
    expect(screen.queryByTestId('storage-worktree')).not.toBeInTheDocument()
    unmount()

    stub({ lists: [[]] })
    render(<WorktreeStorageSection />)
    expect(await screen.findByTestId('storage-worktrees-empty')).toBeInTheDocument()
    expect(screen.getByTestId('storage-worktrees-remove-unused')).toBeDisabled()
  })

  it('shows progress while measuring, then an error with a working retry', async () => {
    const { getStorageWorktrees } = stub({ failLoad: true })
    render(<WorktreeStorageSection />)
    expect(screen.getByTestId('storage-worktrees-loading')).toBeInTheDocument()

    expect(await screen.findByTestId('storage-worktrees-error')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('storage-worktrees-in-use')).toBeInTheDocument()
    expect(getStorageWorktrees).toHaveBeenCalledTimes(2)
  })

  it('reveals a worktree in the file manager', async () => {
    const { revealFile } = stub()
    render(<WorktreeStorageSection />)
    await screen.findByTestId('storage-worktrees-in-use')
    await userEvent.click(within(rowFor('app/idle')).getByRole('button', { name: 'Reveal' }))
    expect(revealFile).toHaveBeenCalledWith(idle.path)
  })
})
