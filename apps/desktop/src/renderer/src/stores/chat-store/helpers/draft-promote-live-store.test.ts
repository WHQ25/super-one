/** @vitest-environment jsdom */
/**
 * Draft promote/discard writing through the real chat and app stores. These
 * paths used to reach the stores through a `require` that the renderer bundle
 * cannot resolve, so they silently did nothing outside unit-test mocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { useAppStore } from '@/stores/app'
import { useDraftsStore } from '@/stores/drafts'
import {
  _resetDraftSessionMap,
  claimDraftForSession,
  discardDeletedDraft,
  promoteAllUnsentDrafts,
  promoteDraftIfUnsent,
} from './draft-promote'

beforeEach(() => {
  _resetDraftSessionMap()
  useDraftsStore.setState({ byConnection: {}, discardedIds: {} })
  window.environment.upsertDraft = vi.fn().mockImplementation(async (_connectionId, input) => ({
    ...input, title: input.text, createdAt: '', updatedAt: '', controllerDeviceId: null,
  }))
  window.environment.deleteDraft = vi.fn().mockResolvedValue(undefined)
  useAppStore.getState().setActiveWorktree('/repo', null)
  useChatStore.setState({ activeProject: '/repo', remoteSessions: {}, projectSessions: {
    '/repo': { ...createDefaultProjectState(), _activeSessionId: 'focused', _sessions: {
      focused: { ...createDefaultPerSessionState(), draftText: 'focused draft' },
      background: { ...createDefaultPerSessionState(), draftText: 'background draft' },
    } },
  } })
})

describe('promoting through the live chat store', () => {
  it('stamps the saved draft id onto the session it came from', async () => {
    await promoteDraftIfUnsent(useChatStore.getState(), '/repo', 'focused')
    const draftId = vi.mocked(window.environment.upsertDraft).mock.calls[0][1].id
    expect(useChatStore.getState().projectSessions['/repo']._sessions.focused.draftId).toBe(draftId)
  })

  it('records the focused session worktree only on the focused draft', async () => {
    useAppStore.getState().setActiveWorktree('/repo', '/repo/.wt/other')
    useChatStore.setState((s) => ({
      projectSessions: {
        '/repo': {
          ...s.projectSessions['/repo']!,
          _sessions: {
            ...s.projectSessions['/repo']!._sessions,
            focused: {
              ...s.projectSessions['/repo']!._sessions.focused!,
              _worktreePath: '/repo/.wt/feat',
              environmentSelection: {
                environmentId: 'local',
                selection: { kind: 'existing', path: '/repo/.wt/feat', branch: 'feat' },
              },
            },
          },
        },
      },
    }))
    await promoteAllUnsentDrafts(useChatStore.getState())
    const saved = Object.fromEntries(vi.mocked(window.environment.upsertDraft).mock.calls
      .map(([, input]) => [input.originSessionId, input.settings?.worktreePath]))
    expect(saved).toEqual({ focused: '/repo/.wt/feat', background: null })
  })

  it('does not copy the project mirror onto a session that has no worktree', async () => {
    useAppStore.getState().setActiveWorktree('/repo', '/repo/.wt/feat')
    await promoteAllUnsentDrafts(useChatStore.getState())
    const saved = Object.fromEntries(vi.mocked(window.environment.upsertDraft).mock.calls
      .map(([, input]) => [input.originSessionId, input.settings?.worktreePath]))
    expect(saved).toEqual({ focused: null, background: null })
  })
})

describe('deleting a draft from the sidebar', () => {
  it('clears the focused composer and drops a background session holding the draft', () => {
    claimDraftForSession('focused', 'draft-focused')
    claimDraftForSession('background', 'draft-background')
    discardDeletedDraft('draft-focused')
    discardDeletedDraft('draft-background')
    const sessions = useChatStore.getState().projectSessions['/repo']._sessions
    expect(sessions.focused).toMatchObject({ draftText: '', draftId: null })
    expect(sessions.background).toBeUndefined()
  })
})
