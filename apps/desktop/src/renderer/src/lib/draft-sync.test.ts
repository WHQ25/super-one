/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore, isRemoteSession } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { useDraftsStore } from '@/stores/drafts'
import { applyDraftChange, flushDraftBeforeOpen, startDraftAutosave } from './draft-sync'
import { _resetDraftSessionMap } from '@/stores/chat-store/helpers/draft-promote'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'

const draft: DraftListEntry = { id: 'draft', text: 'phone content', title: 'phone content', docJson: null, attachments: [],
  projectPath: '/repo', harness: 'codex', model: 'model', permissionMode: 'default', settings: { harness: 'codex', codexModel: 'model' },
  originSessionId: 'origin', createdAt: '', updatedAt: '', controllerDeviceId: 'phone' }

beforeEach(() => {
  _resetDraftSessionMap()
  useDraftsStore.setState({ byConnection: {}, discardedIds: {} })
  useChatStore.setState({ activeProject: '/repo', remoteSessions: {}, projectSessions: {
    '/repo': { ...createDefaultProjectState(), _activeSessionId: 'origin', _sessions: {
      origin: { ...createDefaultPerSessionState(), draftId: 'draft', draftText: 'desktop content' },
      other: { ...createDefaultPerSessionState(), draftText: 'another draft' },
    } },
  } })
})

describe('desktop watching a mobile draft editor', () => {
  it('replaces a pending first save when the draft is cleared before its id reaches the session', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockImplementation(async (_connectionId, input) => ({ ...draft, ...input, controllerDeviceId: null }))
    window.environment.upsertDraft = save
    const state = useChatStore.getState()
    const project = state.projectSessions['/repo']
    useChatStore.setState({ projectSessions: { '/repo': { ...project, _sessions: { origin: { ...project._sessions.origin, draftId: null } } } } })
    const stop = startDraftAutosave()
    useChatStore.getState().setDraftText('')
    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][1].text).toBe('')
    stop(); vi.useRealTimers()
  })
  it('flushes the last keystroke before handover and does not echo remote edits back', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockImplementation(async (_connectionId, input) => ({ ...draft, ...input, controllerDeviceId: null }))
    window.environment.upsertDraft = save
    const stop = startDraftAutosave()
    await flushDraftBeforeOpen('draft')
    expect(save.mock.calls.find(([, input]) => input.id === 'draft')?.[1].text).toBe('desktop content')
    applyDraftChange({ type: 'draft_changed', draftId: draft.id, draft, reason: 'opened' })
    applyDraftChange({ type: 'draft_changed', draftId: draft.id, draft: { ...draft, controllerDeviceId: null }, reason: 'closed' })
    await flushDraftBeforeOpen('draft')
    expect(save.mock.calls.filter(([, input]) => input.id === 'draft')).toHaveLength(1)
    stop(); vi.useRealTimers()
  })
  it('locks only the matching composer and restores the latest phone content on disconnect', () => {
    applyDraftChange({ type: 'draft_changed', draftId: draft.id, draft, reason: 'opened' })
    expect(isRemoteSession(useChatStore.getState(), '/repo', 'origin')).toBe(true)
    expect(isRemoteSession(useChatStore.getState(), '/repo', 'other')).toBe(false)
    applyDraftChange({ type: 'draft_changed', draftId: draft.id, draft: { ...draft, text: 'latest', controllerDeviceId: null }, reason: 'disconnected' })
    expect(isRemoteSession(useChatStore.getState(), '/repo', 'origin')).toBe(false)
    expect(useChatStore.getState().projectSessions['/repo']._sessions.origin.draftText).toBe('latest')
  })
  it('clears a consumed draft and never recreates it on a later autosave', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockImplementation(async (_connectionId, input) => ({ ...draft, ...input, controllerDeviceId: null }))
    window.environment.upsertDraft = save
    const stop = startDraftAutosave()
    applyDraftChange({ type: 'draft_changed', draftId: draft.id, draft, reason: 'opened' })
    applyDraftChange({ type: 'draft_changed', draftId: draft.id, draft: null, reason: 'deleted' })
    await vi.advanceTimersByTimeAsync(500)
    expect(save.mock.calls.some(([, input]) => input.id === draft.id)).toBe(false)
    expect(useChatStore.getState().projectSessions['/repo']._sessions.origin.draftText).toBe('')
    stop(); vi.useRealTimers()
  })
})
