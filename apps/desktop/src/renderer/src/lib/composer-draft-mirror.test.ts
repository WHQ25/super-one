/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { _resetDraftSessionMap, getDraftIdForSession } from '@/stores/chat-store/helpers/draft-promote'
import { startComposerDraftMirror } from './composer-draft-mirror'

let remote: ((sessionId: string, patch: Record<string, unknown>) => void) | null = null
const publish = vi.fn()
let initial: Record<string, Record<string, unknown>> = {}
let stop: () => void = () => {}

const session = (id: string) => useChatStore.getState().projectSessions['/repo']._sessions[id]
const flush = () => new Promise((resolve) => setTimeout(resolve))

beforeEach(() => {
  _resetDraftSessionMap()
  publish.mockClear()
  initial = {}
  Object.assign(window.app, {
    publishComposerDraft: publish,
    getComposerDrafts: () => Promise.resolve(initial),
    onComposerDraftChanged: (callback: typeof remote) => { remote = callback; return () => { remote = null } },
  })
  useChatStore.setState({ activeProject: '/repo', projectSessions: {
    '/repo': { ...createDefaultProjectState(), _activeSessionId: 'live', _sessions: {
      live: { ...createDefaultPerSessionState(), messages: [{ id: 'm', role: 'user', content: 'x' } as never] },
      fresh: createDefaultPerSessionState(),
    } },
  } })
})
afterEach(() => stop())

describe('composer draft mirror', () => {
  it('publishes only the fields a local edit changed', async () => {
    stop = startComposerDraftMirror()
    await flush()
    const target = { projectPath: '/repo', sessionId: 'live' }
    useChatStore.getState().setDraftText('hello', target, { keepDoc: true })
    useChatStore.getState().addBrowserAnnotation({ id: 'a1', kind: 'element', selector: '#b', comment: 'fix', pageUrl: '', pageTitle: '', screenshot: null, styleChanges: [] }, target)
    expect(publish.mock.calls).toEqual([
      ['live', { draftText: 'hello' }],
      ['live', { browserAnnotations: [expect.objectContaining({ id: 'a1' })] }],
    ])
  })

  it('applies another window\'s edit without publishing it or its editor echo back', async () => {
    stop = startComposerDraftMirror()
    await flush()
    remote!('live', { draftText: 'from mini', draftJson: { type: 'doc' } })
    expect(session('live')).toMatchObject({ draftText: 'from mini', draftJson: { type: 'doc' } })
    // The composer's editor rewrites what it was handed with fresh objects.
    useChatStore.getState().setDraftText('from mini', { projectPath: '/repo', sessionId: 'live' }, { keepDoc: true })
    useChatStore.getState().setDraftJson({ type: 'doc' }, { projectPath: '/repo', sessionId: 'live' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('starts a session loaded later from the shared draft', async () => {
    initial = { late: { draftText: 'kept' } }
    stop = startComposerDraftMirror()
    await flush()
    remote!('late', { browserAnnotations: [{ id: 'a1' }] })
    useChatStore.setState((s) => ({ projectSessions: { '/repo': { ...s.projectSessions['/repo'], _sessions: {
      ...s.projectSessions['/repo']._sessions, late: createDefaultPerSessionState(),
    } } } }))
    expect(session('late')).toMatchObject({ draftText: 'kept', browserAnnotations: [{ id: 'a1' }] })
    expect(publish).not.toHaveBeenCalled()
  })

  it('keeps an unsent session autosaving into one draft row across windows', async () => {
    stop = startComposerDraftMirror()
    await flush()
    useChatStore.getState().setDraftText('draft', { projectPath: '/repo', sessionId: 'fresh' })
    const draftId = publish.mock.calls[0][1].persistDraftId
    expect(draftId).toBe(getDraftIdForSession('fresh'))
    _resetDraftSessionMap()
    remote!('fresh', { draftText: 'draft!', persistDraftId: draftId })
    expect(getDraftIdForSession('fresh')).toBe(draftId)
    expect(session('fresh')).not.toHaveProperty('persistDraftId')
  })
})
