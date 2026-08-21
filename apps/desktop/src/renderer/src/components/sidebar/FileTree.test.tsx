/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useFileTreeStore } from '@/stores/file-tree'
import { FileTree } from './FileTree'

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
