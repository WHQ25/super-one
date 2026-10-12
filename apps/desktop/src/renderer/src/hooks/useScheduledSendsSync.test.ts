/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { useScheduledSendsSync } from './useScheduledSendsSync'

type ChangedEvent = Parameters<Parameters<typeof window.app.onScheduledSendChanged>[0]>[0]
let emit: ((event: ChangedEvent) => void) | null = null
const session = (id: string) => useChatStore.getState().projectSessions['/repo']._sessions[id]

beforeEach(() => {
  Object.assign(window.app, {
    listScheduledSends: () => Promise.resolve([]),
    onScheduledSendChanged: (callback: typeof emit) => { emit = callback; return () => { emit = null } },
  })
  const screenshot = { id: 'att-1', name: 'shot.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }
  const draft = { ...createDefaultPerSessionState(), draftText: 'continue the refactor', draftJson: { type: 'doc' }, attachments: [screenshot] }
  useChatStore.setState({ activeProject: '/repo', projectSessions: {
    '/repo': { ...createDefaultProjectState(), _activeSessionId: 'other', _sessions: {
      other: createDefaultPerSessionState(),
      queued: draft,
      untouched: draft,
    } },
  } })
})

describe('useScheduledSendsSync', () => {
  it('empties the composer of a session delivered while no pane shows it', () => {
    renderHook(() => useScheduledSendsSync())
    emit!({ sessionId: 'queued', scheduled: null, delivered: true })
    expect(session('queued')).toMatchObject({ draftText: '', draftJson: null, attachments: [] })
    expect(session('untouched')).toMatchObject({ draftText: 'continue the refactor' })
  })

  it('leaves the composer alone when a schedule is cancelled', () => {
    renderHook(() => useScheduledSendsSync())
    emit!({ sessionId: 'queued', scheduled: null, delivered: false })
    expect(session('queued')).toMatchObject({ draftText: 'continue the refactor', attachments: [expect.objectContaining({ id: 'att-1' })] })
  })
})
