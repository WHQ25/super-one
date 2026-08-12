/**
 * Which unsent composers become drafts when the user navigates away, and where
 * those drafts are addressed to. The narrow scope is the point: a session that
 * already exists on a host keeps its own draftText and must never leak into the
 * environment drafts group.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftUpsertRequest } from '@superone/shared/environment'

const saveDraft = vi.fn<(connectionId: string, draft: DraftUpsertRequest) => Promise<void>>()
const removeDraft = vi.fn<(connectionId: string, draftId: string) => Promise<void>>()
vi.mock('../../drafts', () => ({
  useDraftsStore: { getState: () => ({ saveDraft, removeDraft }) },
}))

import type { ChatStore, PerSessionState } from '../types'
import {
  _resetDraftSessionMap,
  applyCarriedDraft,
  captureOpenDraft,
  claimDraftForSession,
  consumeDraftForSession,
  getDraftIdForSession,
  getParkedDraft,
  isDraftOwnedBySession,
  isUnsentSession,
  promoteAllUnsentDrafts,
  promoteDraftIfUnsent,
  resolveDraftTarget,
  sessionFieldsFromSettings,
  snapshotDraftSettings,
} from './draft-promote'

/**
 * Built by hand rather than from createDefaultPerSessionState: importing
 * defaults here loads chat-store/index first and trips its module cycle.
 * Only the fields the promote path reads matter.
 */
function session(overrides?: Partial<PerSessionState>): PerSessionState {
  return {
    messages: [],
    status: 'idle',
    pendingPermissions: [],
    pendingQuestion: null,
    pendingPlanApproval: null,
    awaitingAssistantReply: false,
    draftText: '',
    draftJson: null,
    attachments: [],
    sessionProvider: null,
    preferredProvider: 'claude',
    selectedModel: '',
    permissionMode: 'default',
    ...overrides,
  } as unknown as PerSessionState
}

function storeWith(overrides: Partial<PerSessionState>, projectPath = '/repo'): ChatStore {
  return {
    projectSessions: {
      [projectPath]: { _activeSessionId: 'sid-1', _sessions: { 'sid-1': session(overrides) } },
    },
  } as unknown as ChatStore
}

beforeEach(() => {
  saveDraft.mockReset()
  saveDraft.mockResolvedValue(undefined)
  removeDraft.mockReset()
  removeDraft.mockResolvedValue(undefined)
  _resetDraftSessionMap()
})

describe('unsent session detection', () => {
  it('treats a composer with no messages and no live backend as unsent', () => {
    expect(isUnsentSession(session())).toBe(true)
  })

  it('does not treat a session that already has messages as unsent', () => {
    expect(isUnsentSession(session({ messages: [{ id: 'm1' }] as never[] }))).toBe(false)
  })
})

describe('promoting a draft on navigate away', () => {
  it('saves the composer text and full new-session config when leaving an unsent session', async () => {
    await promoteDraftIfUnsent(
      storeWith({
        draftText: 'look into the ACK bug',
        preferredProvider: 'codex',
        sessionProvider: 'codex',
        selectedCodexModel: 'gpt-5.1',
        selectedCodexReasoningEffort: 'high',
        selectedCodexPermissionPreset: 'full-access',
        permissionMode: 'plan',
        _worktreePath: '/repo/.wt/feat',
        _gitBranch: 'feat/ack',
      }),
      '/repo',
      'sid-1',
    )
    expect(saveDraft).toHaveBeenCalledTimes(1)
    const [connectionId, draft] = saveDraft.mock.calls[0]
    expect(connectionId).toBe('local')
    expect(draft.text).toBe('look into the ACK bug')
    expect(draft.projectPath).toBe('/repo')
    expect(draft.originSessionId).toBe('sid-1')
    expect(draft.harness).toBe('codex')
    expect(draft.settings?.codexModel).toBe('gpt-5.1')
    expect(draft.settings?.codexReasoningEffort).toBe('high')
    expect(draft.settings?.worktreePath).toBe('/repo/.wt/feat')
    expect(draft.settings?.gitBranch).toBe('feat/ack')
    expect(draft.settings?.permissionMode).toBe('plan')
    const parked = getParkedDraft(draft.id)
    expect(parked?.session.sessionProvider).toBe('codex')
    expect(parked?.session.selectedCodexModel).toBe('gpt-5.1')
    expect(parked?.session.permissionMode).toBe('plan')
    expect(parked?.session._worktreePath).toBe('/repo/.wt/feat')
  })

  it('leaves a session that already sent messages alone, so its draft stays with the conversation', async () => {
    const store = storeWith({ draftText: 'follow-up question', messages: [{ id: 'm1' }] as never[] })
    await promoteDraftIfUnsent(store, '/repo', 'sid-1')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('ignores an empty or whitespace-only composer', async () => {
    await promoteDraftIfUnsent(storeWith({ draftText: '   \n ' }), '/repo', 'sid-1')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('reuses one draft id across repeated switches away from the same session', async () => {
    await promoteDraftIfUnsent(storeWith({ draftText: 'first pass' }), '/repo', 'sid-1')
    await promoteDraftIfUnsent(storeWith({ draftText: 'second pass' }), '/repo', 'sid-1')
    expect(saveDraft).toHaveBeenCalledTimes(2)
    expect(saveDraft.mock.calls[0][1].id).toBe(saveDraft.mock.calls[1][1].id)
    expect(saveDraft.mock.calls[1][1].text).toBe('second pass')
  })

  it('addresses a remote project draft to its node using the host-side path', async () => {
    const key = 'remote:mac-mini:/srv/api'
    await promoteDraftIfUnsent(storeWith({ draftText: 'restart the worker' }, key), key, 'sid-1')
    const [connectionId, draft] = saveDraft.mock.calls[0]
    expect(connectionId).toBe('mac-mini')
    // The node stores its own absolute path, never the renderer composite key.
    expect(draft.projectPath).toBe('/srv/api')
  })

  it('never lets a persistence failure block the navigation', async () => {
    saveDraft.mockRejectedValue(new Error('node unreachable'))
    await expect(
      promoteDraftIfUnsent(storeWith({ draftText: 'offline note' }), '/repo', 'sid-1'),
    ).resolves.toBeUndefined()
  })
})

describe('draft target resolution', () => {
  it('maps a local path to the local environment', () => {
    expect(resolveDraftTarget('/repo')).toEqual({ connectionId: 'local', projectPath: '/repo' })
  })

  it('splits a remote project key into its connection and host path', () => {
    expect(resolveDraftTarget('remote:gpu-box:/data/train')).toEqual({
      connectionId: 'gpu-box',
      projectPath: '/data/train',
    })
  })
})

describe('flushing every unsent composer', () => {
  it('promotes every project that still holds typed text, skipping empties', async () => {
    const store = {
      projectSessions: {
        '/a': {
          _activeSessionId: 's1',
          _sessions: {
            s1: session({ draftText: 'from a' }),
            s2: session({ draftText: '' }),
          },
        },
        '/b': {
          _activeSessionId: 's3',
          _sessions: {
            s3: session({ draftText: 'from b' }),
          },
        },
      },
    } as unknown as ChatStore
    await promoteAllUnsentDrafts(store)
    expect(saveDraft).toHaveBeenCalledTimes(2)
    const texts = saveDraft.mock.calls.map(([, d]) => d.text).sort()
    expect(texts).toEqual(['from a', 'from b'])
  })
})

describe('carrying a draft across projects', () => {
  it('captures an open unsent draft and re-applies text + config with the same draft id', () => {
    claimDraftForSession('sid-from', 'draft-stable')
    const store = {
      projectSessions: {
        '/from': {
          _activeSessionId: 'sid-from',
          sandboxInfo: { enabled: true, autoAllowBash: true },
          _sessions: {
            'sid-from': session({
              draftText: 'portable idea',
              preferredProvider: 'claude',
              sessionProvider: 'claude',
              selectedModel: 'opus',
              selectedEffort: 'high',
              permissionMode: 'acceptEdits',
              _gitBranch: 'main',
            }),
          },
        },
        '/to': {
          _activeSessionId: 'sid-to',
          sandboxInfo: { enabled: false, autoAllowBash: false },
          _sessions: { 'sid-to': session({ draftText: '' }) },
        },
      },
    } as unknown as ChatStore

    const carried = captureOpenDraft(store, '/from', 'sid-from')
    expect(carried?.draftId).toBe('draft-stable')
    expect(carried?.text).toBe('portable idea')
    expect(carried?.settings.model).toBe('opus')
    expect(carried?.settings.sandboxEnabled).toBe(true)

    let state = store
    const set = (partial: Partial<ChatStore> | ((s: ChatStore) => Partial<ChatStore>)) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = {
        ...state,
        ...patch,
        projectSessions: patch.projectSessions ?? state.projectSessions,
      }
    }

    const toSid = applyCarriedDraft(set, '/to', carried!)
    expect(toSid).toBe('sid-to')
    const dest = state.projectSessions['/to']._sessions['sid-to']
    expect(dest.draftText).toBe('portable idea')
    expect(dest.draftId).toBe('draft-stable')
    expect(dest.selectedModel).toBe('opus')
    expect(dest.selectedEffort).toBe('high')
    expect(dest.permissionMode).toBe('acceptEdits')
    expect(state.projectSessions['/to'].sandboxInfo).toEqual({ enabled: true, autoAllowBash: true })
    expect(state.projectSessions['/from']._sessions['sid-from'].draftText).toBe('')
    expect(getDraftIdForSession('sid-to')).toBe('draft-stable')
    expect(getDraftIdForSession('sid-from')).toBeUndefined()
  })

  it('mints a destination session when the target is already a real conversation', () => {
    const store = {
      projectSessions: {
        '/from': {
          _activeSessionId: 'sid-from',
          _sessions: { 'sid-from': session({ draftText: 'keep me' }) },
        },
        '/to': {
          _activeSessionId: 'sid-busy',
          _sessions: {
            'sid-busy': session({ draftText: '', messages: [{ id: 'm1' }] as never[] }),
          },
        },
      },
    } as unknown as ChatStore

    const carried = captureOpenDraft(store, '/from', 'sid-from')!
    let state = store
    const set = (partial: Partial<ChatStore> | ((s: ChatStore) => Partial<ChatStore>)) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = {
        ...state,
        ...patch,
        projectSessions: patch.projectSessions ?? state.projectSessions,
      }
    }

    const toSid = applyCarriedDraft(set, '/to', carried)
    expect(toSid).not.toBe('sid-busy')
    expect(state.projectSessions['/to']._activeSessionId).toBe(toSid)
    expect(state.projectSessions['/to']._sessions[toSid].draftText).toBe('keep me')
    expect(state.projectSessions['/to']._sessions[toSid].messages).toEqual([])
  })

  it('drops a project-scoped worktree when the draft lands on another project', () => {
    const store = {
      projectSessions: {
        '/from': {
          _activeSessionId: 'sid-from',
          _sessions: {
            'sid-from': session({
              draftText: 'move me',
              _worktreePath: '/from/.wt/feat',
              _gitBranch: 'feat/x',
            }),
          },
        },
        '/to': {
          _activeSessionId: 'sid-to',
          _sessions: { 'sid-to': session({ draftText: '' }) },
        },
      },
    } as unknown as ChatStore

    const carried = captureOpenDraft(store, '/from', 'sid-from')!
    expect(carried.settings.worktreePath).toBe('/from/.wt/feat')

    let state = store
    const set = (partial: Partial<ChatStore> | ((s: ChatStore) => Partial<ChatStore>)) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = {
        ...state,
        ...patch,
        projectSessions: patch.projectSessions ?? state.projectSessions,
      }
    }

    applyCarriedDraft(set, '/to', carried)
    expect(state.projectSessions['/to']._sessions['sid-to']._worktreePath).toBeNull()
  })
})

describe('sessionFieldsFromSettings', () => {
  it('restores harness, model, permission and worktree onto a session patch', () => {
    const patch = sessionFieldsFromSettings({
      harness: 'claude',
      model: 'sonnet',
      effort: 'high',
      permissionMode: 'dontAsk',
      worktreePath: '/repo/.wt/feat',
      gitBranch: 'feat/x',
    })
    expect(patch.preferredProvider).toBe('claude')
    expect(patch.sessionProvider).toBe('claude')
    expect(patch.selectedModel).toBe('sonnet')
    expect(patch.modelUserChosen).toBe(true)
    expect(patch.selectedEffort).toBe('high')
    expect(patch.permissionMode).toBe('dontAsk')
    expect(patch._worktreePath).toBe('/repo/.wt/feat')
    expect(patch._gitBranch).toBe('feat/x')
  })

  it('returns an empty patch when settings are missing', () => {
    expect(sessionFieldsFromSettings(undefined)).toEqual({})
    expect(sessionFieldsFromSettings(null)).toEqual({})
  })
})

describe('snapshotDraftSettings worktree', () => {
  it('prefers the session worktree and keeps pending-create fields from the hint', () => {
    const settings = snapshotDraftSettings(
      session({
        _worktreePath: '/repo/.wt/feat',
        _gitBranch: 'feat/x',
      }),
      null,
      {
        path: '/repo/.wt/stale',
        pendingBaseBranch: 'main',
        pendingMode: 'branch',
        pendingBranchName: 'feat/x',
        pendingCarryLocalChanges: true,
      },
    )
    expect(settings.worktreePath).toBe('/repo/.wt/feat')
    expect(settings.gitBranch).toBe('feat/x')
    expect(settings.pendingBaseBranch).toBe('main')
    expect(settings.pendingWorktreeMode).toBe('branch')
    expect(settings.pendingBranchName).toBe('feat/x')
    expect(settings.pendingCarryLocalChanges).toBe(true)
  })

  it('falls back to the app-store worktree hint when the session has none', () => {
    const settings = snapshotDraftSettings(session(), null, { path: '/repo/.wt/hint' })
    expect(settings.worktreePath).toBe('/repo/.wt/hint')
  })
})

describe('isDraftOwnedBySession', () => {
  it('matches by originSessionId so a visibility-flushed draft is hidden while still focused', () => {
    expect(
      isDraftOwnedBySession({ id: 'd1', originSessionId: 'sid-1' }, 'sid-1'),
    ).toBe(true)
    expect(
      isDraftOwnedBySession({ id: 'd1', originSessionId: 'sid-1' }, 'sid-other'),
    ).toBe(false)
  })

  it('matches by session.draftId when the origin id was rotated', () => {
    expect(
      isDraftOwnedBySession({ id: 'd1', originSessionId: 'old-sid' }, 'new-sid', 'd1'),
    ).toBe(true)
  })
})

describe('consumeDraftForSession', () => {
  it('removes the mapped environment draft so send does not leave a zombie sidebar row', async () => {
    claimDraftForSession('sid-1', 'draft-1')
    await consumeDraftForSession('/repo', 'sid-1')
    expect(removeDraft).toHaveBeenCalledWith('local', 'draft-1')
    expect(getDraftIdForSession('sid-1')).toBeUndefined()
  })

  it('is a no-op when the session was never promoted to a draft', async () => {
    await consumeDraftForSession('/repo', 'sid-none')
    expect(removeDraft).not.toHaveBeenCalled()
  })
})
