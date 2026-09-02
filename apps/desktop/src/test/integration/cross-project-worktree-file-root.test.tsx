/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const PROJECT_A = '/Users/me/proj-a'
const PROJECT_B = '/Users/me/proj-b'
const WORKTREE_B = '/Users/me/proj-b-wt-feature'

const resumeSession = vi.fn(async (_project: string, _sessionId: string, _cwd?: string) => null)

const appOverrides: Record<string, unknown> = {
  openFolder: async () => true,
  getRecentFolders: async () => [],
  resumeSession,
  loadSessionState: async () => null,
  listDir: async () => [],
  worktreeExists: async () => true,
  getProjectId: async () => 'pid-b',
  trace: () => {},
}
;(window as unknown as { app: unknown }).app = new Proxy(appOverrides, {
  get: (target, prop: string) => (prop in target ? target[prop] : () => Promise.resolve(undefined)),
})
;(window as unknown as { agent: unknown }).agent = new Proxy({}, { get: () => () => Promise.resolve(undefined) })

const { useChatStore } = await import('../../renderer/src/stores/chat')
const { useAppStore, selectEffectiveProjectRoot } = await import('../../renderer/src/stores/app')
const { createDefaultPerSessionState, createDefaultProjectState } = await import(
  '../../renderer/src/stores/chat-store/defaults'
)

// Cold start: app just launched, _worktrees is empty, and project B's persisted
// active session (`bw`) lives in a worktree. The user is currently in project A.
function seedColdStart(): void {
  const aSession = createDefaultPerSessionState()
  aSession.cwd = PROJECT_A

  const bWorktreeSession = createDefaultPerSessionState()
  bWorktreeSession.cwd = WORKTREE_B
  bWorktreeSession._worktreePath = WORKTREE_B
  bWorktreeSession._worktreeRemoved = false

  useChatStore.setState({
    activeProject: PROJECT_A,
    projectSessions: {
      [PROJECT_A]: { ...createDefaultProjectState(), _activeSessionId: 'a1', _sessions: { a1: aSession } },
      [PROJECT_B]: { ...createDefaultProjectState(), _activeSessionId: 'bw', _sessions: { bw: bWorktreeSession } },
    },
  })
  useAppStore.setState({ currentFolder: PROJECT_A, _worktrees: {}, view: 'main' })
}

describe('cross-project switch to a worktree session', () => {
  beforeEach(() => {
    resumeSession.mockClear()
    seedColdStart()
  })

  it('syncs the file-tree worktree root when the clicked session is already the destination project active session', async () => {
    await useChatStore.getState().switchToSession(PROJECT_B, 'bw')

    // Main-process side is correct: the session resumes in the worktree (cf. b2854ff3).
    expect(resumeSession).toHaveBeenCalledWith(PROJECT_B, 'bw', WORKTREE_B)

    // The mirror reliably moves currentFolder onto the destination project.
    useAppStore.setState({ currentFolder: PROJECT_B })

    // Bug: switchToSession skipped switchSession because `bw` was already project B's
    // active session, and focusProjectImpl never calls setActiveWorktree — so the
    // renderer's worktree root is never synced. The file tree resolves to the project
    // root instead of the worktree, disagreeing with the main-process cwd above.
    expect(useAppStore.getState()._worktrees[PROJECT_B]?.activePath).toBe(WORKTREE_B)
    expect(selectEffectiveProjectRoot(useAppStore.getState())).toBe(WORKTREE_B)
  })
})
