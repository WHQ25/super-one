/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const PROJECT = '/Users/me/proj'
const WORKTREE = '/Users/me/proj-wt-feature'

const readProjectFile = vi.fn(async (_root: string, _path: string) => ({ content: '', language: 'text' as const }))
const getGitDiffFile = vi.fn(async (_root: string, _path: string, _staged: boolean) => ({ diff: '' }))
const saveFile = vi.fn(async (_root: string, _path: string, _text: string) => ({ ok: true as const }))

;(window as unknown as { app: unknown }).app = {
  readProjectFile,
  getGitDiffFile,
  saveFile,
  onContentZoom: () => () => {},
  trace: () => {},
}
;(window as unknown as { agent: unknown }).agent = new Proxy({}, { get: () => () => Promise.resolve(undefined) })

const { useAppStore } = await import('../../renderer/src/stores/app')
const { useSourceControlStore } = await import('../../renderer/src/stores/source-control')
const { FilePreview } = await import('../../renderer/src/components/coding/FilePreview')

function primeWorktreeState(activePath: string | null): void {
  useAppStore.setState({
    currentFolder: PROJECT,
    _worktrees: activePath
      ? {
          [PROJECT]: {
            pendingBaseBranch: null,
            pendingMode: 'branch',
            pendingBranchName: '',
            pendingCarryLocalChanges: false,
            activePath,
          },
        }
      : {},
  })
}

describe('worktree file-root routing', () => {
  beforeEach(() => {
    readProjectFile.mockClear()
    getGitDiffFile.mockClear()
    saveFile.mockClear()
    useSourceControlStore.setState({
      files: [],
      loading: false,
      selectedFile: null,
      fileDiff: null,
      fileContent: null,
      activeTab: 'changes',
      scrollToLine: null,
    })
  })

  it('reads worktree path, not main repo path, when a worktree is active', async () => {
    primeWorktreeState(WORKTREE)
    render(<FilePreview filePath="src/feature.ts" />)

    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith(WORKTREE, 'src/feature.ts')
      expect(getGitDiffFile).toHaveBeenCalledWith(WORKTREE, 'src/feature.ts', false)
    })
    expect(readProjectFile).not.toHaveBeenCalledWith(PROJECT, 'src/feature.ts')
    expect(getGitDiffFile).not.toHaveBeenCalledWith(PROJECT, 'src/feature.ts', false)
  })

  it('falls back to currentFolder when no worktree is active', async () => {
    primeWorktreeState(null)
    render(<FilePreview filePath="src/main.ts" />)

    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith(PROJECT, 'src/main.ts')
      expect(getGitDiffFile).toHaveBeenCalledWith(PROJECT, 'src/main.ts', false)
    })
  })
})
