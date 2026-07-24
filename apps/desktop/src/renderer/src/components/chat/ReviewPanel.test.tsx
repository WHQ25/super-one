/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startCodexReview: vi.fn(),
  setShowReviewPanel: vi.fn(),
  getGitBranches: vi.fn(),
  getGitInfo: vi.fn(),
  getGitLog: vi.fn(),
  storeState: {
    activeProject: '/project',
    projectSessions: {
      '/project': { reviewPanelInitialMode: 'branch' },
    },
  },
  sessionState: {
    cwd: '/project',
    _worktreePath: '/project/.worktrees/feature',
  },
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof mocks.storeState & {
    startCodexReview: typeof mocks.startCodexReview
    setShowReviewPanel: typeof mocks.setShowReviewPanel
  }) => unknown) => selector({
    ...mocks.storeState,
    startCodexReview: mocks.startCodexReview,
    setShowReviewPanel: mocks.setShowReviewPanel,
  }),
  useActiveSession: (selector: (state: typeof mocks.sessionState) => unknown) => selector(mocks.sessionState),
}))

import { ReviewPanel } from './ReviewPanel'

describe('ReviewPanel', () => {
  beforeEach(() => {
    mocks.startCodexReview.mockReset()
    mocks.setShowReviewPanel.mockReset()
    mocks.getGitBranches.mockReset().mockResolvedValue(['feature/current', 'main'])
    mocks.getGitInfo.mockReset().mockResolvedValue({ branch: 'feature/current' })
    mocks.getGitLog.mockReset().mockResolvedValue([])
    Object.assign(window, {
      app: {
        getGitBranches: mocks.getGitBranches,
        getGitInfo: mocks.getGitInfo,
        getGitLog: mocks.getGitLog,
      },
    })
  })

  it('passes the selected base branch to Codex review', async () => {
    render(<ReviewPanel />)

    const branch = await screen.findByRole('button', { name: /main/ })
    expect(screen.queryByRole('button', { name: /feature\/current/ })).toBeNull()
    expect(mocks.getGitBranches).toHaveBeenCalledWith('/project/.worktrees/feature')

    fireEvent.mouseDown(branch)

    await waitFor(() => {
      expect(mocks.startCodexReview).toHaveBeenCalledWith({ type: 'baseBranch', branch: 'main' })
    })
  })
})
