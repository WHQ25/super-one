/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useFileTreeStore } from '@/stores/file-tree'
import { FileTree } from './FileTree'

// jsdom has no layout, so the real virtualizer measures a 0px viewport and renders no rows.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index, index, start: index * 28, size: 28,
    })),
    scrollToIndex: () => {},
  }),
}))

const { openFileTab } = vi.hoisted(() => ({ openFileTab: vi.fn() }))
vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/activity/activity-panel-api')>()),
  openFileTab,
}))

const listDir = vi.fn(async () => [])

function stubApp() {
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = { listDir, trace: vi.fn() }
}

describe('FileTree manual refresh', () => {
  beforeEach(() => {
    listDir.mockClear()
    stubApp()
    useFileTreeStore.getState().reset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers a refresh button for remote projects, which are not watched', async () => {
    useAppStore.setState({ currentFolder: 'remote:conn-1:/root/workspace/proj' })
    render(<FileTree />)
    await waitFor(() => expect(listDir).toHaveBeenCalled())
    listDir.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh file tree' }))

    await waitFor(() => expect(listDir).toHaveBeenCalledWith('remote:conn-1:/root/workspace/proj', ''))
  })

  it('hides it for local projects, where the file watcher already refreshes', async () => {
    useAppStore.setState({ currentFolder: '/Users/me/proj' })
    render(<FileTree />)
    await waitFor(() => expect(listDir).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: 'Refresh file tree' })).not.toBeInTheDocument()
  })
})

describe('FileTree new file / new folder', () => {
  const createEntry = vi.fn()

  beforeEach(() => {
    listDir.mockReset()
    listDir.mockImplementation(async () => [
      { name: 'a.ts', path: 'a.ts', isDirectory: false, gitIndex: null, gitWorktree: null },
    ] as never)
    createEntry.mockReset()
    openFileTab.mockClear()
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = { listDir, createEntry, trace: vi.fn() }
    useFileTreeStore.getState().reset()
    useAppStore.setState({ currentFolder: '/Users/me/proj' })
  })

  it('creates a file at the root from the header button and opens it', async () => {
    createEntry.mockResolvedValue({ ok: true })
    render(<FileTree />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New File' }))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'b.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createEntry).toHaveBeenCalledWith('/Users/me/proj', '', 'b.ts', 'file'))
    await waitFor(() => expect(openFileTab).toHaveBeenCalledWith('b.ts'))
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })

  it('cancels the draft on Escape without touching disk', async () => {
    render(<FileTree />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }))
    const input = await screen.findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('keeps the draft row open when the name is already taken', async () => {
    createEntry.mockResolvedValue({ ok: false, error: 'Target already exists: a.ts' })
    render(<FileTree />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New File' }))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'a.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createEntry).toHaveBeenCalled())
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(openFileTab).not.toHaveBeenCalled()
  })
})
