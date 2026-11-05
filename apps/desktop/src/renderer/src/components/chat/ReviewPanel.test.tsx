/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateRemoteSession } from '@/lib/remote-session-ops'
import { useChatStore } from '@/stores/chat'
import type { PerSessionState } from '@/stores/chat-store/types'
import { ReviewPanel } from './ReviewPanel'

const LOCAL_PROJECT = '/project'
const LOCAL_WORKTREE = '/project/.worktrees/feature'
const REMOTE_PROJECT = 'remote:office:/srv/app'
const NODE_WORKTREE = '/home/node/.worktrees/app/task-7af08a26'
const REMOTE_WORKTREE = `remote:office:${NODE_WORKTREE}`
const COMMIT = { sha: 'abc123456789', message: 'Fix the node worktree' }
const getGitBranches = vi.fn()
const getGitInfo = vi.fn()
const getGitLog = vi.fn()
const listGitMentionRefs = vi.fn<typeof window.app.listGitMentionRefs>()
const startCodexReview = vi.fn()
const getSession = vi.fn()
const openRemoteSession = vi.fn()
const initialState = useChatStore.getState()

function seedSession(project: string, session: Partial<PerSessionState> = {}, mode: 'branch' | 'commit' = 'branch'): void {
  useChatStore.getState().ensureSession(project)
  useChatStore.setState((state) => {
    const projectState = state.projectSessions[project]
    const sid = projectState._activeSessionId!
    return {
      activeProject: project,
      startCodexReview,
      projectSessions: {
        ...state.projectSessions,
        [project]: {
          ...projectState,
          reviewPanelInitialMode: mode,
          _sessions: {
            ...projectState._sessions,
            [sid]: {
              ...projectState._sessions[sid],
              ...session,
            },
          },
        },
      },
    }
  })
}

beforeEach(() => {
  startCodexReview.mockReset()
  getGitBranches.mockReset().mockResolvedValue(['feature/current', 'main'])
  getGitInfo.mockReset().mockResolvedValue({ branch: 'feature/current' })
  // The legacy log IPC only runs on the controller; it cannot serve node keys.
  getGitLog.mockReset().mockImplementation(async (path: string) => path.startsWith('remote:') ? [] : [COMMIT])
  listGitMentionRefs.mockReset().mockResolvedValue({
    ok: true, refs: [{ kind: 'commit', id: COMMIT.sha, label: COMMIT.sha.slice(0, 7), detail: COMMIT.message }],
  })
  Object.assign(window.app, { getGitBranches, getGitInfo, getGitLog, listGitMentionRefs })
  getSession.mockReset().mockResolvedValue({ sessionId: 'node-session', harnessId: 'claude', cwd: NODE_WORKTREE })
  openRemoteSession.mockReset().mockResolvedValue({ sessionId: 'node-session', state: {}, messages: [], before: null })
  Object.assign(window.environment, { getSession, openRemoteSession })
})

afterEach(() => {
  cleanup()
  useChatStore.setState(initialState, true)
  vi.restoreAllMocks()
})

describe('ReviewPanel Git routing', () => {
  it.each([
    ['local worktree', LOCAL_PROJECT, { cwd: LOCAL_PROJECT, _worktreePath: LOCAL_WORKTREE }, LOCAL_WORKTREE],
    ['local cwd', LOCAL_PROJECT, { cwd: LOCAL_WORKTREE }, LOCAL_WORKTREE],
    ['local project fallback', LOCAL_PROJECT, {}, LOCAL_PROJECT],
    ['remote worktree', REMOTE_PROJECT, { cwd: '/srv/app', _worktreePath: NODE_WORKTREE }, REMOTE_WORKTREE],
    ['remote cwd', REMOTE_PROJECT, { cwd: NODE_WORKTREE }, REMOTE_WORKTREE],
    ['remote project root', REMOTE_PROJECT, { cwd: '/srv/app/' }, REMOTE_PROJECT],
    ['remote project fallback', REMOTE_PROJECT, {}, REMOTE_PROJECT],
    ['already routed remote worktree', REMOTE_PROJECT, { _worktreePath: REMOTE_WORKTREE }, REMOTE_WORKTREE],
  ] as const)('shows branches and commits from the %s', async (_name, project, session, path) => {
    seedSession(project, session)
    // Simulate the IPC boundary: only the correctly routed path has these refs.
    getGitBranches.mockImplementation(async (requested: string) => requested === path ? ['feature/current', 'main'] : [])
    getGitInfo.mockImplementation(async (requested: string) => requested === path ? { branch: 'feature/current' } : null)
    listGitMentionRefs.mockImplementation(async (requested: string) => ({
      ok: true as const,
      refs: requested === path ? [{ kind: 'commit', id: COMMIT.sha, label: COMMIT.sha.slice(0, 7), detail: COMMIT.message }] : [],
    }))

    render(<ReviewPanel />)

    const branch = await screen.findByRole('button', { name: 'main' })
    expect(screen.queryByRole('button', { name: 'feature/current' })).toBeNull()
    expect(getGitBranches).toHaveBeenCalledWith(path)
    expect(getGitInfo).toHaveBeenCalledWith(path)
    fireEvent.mouseDown(branch)
    expect(startCodexReview).toHaveBeenCalledWith({ type: 'baseBranch', branch: 'main' })

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Specific Commit' }))
    const commit = await screen.findByRole('button', { name: /Fix the node worktree/ })
    expect(listGitMentionRefs).toHaveBeenCalledWith(path, 'commit', '')
    fireEvent.mouseDown(commit)
    expect(startCodexReview).toHaveBeenCalledWith({ type: 'commit', sha: COMMIT.sha, title: COMMIT.message })
  })

  it.each(['branch', 'commit'] as const)('routes the initial %s list after adopting a remote worktree session', async (mode) => {
    const { hydrated } = await hydrateRemoteSession(REMOTE_PROJECT, 'node-session', null, { adoptSession: true })
    expect(hydrated._worktreePath).toBe(NODE_WORKTREE)
    seedSession(REMOTE_PROJECT, hydrated, mode)

    render(<ReviewPanel />)

    if (mode === 'branch') {
      await screen.findByRole('button', { name: 'main' })
      expect(getGitBranches).toHaveBeenCalledWith(REMOTE_WORKTREE)
      expect(getGitInfo).toHaveBeenCalledWith(REMOTE_WORKTREE)
    } else {
      await screen.findByRole('button', { name: /Fix the node worktree/ })
      expect(listGitMentionRefs).toHaveBeenCalledWith(REMOTE_WORKTREE, 'commit', '')
    }
    for (const read of [getGitBranches, getGitInfo, getGitLog]) {
      expect(read).not.toHaveBeenCalledWith(NODE_WORKTREE)
    }
    expect(listGitMentionRefs).not.toHaveBeenCalledWith(NODE_WORKTREE, 'commit', '')
  })

  it.each(['branch', 'commit'] as const)('refreshes the %s list when the active remote worktree changes', async (mode) => {
    seedSession(REMOTE_PROJECT, { cwd: NODE_WORKTREE })
    render(<ReviewPanel />)
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(REMOTE_WORKTREE))
    if (mode === 'commit') {
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Specific Commit' }))
      await screen.findByRole('button', { name: /Fix the node worktree/ })
    }

    act(() => seedSession(REMOTE_PROJECT, { cwd: NODE_WORKTREE, _worktreePath: '/home/node/.worktrees/app/second' }))
    const nextPath = 'remote:office:/home/node/.worktrees/app/second'
    if (mode === 'branch') {
      await waitFor(() => expect(getGitBranches).toHaveBeenCalledWith(nextPath))
      expect(getGitInfo).toHaveBeenCalledWith(nextPath)
    } else {
      await waitFor(() => expect(listGitMentionRefs).toHaveBeenCalledWith(nextPath, 'commit', ''))
    }
  })

  it.each(['empty', 'unsupported', 'disconnected'] as const)('shows an empty commit list when the node is %s', async (state) => {
    seedSession(REMOTE_PROJECT, { cwd: NODE_WORKTREE }, 'commit')
    if (state === 'disconnected') listGitMentionRefs.mockRejectedValue(new Error('Node disconnected'))
    else listGitMentionRefs.mockResolvedValue(state === 'empty' ? { ok: true, refs: [] } : { ok: false, reason: 'unsupported' })

    render(<ReviewPanel />)

    await screen.findByText('No commits found')
    expect(listGitMentionRefs).toHaveBeenCalledWith(REMOTE_WORKTREE, 'commit', '')
    expect(getGitLog).not.toHaveBeenCalled()
  })
})
