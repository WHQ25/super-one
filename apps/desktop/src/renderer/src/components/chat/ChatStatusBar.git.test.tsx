/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

const getGitInfo = vi.fn(async (path: string) => {
  if (path === WORKTREE) return { branch: null, error: `spawn git ENOENT: ${path}` }
  return { branch: path === PROJECT ? 'main' : 'task/7af08a26', dirty: { files: 2, insertions: 12, deletions: 3 } }
})

beforeEach(() => {
  getGitInfo.mockClear()
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
