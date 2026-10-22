/** @vitest-environment jsdom */
/**
 * A new session must not inherit the focused session's worktree. The
 * per-project file-tree cache used to be copied onto the next session,
 * including while `clearWorktree` was still awaiting the host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { useAppStore } from '@/stores/app'
import { useDraftsStore } from '@/stores/drafts'
import { _resetDraftSessionMap, snapshotDraftSettings } from './draft-promote'

const PROJECT = '/repo'
const WORKTREE = '/repo/.wt/feat'

function seedFocusedInWorktree(): void {
  useAppStore.getState().setActiveWorktree(PROJECT, WORKTREE)
  useChatStore.setState({
    activeProject: PROJECT,
    remoteSessions: {},
    projectSessions: {
      [PROJECT]: {
        ...createDefaultProjectState(),
        _activeSessionId: 'focused',
        _sessions: {
          focused: {
            ...createDefaultPerSessionState(),
            draftText: 'keep this draft',
            cwd: WORKTREE,
            _worktreePath: WORKTREE,
            _gitBranch: 'feat',
            environmentSelection: {
              environmentId: 'local',
              selection: { kind: 'existing', path: WORKTREE, branch: 'feat' },
            },
          },
        },
      },
    },
  })
}

function expectNewSessionAtProjectRoot(): void {
  const project = useChatStore.getState().projectSessions[PROJECT]!
  const id = project._activeSessionId
  expect(id).not.toBe('focused')
  const session = project._sessions[id!]!
  expect(session.cwd).toBe(PROJECT)
  expect(session._worktreePath).toBeNull()
  expect(session._gitBranch).toBeNull()
  expect(session.environmentSelection).toEqual({
    environmentId: 'local',
    selection: { kind: 'local' },
  })
  expect(useAppStore.getState()._worktrees[PROJECT]?.activePath ?? null).toBeNull()
  expect(snapshotDraftSettings(session).worktreePath).toBeNull()
  const promoted = vi.mocked(window.environment.upsertDraft).mock.calls
    .find(([, input]) => input.originSessionId === 'focused')
  expect(promoted?.[1].settings?.worktreePath).toBe(WORKTREE)
}

beforeEach(() => {
  useAppStore.setState({ experimentalRemoteNodesEnabled: true })
  _resetDraftSessionMap()
  useDraftsStore.setState({ byConnection: {}, discardedIds: {} })
  window.environment.upsertDraft = vi.fn().mockImplementation(async (_connectionId, input) => ({
    ...input,
    title: input.text,
    createdAt: '',
    updatedAt: '',
    controllerDeviceId: null,
  }))
  window.environment.deleteDraft = vi.fn().mockResolvedValue(undefined)
  window.environment.callSession = vi.fn().mockResolvedValue(null)
  Object.assign(window.app, {
    activateWorktree: vi.fn().mockResolvedValue(undefined),
  })
  seedFocusedInWorktree()
})

describe('resetSession worktree ownership', () => {
  it('starts at the project root while the focused session is in a worktree', async () => {
    await useChatStore.getState().resetSession()
    expectNewSessionAtProjectRoot()
    expect(window.app.activateWorktree).toHaveBeenCalledWith(PROJECT, null)
  })

  it('does not keep a pending create on a pristine session', async () => {
    useAppStore.getState().setPendingWorktree(PROJECT, 'main')
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'fresh',
          _sessions: {
            fresh: {
              ...createDefaultPerSessionState(),
              cwd: PROJECT,
              environmentSelection: {
                environmentId: 'local',
                selection: { kind: 'create', baseBranch: 'main', mode: 'branch', branchName: '', carryLocalChanges: false },
              },
            },
          },
        },
      },
    })
    await useChatStore.getState().resetSession()
    const project = useChatStore.getState().projectSessions[PROJECT]!
    expect(project._activeSessionId).toBe('fresh')
    expect(Object.keys(project._sessions)).toEqual(['fresh'])
    expect(project._sessions.fresh?.environmentSelection).toEqual({
      environmentId: 'local',
      selection: { kind: 'local' },
    })
    expect(useAppStore.getState()._worktrees[PROJECT]?.pendingBaseBranch ?? null).toBeNull()
  })

  it('starts a new session when the pending create already has composer text', async () => {
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'fresh',
          _sessions: {
            fresh: {
              ...createDefaultPerSessionState(),
              cwd: PROJECT,
              draftText: 'keep this',
              environmentSelection: {
                environmentId: 'local',
                selection: { kind: 'create', baseBranch: 'main', mode: 'branch', branchName: '', carryLocalChanges: false },
              },
            },
          },
        },
      },
    })
    await useChatStore.getState().resetSession()
    const project = useChatStore.getState().projectSessions[PROJECT]!
    expect(project._activeSessionId).not.toBe('fresh')
    expect(project._sessions.fresh).toBeTruthy()
    expect(project._sessions[project._activeSessionId!]?.environmentSelection?.selection.kind).toBe('local')
  })

  it('clears a pending base branch when the selection is still local', async () => {
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'fresh',
          _sessions: {
            fresh: {
              ...createDefaultPerSessionState(),
              cwd: PROJECT,
              environmentSelection: { environmentId: 'local', selection: { kind: 'local' } },
            },
          },
        },
      },
    })
    useAppStore.getState().setPendingWorktree(PROJECT, 'develop')
    await useChatStore.getState().resetSession()
    const project = useChatStore.getState().projectSessions[PROJECT]!
    expect(project._activeSessionId).toBe('fresh')
    expect(Object.keys(project._sessions)).toEqual(['fresh'])
    expect(useAppStore.getState()._worktrees[PROJECT]?.pendingBaseBranch ?? null).toBeNull()
  })

  it('keeps a mirror pending create on a pristine session when remote nodes are off', async () => {
    useAppStore.setState({ experimentalRemoteNodesEnabled: false })
    useAppStore.getState().setPendingWorktree(PROJECT, 'main')
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'fresh',
          _sessions: {
            fresh: { ...createDefaultPerSessionState(), cwd: PROJECT },
          },
        },
      },
    })
    await useChatStore.getState().resetSession()
    const project = useChatStore.getState().projectSessions[PROJECT]!
    expect(project._activeSessionId).toBe('fresh')
    expect(useAppStore.getState()._worktrees[PROJECT]?.pendingBaseBranch).toBe('main')
    expect(project._sessions.fresh?.environmentSelection ?? null).toBeNull()
  })

  it('does not stamp a checkout when remote nodes are off', async () => {
    useAppStore.setState({ experimentalRemoteNodesEnabled: false })
    await useChatStore.getState().resetSession()
    const project = useChatStore.getState().projectSessions[PROJECT]!
    const session = project._sessions[project._activeSessionId!]!
    expect(project._activeSessionId).not.toBe('focused')
    expect(session.environmentSelection ?? null).toBeNull()
    expect(window.app.activateWorktree).toHaveBeenCalledWith(PROJECT, null)
  })

  it('starts at the project root while clearWorktree is still awaiting', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const activateWorktree = vi.fn(() => gate)
    Object.assign(window.app, { activateWorktree })

    const reset = useChatStore.getState().resetSession()
    await vi.waitFor(() => {
      expect(activateWorktree).toHaveBeenCalledWith(PROJECT, null)
    })

    expectNewSessionAtProjectRoot()

    release()
    await reset
    expectNewSessionAtProjectRoot()
  })
})
