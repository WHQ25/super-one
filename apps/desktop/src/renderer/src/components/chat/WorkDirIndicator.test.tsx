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
import userEvent from '@testing-library/user-event'
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
    await waitFor(() => expect(screen.getByTitle('This PC · abc1234')).toBeTruthy())
    expect(getWorktreeInfo).toHaveBeenCalledTimes(1)

    act(() => setSessionStatus('streaming'))
    act(() => setSessionStatus('idle'))

    await waitFor(() => expect(screen.getByTitle('This PC · feat/x')).toBeTruthy())
    expect(getWorktreeInfo).toHaveBeenCalledTimes(2)
    expect(getWorktreeInfo).toHaveBeenLastCalledWith(PROJECT)
  })

  it('does not re-read entries while the turn is still streaming', async () => {
    getWorktreeInfo.mockResolvedValue(worktreeInfo(''))
    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(screen.getByTitle('This PC · abc1234')).toBeTruthy())

    act(() => setSessionStatus('streaming'))

    expect(getWorktreeInfo).toHaveBeenCalledTimes(1)
  })
})

describe('merged status chip', () => {
  const localMirror = {
    pendingBaseBranch: null,
    pendingMode: 'branch' as const,
    pendingBranchName: '',
    pendingCarryLocalChanges: false,
    activePath: null,
  }

  beforeEach(() => {
    getWorktreeInfo.mockResolvedValue({
      isWorktree: false,
      currentBranch: 'main',
      entries: [{ path: PROJECT, branch: 'main', head: HEAD, isMain: true, isCurrent: true }],
    })
    useAppStore.setState({
      currentFolder: PROJECT,
      _worktrees: { [PROJECT]: localMirror },
    })
  })

  it('names the checkout branch on the only chip', async () => {
    getGitInfo.mockResolvedValue({ branch: 'main' })
    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(screen.getByTitle('This PC · main')).toBeTruthy())
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('names a pending worktree on that same chip', async () => {
    useAppStore.setState({
      currentFolder: PROJECT,
      _worktrees: {
        [PROJECT]: { ...localMirror, pendingBaseBranch: 'origin/release/1.8', pendingMode: 'detach' },
      },
    })
    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(screen.getByTitle('This PC · New Worktree ← origin/release/1.8')).toBeTruthy())
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('says git is not initialized when the folder is not a repository', () => {
    render(<WorkDirIndicator isGitRepo={false} />)
    expect(screen.getByTitle('This PC · Git Not Initialized')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('opens on checkout and worktree tabs, and checkout clears a pending worktree', async () => {
    getGitInfo.mockResolvedValue({ branch: 'main' })
    useAppStore.setState({
      currentFolder: PROJECT,
      _worktrees: {
        [PROJECT]: { ...localMirror, pendingBaseBranch: 'origin/release/1.8', pendingMode: 'detach' },
      },
    })
    const user = userEvent.setup()
    render(<WorkDirIndicator isGitRepo />)
    await waitFor(() => expect(screen.getByTitle('This PC · New Worktree ← origin/release/1.8')).toBeTruthy())

    await user.click(screen.getByRole('button'))
    const checkout = await screen.findByRole('tab', { name: 'Local' })
    expect(screen.getByRole('tab', { name: 'Worktree' })).toBeTruthy()
    expect(checkout.getAttribute('data-state')).toBe('inactive')

    await user.click(checkout)
    await waitFor(() => expect(screen.getByTitle('This PC · main')).toBeTruthy())
    expect(checkout.getAttribute('data-state')).toBe('active')
  })

  it('keeps the environment row, search, branch create, and worktree detach', async () => {
    const getGitBranches = vi.fn(() => Promise.resolve({ local: ['main', 'develop'], tracking: ['origin/main'] }))
    const getCheckedOutBranches = vi.fn(() => Promise.resolve(['main']))
    Object.assign(window.app, { getGitBranches, getCheckedOutBranches })
    getGitInfo.mockResolvedValue({ branch: 'main' })
    const user = userEvent.setup()
    render(<WorkDirIndicator isGitRepo />)
    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('Environment')).toBeNull()
    expect(screen.queryByText('Checkout')).toBeNull()
    const search = screen.getByPlaceholderText('Search or create branch…')
    await user.type(search, 'feat/new')
    expect(screen.getByRole('button', { name: 'Create branch: feat/new' })).toBeTruthy()
    await user.clear(search)

    await user.click(screen.getByRole('tab', { name: 'Worktree' }))
    expect(screen.getByPlaceholderText('Search worktrees…')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'develop' }))
    expect(screen.getByRole('button', { name: 'Detach' })).toBeTruthy()
    expect(screen.getByText('New branch name')).toBeTruthy()

    expect(document.querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Local' })).toBeTruthy()
  })
})
