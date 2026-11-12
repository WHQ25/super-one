/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileTreeEntry } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useFileTreeStore } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'
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

const listDir = vi.fn(async (_folderPath: string, _dirRelPath: string): Promise<FileTreeEntry[]> => [])

async function chooseCreate(name: 'New File' | 'New Folder') {
  fireEvent.keyDown(screen.getByTestId('file-tree-new'), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

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
    ])
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

    await chooseCreate('New File')
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

    await chooseCreate('New Folder')
    const input = await screen.findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('keeps the draft row open when the name is already taken', async () => {
    createEntry.mockResolvedValue({ ok: false, error: 'Target already exists: a.ts' })
    render(<FileTree />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument())

    await chooseCreate('New File')
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'a.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createEntry).toHaveBeenCalled())
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(openFileTab).not.toHaveBeenCalled()
  })
})

describe('FileTree folder focus and changed files', () => {
  const createEntry = vi.fn(async () => ({ ok: true }))
  const changed = [
    { path: 'src/app.ts', status: 'M' as const, staged: false },
    { path: 'docs/guide.md', status: 'A' as const, staged: true },
  ]
  const searchFiles = vi.fn(async () => [
    { path: 'src/app.ts', isDirectory: false, matchIndices: [4], score: 1 },
    { path: 'docs/guide.md', isDirectory: false, matchIndices: [0], score: 1 },
  ])

  beforeEach(() => {
    listDir.mockImplementation(async (_folder: string, rel: string) => {
      if (rel === '') {
        return [
          { name: 'src', path: 'src', isDirectory: true, gitIndex: null, gitWorktree: 'M' },
          { name: 'docs', path: 'docs', isDirectory: true, gitIndex: null, gitWorktree: null },
          { name: 'readme.md', path: 'readme.md', isDirectory: false, gitIndex: null, gitWorktree: null },
        ]
      }
      if (rel === 'src') {
        return [
          { name: 'app.ts', path: 'src/app.ts', isDirectory: false, gitIndex: null, gitWorktree: 'M' },
          { name: 'clean.ts', path: 'src/clean.ts', isDirectory: false, gitIndex: null, gitWorktree: null },
          { name: 'lib', path: 'src/lib', isDirectory: true, gitIndex: null, gitWorktree: null },
        ]
      }
      if (rel === 'src/lib') {
        return [{ name: 'util.ts', path: 'src/lib/util.ts', isDirectory: false, gitIndex: null, gitWorktree: null }]
      }
      if (rel === 'docs') {
        return [{ name: 'guide.md', path: 'docs/guide.md', isDirectory: false, gitIndex: 'A', gitWorktree: null }]
      }
      return []
    })
    const w = globalThis.window as unknown as Record<string, unknown>
    createEntry.mockClear()
    w.app = { listDir, createEntry, trace: vi.fn(), getGitStatusFiles: vi.fn(async () => changed) }
    w.environment = { searchFiles }
    searchFiles.mockClear()
    useFileTreeStore.getState().reset()
    useSourceControlStore.setState({ files: changed, selectedFile: null })
    useAppStore.setState({ currentFolder: '/Users/me/proj', recentFolders: [] })
  })

  async function enterSrc() {
    render(<FileTree />)
    await screen.findByText('readme.md')
    fireEvent.doubleClick(screen.getByText('src'))
    await screen.findByText('app.ts')
    expect(screen.queryByText('readme.md')).not.toBeInTheDocument()
  }

  it('creates files inside the folder opened by a double-click', async () => {
    await enterSrc()
    await chooseCreate('New File')
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'c.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(createEntry).toHaveBeenCalledWith('/Users/me/proj', 'src', 'c.ts', 'file'))
  })

  it('returns to the parent from the level icon and keeps the ancestor menu', async () => {
    await enterSrc()
    const rootBack = screen.getByRole('button', { name: 'Back to proj' })
    expect(rootBack.querySelector('.lucide-list')).toBeTruthy()
    expect(rootBack.querySelector('.lucide-circle-chevron-left')).toHaveClass('hidden')
    expect(document.querySelector('[data-sidebar-focus-levels]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Focus Levels' })).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('lib'))
    await screen.findByText('util.ts')
    const back = screen.getByRole('button', { name: 'Back to src' })
    expect(screen.queryByRole('button', { name: 'Focus Levels' })).not.toBeInTheDocument()
    expect(back.querySelector('.lucide-list')).toBeTruthy()
    expect(within(screen.getByTestId('file-tree-dropzone')).queryByText('src')).not.toBeInTheDocument()

    fireEvent.click(back)
    expect(await screen.findByText('app.ts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to proj' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Focus Levels' })).not.toBeInTheDocument()
  })

  it('lists the parent folder above the project root', async () => {
    await enterSrc()
    fireEvent.doubleClick(screen.getByText('lib'))
    await screen.findByText('util.ts')

    const menu = document.querySelector('[data-sidebar-focus-levels]')
    const buttons = [...(menu?.querySelectorAll('button') ?? [])]
    expect(buttons.map((button) => button.textContent)).toEqual(['src', 'proj'])
    expect(buttons.at(-1)?.querySelector('.lucide-folder-open')).toBeNull()
    expect(buttons.at(-1)?.querySelector('.lucide-folder')).toBeTruthy()
  })

  it('steps up to the project root and switches to a sibling folder', async () => {
    const user = userEvent.setup()
    await enterSrc()

    await user.click(screen.getByRole('button', { name: 'Back to proj' }))
    expect(await screen.findByText('readme.md')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('src'))
    await screen.findByText('app.ts')
    await user.click(screen.getByRole('button', { name: 'src' }))
    await user.click(screen.getByRole('menuitem', { name: /docs/ }))
    expect(await screen.findByText('guide.md')).toBeInTheDocument()
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument()
  })

  it('shows only changed files, scoped to the open folder', async () => {
    render(<FileTree />)
    await screen.findByText('readme.md')
    fireEvent.click(screen.getByRole('button', { name: 'Only Changed Files' }))
    expect(await screen.findByText('app.ts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.ts' })).toHaveStyle({ paddingLeft: '16px' })
    expect(screen.getByText('guide.md')).toBeInTheDocument()
    expect(screen.queryByText('readme.md')).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('src'))
    await waitFor(() => expect(screen.queryByText('guide.md')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'app.ts' })).toHaveStyle({ paddingLeft: '8px' })
    expect(screen.queryByText('clean.ts')).not.toBeInTheDocument()
  })

  it('searches inside the open folder', async () => {
    await enterSrc()
    fireEvent.click(screen.getByRole('button', { name: 'Search files...' }))
    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'app' } })
    // The match highlight splits the filename across spans, so match the row's name.
    expect(await screen.findByRole('button', { name: 'app.ts' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('guide.md')).not.toBeInTheDocument())
  })
})
