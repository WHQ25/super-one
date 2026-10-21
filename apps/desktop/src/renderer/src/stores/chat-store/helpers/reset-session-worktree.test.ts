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
