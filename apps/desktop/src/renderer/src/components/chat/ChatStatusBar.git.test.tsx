/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GitInfoResult } from '@superone/shared/agent-types'
import type { PerSessionState } from '@/stores/chat-store/types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { ChatStatusBar } from './ChatStatusBar'
import { WorkDirIndicator } from './WorkDirIndicator'

const PROJECT = 'remote:office:/srv/app'
const WORKTREE = '/home/node/.worktrees/app/task-7af08a26'
const REMOTE_WORKTREE = `remote:office:${WORKTREE}`

function patchSession(patch: Partial<PerSessionState>): void {
  useChatStore.setState((state) => {
    const project = state.projectSessions[PROJECT]
    const sid = project._activeSessionId!
    return {
      projectSessions: {
        ...state.projectSessions,
        [PROJECT]: {
          ...project,
          _sessions: { ...project._sessions, [sid]: { ...project._sessions[sid], ...patch } },
        },
      },
    }
  })
}

const defaultGitInfo = async (path: string): Promise<GitInfoResult> => {
  if (path === WORKTREE) return { branch: null, error: `spawn git ENOENT: ${path}` }
  return { branch: path === PROJECT ? 'main' : 'task/7af08a26', dirty: { files: 2, insertions: 12, deletions: 3 } }
}
const getGitInfo = vi.fn(defaultGitInfo)

beforeEach(() => {
  getGitInfo.mockReset().mockImplementation(defaultGitInfo)
  Object.assign(window.app, {
    getGitInfo,
    getWorktreeInfo: vi.fn(async () => ({ isWorktree: false, currentBranch: 'main', entries: [] })),
    collaborationMailbox: { list: async () => [], onChanged: () => () => {} },
    codexListModels: async () => [],
  })
  useChatStore.getState().ensureSession(PROJECT)
  useChatStore.setState({ activeProject: PROJECT })
  patchSession({
    environmentSelection: null,
    _worktreePath: WORKTREE,
    _gitBranch: 'task/7af08a26',
    status: 'idle',
    session: null,
    messages: [],
  })
  useAppStore.setState({ experimentalRemoteNodesEnabled: true, currentFolder: PROJECT, _worktrees: {} })
})

describe('remote existing worktree statistics', () => {
  it.each([true, false])('loads each worktree status when the picker opens (experiment: %s)', async (experiment) => {
    const cleanPath = `${WORKTREE}-clean`
    const failedPath = `${WORKTREE}-unavailable`
    const detachedPath = `${WORKTREE}-detached`
    patchSession({ _worktreePath: null, _gitBranch: 'main' })
    useAppStore.setState({ experimentalRemoteNodesEnabled: experiment })
    Object.assign(window.app, {
      getGitBranches: vi.fn(async () => ({ local: ['main'] })),
      getCheckedOutBranches: vi.fn(async () => ['main']),
      getWorktreeInfo: vi.fn(async () => ({
        isWorktree: false,
        currentBranch: 'main',
        entries: [
          { path: '/srv/app', branch: 'main', head: 'abcdef1234', isMain: true, isCurrent: true },
          { path: WORKTREE, branch: 'task/7af08a26', head: 'abcdef1234', isMain: false, isCurrent: false },
          { path: cleanPath, branch: 'task/clean', head: 'abcdef1234', isMain: false, isCurrent: false },
          { path: failedPath, branch: 'task/unavailable', head: 'abcdef1234', isMain: false, isCurrent: false },
          { path: detachedPath, branch: '', head: '1234567890', isMain: false, isCurrent: false },
        ],
      })),
    })
    getGitInfo.mockImplementation(async (path) => {
      if (path === `remote:office:${cleanPath}`) return { branch: 'task/clean' }
      if (path === `remote:office:${failedPath}`) throw new Error('checkout unavailable')
      if (path === `remote:office:${detachedPath}`) return { branch: 'HEAD', dirty: { files: 1, insertions: 0, deletions: 8 } }
      return defaultGitInfo(path)
    })

    const user = userEvent.setup()
    render(<WorkDirIndicator isGitRepo />)
    // These are list reads, not the active worktree's mount-time status read.
    expect(getGitInfo).not.toHaveBeenCalledWith(REMOTE_WORKTREE)
    await user.click(await screen.findByRole('button'))
    if (experiment) await user.click(screen.getByRole('tab', { name: 'Worktree' }))

    const dirtyRow = within(await screen.findByRole('button', { name: /task\/7af08a26/ }))
    await waitFor(() => expect(dirtyRow.getByText('2 files')).toBeTruthy())
    expect(dirtyRow.getByText('+12')).toBeTruthy()
    expect(dirtyRow.getByText('-3')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /task\/clean/ })).getByText('clean')).toBeTruthy()
    expect(screen.getByRole('button', { name: /task\/unavailable/ }).textContent).not.toMatch(/clean|files/)
    const detachedRow = within(screen.getByRole('button', { name: /Detached 1234567/ }))
    expect(detachedRow.getByText('1 file')).toBeTruthy()
    expect(detachedRow.getByText('-8')).toBeTruthy()
    for (const path of [WORKTREE, cleanPath, failedPath, detachedPath]) {
      expect(getGitInfo).toHaveBeenCalledWith(`remote:office:${path}`)
      expect(getGitInfo).not.toHaveBeenCalledWith(path)
    }
  })
})

afterEach(cleanup)

describe('remote session worktree Git reads', () => {
  it.each(['restored', 'selected'] as const)('routes the %s worktree to its node on mount and after a turn', async (kind) => {
    if (kind === 'selected') {
      patchSession({ environmentSelection: { environmentId: 'office', selection: { kind: 'existing', path: WORKTREE } } })
    }
    render(<ChatStatusBar />)
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(REMOTE_WORKTREE))
    expect(getGitInfo).not.toHaveBeenCalledWith(WORKTREE)
    expect(screen.queryByText('Git Unavailable')).toBeNull()

    getGitInfo.mockClear()
    act(() => patchSession({ status: 'streaming' }))
    act(() => patchSession({ status: 'idle' }))
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(REMOTE_WORKTREE))
    expect(getGitInfo).not.toHaveBeenCalledWith(WORKTREE)
  })

  it('routes the classic worktree dirty reads to the node with the experiment off', async () => {
    useAppStore.setState({
      experimentalRemoteNodesEnabled: false,
      _worktrees: {
        [PROJECT]: {
          pendingBaseBranch: null, pendingMode: 'branch', pendingBranchName: '',
          pendingCarryLocalChanges: false, activePath: WORKTREE,
        },
      },
    })
    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(REMOTE_WORKTREE))
    expect(getGitInfo).not.toHaveBeenCalledWith(WORKTREE)
  })
})
