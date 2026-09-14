/** @vitest-environment jsdom */

/**
 * Regression: a session working in a detached worktree that commits and then
 * runs `git switch -c feat/x` kept showing "Worktree <sha>" after the turn.
 * The dirty dot refreshed at the turn boundary but the entry list that decides
 * detached-vs-branch was only read on mount / popover open, and the HEAD
 * watcher never fires for a worktree living outside the project folder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { AgentStatus, WorktreeInfo } from '@superone/shared/agent-types'

import { WorkDirIndicator } from './WorkDirIndicator'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

const PROJECT = '/proj'
const WT_PATH = '/home/me/.worktrees/proj/1700000000-abc'
const HEAD = 'abc1234deadbeef'

function worktreeInfo(branch: string): WorktreeInfo {
  return {
    isWorktree: false,
    currentBranch: 'main',
    entries: [
      { path: PROJECT, branch: 'main', head: HEAD, isMain: true, isCurrent: true },
      { path: WT_PATH, branch, head: HEAD, isMain: false, isCurrent: false },
    ],
  }
}

function setSessionStatus(status: AgentStatus): void {
  useChatStore.setState((s) => {
    const project = s.projectSessions[PROJECT]
    const sid = project?._activeSessionId
    const session = sid ? project._sessions[sid] : undefined
    if (!project || !sid || !session) return s
    return {
      projectSessions: {
        ...s.projectSessions,
        [PROJECT]: { ...project, _sessions: { ...project._sessions, [sid]: { ...session, status } } },
      },
    }
  })
}

const getWorktreeInfo = vi.fn<(folder: string) => Promise<WorktreeInfo>>()
const getGitInfo = vi.fn(() => Promise.resolve({ branch: 'HEAD' }))

beforeEach(() => {
  getWorktreeInfo.mockReset()
  getGitInfo.mockClear()
  Object.assign(window.app, { getWorktreeInfo, getGitInfo })
  useChatStore.getState().ensureSession(PROJECT)
  useChatStore.setState({ activeProject: PROJECT })
  useAppStore.setState({
    currentFolder: PROJECT,
    _worktrees: {
      [PROJECT]: {
        pendingBaseBranch: null,
        pendingMode: 'branch',
        pendingBranchName: '',
        pendingCarryLocalChanges: false,
        activePath: WT_PATH,
      },
    },
  })
})

afterEach(() => {
  cleanup()
})

describe('WorkDirIndicator turn-boundary refresh', () => {
  it('re-reads worktree entries when a turn ends so an attached branch replaces the detached label', async () => {
    // Mount: detached. After the turn: the agent attached feat/x.
    getWorktreeInfo
      .mockResolvedValueOnce(worktreeInfo(''))
      .mockResolvedValue(worktreeInfo('feat/x'))

    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(screen.getByTitle('Worktree abc1234')).toBeTruthy())
    expect(getWorktreeInfo).toHaveBeenCalledTimes(1)

    act(() => setSessionStatus('streaming'))
    act(() => setSessionStatus('idle'))

    await waitFor(() => expect(screen.getByTitle('Worktree feat/x')).toBeTruthy())
    expect(getWorktreeInfo).toHaveBeenCalledTimes(2)
    expect(getWorktreeInfo).toHaveBeenLastCalledWith(PROJECT)
  })

  it('does not re-read entries while the turn is still streaming', async () => {
    getWorktreeInfo.mockResolvedValue(worktreeInfo(''))
    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(screen.getByTitle('Worktree abc1234')).toBeTruthy())

    act(() => setSessionStatus('streaming'))

    expect(getWorktreeInfo).toHaveBeenCalledTimes(1)
  })
})
