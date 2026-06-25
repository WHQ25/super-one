/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const PROJECT = '/Users/me/proj'
const WORKTREE = '/Users/me/proj-wt-feature'

const resumeSession = vi.fn(async (_project: string, _sessionId: string, _cwd?: string) => null)

const appOverrides: Record<string, unknown> = {
  resumeSession,
  pathExists: async () => true,
  listDir: async () => [],
  trace: () => {},
}
;(window as unknown as { app: unknown }).app = new Proxy(appOverrides, {
  get: (target, prop: string) => (prop in target ? target[prop] : () => Promise.resolve(undefined)),
})
;(window as unknown as { agent: unknown }).agent = new Proxy({}, { get: () => () => Promise.resolve(undefined) })

const { useChatStore } = await import('../../renderer/src/stores/chat')
const { useAppStore } = await import('../../renderer/src/stores/app')
const { createDefaultPerSessionState, createDefaultProjectState } = await import(
  '../../renderer/src/stores/chat-store/defaults'
)

// Project P is open on a worktree session (`wt`), so the file tree's activePath
// points at the worktree. A plain session (`plain`) lives in the main repo — it has
// a git branch recorded but no worktree.
function seed(): void {
  const wtSession = createDefaultPerSessionState()
  wtSession.cwd = WORKTREE
  wtSession._worktreePath = WORKTREE
  wtSession._worktreeBaseBranch = 'feature'

  const plainSession = createDefaultPerSessionState()
  plainSession.cwd = PROJECT
  plainSession._worktreePath = null
  plainSession._worktreeRemoved = false
  // `_worktreeBaseBranch` is misnamed — it carries the session's git branch, which
  // every in-repo session has, worktree or not.
  plainSession._worktreeBaseBranch = 'main'

  useChatStore.setState({
    activeProject: PROJECT,
    projectSessions: {
      [PROJECT]: {
        ...createDefaultProjectState(),
        _activeSessionId: 'wt',
        _sessions: { wt: wtSession, plain: plainSession },
      },
    },
  })
  useAppStore.getState().setActiveWorktree(PROJECT, WORKTREE)
}

describe('switchSession worktree root sync', () => {
  beforeEach(() => {
    resumeSession.mockClear()
    seed()
  })

  it('clears the stale worktree root when switching to a non-worktree session that has a git branch', async () => {
    expect(useAppStore.getState()._worktrees[PROJECT]?.activePath).toBe(WORKTREE)

    await useChatStore.getState().switchSession('plain')

    // The target has no worktree, so the file tree must drop back to the project root.
    // The pre-fix `else if (!_worktreeBaseBranch || _worktreeRemoved)` never fires for an
    // in-repo session (it always has a branch), leaving activePath stuck on the worktree.
    expect(useAppStore.getState()._worktrees[PROJECT]?.activePath).toBe(null)
  })
})
