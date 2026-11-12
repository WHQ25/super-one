/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSearchResult } from '@superone/shared/agent-types'
import { FileTreeSearch } from './FileTreeSearch'
import { useFileTreeStore } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'

const searchFiles = vi.fn<(projectPath: string, query: string) => Promise<FileSearchResult[]>>()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window.environment, { searchFiles })
  useFileTreeStore.getState().reset()
  useSourceControlStore.setState({ files: [], selectedFile: null })
})

function result(path: string, isDirectory = false): FileSearchResult {
  return { path, isDirectory, matchIndices: [], score: 1 }
}

describe('FileTreeSearch', () => {
  it('runs a debounced fuzzy search and renders matches nested under their directories', async () => {
    searchFiles.mockResolvedValue([result('src/index.ts'), result('src/app.ts')])
    render(<FileTreeSearch projectRoot="/proj" onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'app' } })

    await waitFor(() => expect(searchFiles).toHaveBeenCalledWith('/proj', 'app'))
    expect(await screen.findByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('expands the tree to every ancestor directory of a deep match', async () => {
    searchFiles.mockResolvedValue([result('src/components/sidebar/FileTree.tsx')])
    render(<FileTreeSearch projectRoot="/proj" onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'ft' } })

    expect(await screen.findByText('FileTree.tsx')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('components')).toBeInTheDocument()
    expect(screen.getByText('sidebar')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<FileTreeSearch projectRoot="/proj" onClose={onClose} />)

    fireEvent.keyDown(screen.getByPlaceholderText('Search files...'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('colors a match with its git status, ignoring path case', async () => {
    useSourceControlStore.setState({
      files: [{ path: 'Src/App.ts', status: 'M', staged: false }],
      selectedFile: null,
    })
    searchFiles.mockResolvedValue([result('src/app.ts')])
    render(<FileTreeSearch projectRoot="/proj" onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'app' } })

    const name = await screen.findByText('app.ts')
    expect(name.className).toContain('text-amber-700')
  })

  it('shows the empty state when a search returns nothing', async () => {
    searchFiles.mockResolvedValue([])
    render(<FileTreeSearch projectRoot="/proj" onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'zzz' } })

    expect(await screen.findByText('No matching files')).toBeInTheDocument()
  })

  it('limits results to the focused folder and reveals the project-relative path', async () => {
    searchFiles.mockResolvedValue([result('src/components/Button.tsx'), result('docs/guide.md')])
    const onClose = vi.fn()
    render(<FileTreeSearch projectRoot="/proj" scopeDir="src" onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'btn' } })

    await waitFor(() => expect(searchFiles).toHaveBeenCalledWith('/proj', 'btn', undefined, 'src'))
    expect(await screen.findByText('Button.tsx')).toBeInTheDocument()
    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('components'))
    await waitFor(() => expect(useFileTreeStore.getState().revealedPath).toBe('src/components'))
    expect(onClose).toHaveBeenCalled()
  })

  it('reveals a directory result in the tree and closes the search', async () => {
    searchFiles.mockResolvedValue([result('src/components', true)])
    const onClose = vi.fn()
    render(<FileTreeSearch projectRoot="/proj" onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'comp' } })
    fireEvent.click(await screen.findByText('components'))

    await waitFor(() => expect(useFileTreeStore.getState().revealedPath).toBe('src/components'))
    expect(onClose).toHaveBeenCalled()
  })

  it('activates the keyboard-selected result on Enter', async () => {
    searchFiles.mockResolvedValue([result('a.ts'), result('b.ts')])
    const onClose = vi.fn()
    render(<FileTreeSearch projectRoot="/proj" onClose={onClose} />)

    const input = screen.getByPlaceholderText('Search files...')
    fireEvent.change(input, { target: { value: 'ts' } })
    await screen.findByText('a.ts')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onClose).toHaveBeenCalled()
  })

  it('ignores Enter while an IME composition is in progress', async () => {
    searchFiles.mockResolvedValue([result('a.ts')])
    const onClose = vi.fn()
    render(<FileTreeSearch projectRoot="/proj" onClose={onClose} />)

    const input = screen.getByPlaceholderText('Search files...')
    fireEvent.change(input, { target: { value: 'a' } })
    await screen.findByText('a.ts')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onClose).not.toHaveBeenCalled()
  })
})
