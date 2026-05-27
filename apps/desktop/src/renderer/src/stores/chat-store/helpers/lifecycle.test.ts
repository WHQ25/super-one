/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

const resumeSession = vi.fn()
const parkSession = vi.fn()
const truncateAtCheckpoint = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: { truncateAtCheckpoint, parkSession },
  app: {
    resumeSession,
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
  },
})

await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const {
  _buildQuestionAnswerItem,
  _computeHasPendingInteraction,
  _ensureClaudeSessionReadyForSend,
  _isBusyStatus,
  _isLiveSession,
  _needsForegroundActivation,
  _parkActiveSession,
  _syncAndResumeSession,
  _truncateAtCheckpoint,
} = await import('./lifecycle')

beforeEach(() => {
  resumeSession.mockReset()
  parkSession.mockReset()
  truncateAtCheckpoint.mockReset().mockResolvedValue(undefined)
})

describe('_isBusyStatus', () => {
  it('classifies streaming + background as busy', () => {
    expect(_isBusyStatus('streaming')).toBe(true)
    expect(_isBusyStatus('background')).toBe(true)
  })

  it('classifies idle + error as not busy', () => {
    expect(_isBusyStatus('idle')).toBe(false)
    expect(_isBusyStatus('error')).toBe(false)
  })
})

describe('_isLiveSession', () => {
  it('returns false for undefined or idle, no pendings', () => {
    expect(_isLiveSession(undefined)).toBe(false)
    expect(_isLiveSession(createDefaultPerSessionState())).toBe(false)
  })

  it('returns true on any busy status', () => {
    expect(_isLiveSession({ ...createDefaultPerSessionState(), status: 'streaming' })).toBe(true)
    expect(_isLiveSession({ ...createDefaultPerSessionState(), status: 'background' })).toBe(true)
  })

  it('returns true if there is a pending permission/question/plan-approval/awaiting reply', () => {
    const base = createDefaultPerSessionState()
    expect(_isLiveSession({ ...base, pendingPermissions: [{} as never] })).toBe(true)
    expect(_isLiveSession({ ...base, pendingQuestion: {} as never })).toBe(true)
    expect(_isLiveSession({ ...base, pendingPlanApproval: {} as never })).toBe(true)
    expect(_isLiveSession({ ...base, awaitingAssistantReply: true })).toBe(true)
  })
})

describe('_needsForegroundActivation', () => {
  it('mirrors _isLiveSession minus awaitingAssistantReply', () => {
    const base = createDefaultPerSessionState()
    expect(_needsForegroundActivation(base)).toBe(false)
    expect(_needsForegroundActivation({ ...base, status: 'streaming' })).toBe(true)
    expect(_needsForegroundActivation({ ...base, pendingQuestion: {} as never })).toBe(true)
    // awaitingAssistantReply alone is NOT a foreground trigger
    expect(_needsForegroundActivation({ ...base, awaitingAssistantReply: true })).toBe(false)
  })
})

describe('_computeHasPendingInteraction', () => {
  it('true when any session has a pending permission/question/plan approval', () => {
    const proj = createDefaultProjectState()
    proj._sessions = {
      a: { ...createDefaultPerSessionState() },
      b: { ...createDefaultPerSessionState(), pendingQuestion: {} as never },
    }
    expect(_computeHasPendingInteraction(proj)).toBe(true)
  })

  it('false when all sessions are clean', () => {
    const proj = createDefaultProjectState()
    proj._sessions = { a: createDefaultPerSessionState(), b: createDefaultPerSessionState() }
    expect(_computeHasPendingInteraction(proj)).toBe(false)
  })

  it('false on a project with no sessions', () => {
    expect(_computeHasPendingInteraction(createDefaultProjectState())).toBe(false)
  })
})

describe('_buildQuestionAnswerItem', () => {
  it('renders each question + trimmed answer into a markdown agent_message', () => {
    const item = _buildQuestionAnswerItem(
      [{ question: 'What time?', allowMultiple: false } as never, { question: 'Where?', allowMultiple: false } as never],
      { 'What time?': '  now  ', 'Where?': 'here' },
    )
    expect(item.type).toBe('agent_message')
    expect(item.text).toBe('**What time?**\nnow\n\n**Where?**\nhere')
  })

  it("substitutes '_(dismissed)_' when an answer is missing or blank", () => {
    const item = _buildQuestionAnswerItem(
      [{ question: 'q1' } as never, { question: 'q2' } as never],
      { q1: '   ' },
    )
    expect(item.text).toBe('**q1**\n_(dismissed)_\n\n**q2**\n_(dismissed)_')
  })
})

describe('_parkActiveSession', () => {
  it('forwards to window.agent.parkSession with the projectPath', async () => {
    parkSession.mockResolvedValueOnce({ permissionMode: 'default', sandboxInfo: { enabled: true, autoAllowBash: false } })
    const result = await _parkActiveSession('/p1', null)
    expect(parkSession).toHaveBeenCalledWith('/p1')
    expect(result.permissionMode).toBe('default')
  })
})

describe('_truncateAtCheckpoint', () => {
  it('updates the active session messages to the slice before the checkpoint AND fires the IPC', () => {
    const sess: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude', checkpointId: 'cp-1' },
      { id: 'u2', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude', checkpointId: 'cp-2' },
      { id: 'u3', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude' },
    ]
    const baseState = {
      activeProject: '/p1',
      projectSessions: {
        '/p1': {
          ...createDefaultProjectState(),
          _activeSessionId: 'sid-1',
          _sessions: { 'sid-1': { ...createDefaultPerSessionState(), messages: sess } },
        },
      },
    } as never

    const captured: Array<{ messages?: ChatMessage[] }> = []
    const set = (updater: (s: never) => unknown) => {
      const patch = updater(baseState) as { projectSessions?: Record<string, { _sessions: Record<string, { messages: ChatMessage[] }> }> }
      const newSess = patch.projectSessions?.['/p1']._sessions['sid-1']
      if (newSess) captured.push(newSess)
    }

    _truncateAtCheckpoint(set as never, () => baseState, '/p1', 'cp-2')
    expect(captured[0]?.messages?.map((m) => m.id)).toEqual(['u1'])
    expect(truncateAtCheckpoint).toHaveBeenCalledWith('/p1', 'cp-2')
  })

  it('leaves messages unchanged when no checkpoint matches', () => {
    const sess: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude', checkpointId: 'cp-1' },
    ]
    const baseState = {
      activeProject: '/p1',
      projectSessions: {
        '/p1': {
          ...createDefaultProjectState(),
          _activeSessionId: 'sid-1',
          _sessions: { 'sid-1': { ...createDefaultPerSessionState(), messages: sess } },
        },
      },
    } as never
    const captured: Array<{ messages?: ChatMessage[] }> = []
    const set = (updater: (s: never) => unknown) => {
      const patch = updater(baseState) as { projectSessions?: Record<string, { _sessions: Record<string, { messages: ChatMessage[] }> }> }
      const newSess = patch.projectSessions?.['/p1']._sessions['sid-1']
      if (newSess) captured.push(newSess)
    }
    _truncateAtCheckpoint(set as never, () => baseState, '/p1', 'ghost')
    expect(captured[0]?.messages?.map((m) => m.id)).toEqual(['u1'])
  })
})

describe('_syncAndResumeSession', () => {
  it('is a no-op when resumeSession returns null', async () => {
    resumeSession.mockResolvedValueOnce(null)
    const set = vi.fn()
    await _syncAndResumeSession('/p1', 'sid-1', set as never, '/p1')
    expect(set).not.toHaveBeenCalled()
  })

  it('writes the returned permissionMode + sandboxInfo onto the session', async () => {
    resumeSession.mockResolvedValueOnce({
      permissionMode: 'plan',
      sandboxInfo: { enabled: true, autoAllowBash: true },
    })
    const baseState = {
      projectSessions: {
        '/p1': {
          ...createDefaultProjectState(),
          _activeSessionId: 'sid-1',
          _sessions: { 'sid-1': createDefaultPerSessionState() },
        },
      },
    } as never
    let captured: unknown
    const set = (updater: (s: never) => unknown) => { captured = updater(baseState) }
    await _syncAndResumeSession('/p1', 'sid-1', set as never, '/p1')
    const proj = (captured as { projectSessions: Record<string, { sandboxInfo: { enabled: boolean }; _sessions: Record<string, { permissionMode: string }> }> }).projectSessions['/p1']
    expect(proj.sandboxInfo.enabled).toBe(true)
    expect(proj._sessions['sid-1'].permissionMode).toBe('plan')
  })

  it('returns empty patch when project/session goes missing between IPC + apply', async () => {
    resumeSession.mockResolvedValueOnce({ permissionMode: 'default', sandboxInfo: { enabled: false, autoAllowBash: false } })
    let captured: unknown
    const set = (updater: (s: never) => unknown) => { captured = updater({ projectSessions: {} } as never) }
    await _syncAndResumeSession('/p1', 'sid-1', set as never, '/p1')
    expect(captured).toEqual({})
  })
})

describe('_ensureClaudeSessionReadyForSend', () => {
  it('is a no-op when no project state for projectPath', async () => {
    await _ensureClaudeSessionReadyForSend(() => ({ projectSessions: {} } as never), '/p1')
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('is a no-op when the project has no _activeSessionId', async () => {
    await _ensureClaudeSessionReadyForSend(
      () => ({ projectSessions: { '/p1': createDefaultProjectState() } } as never),
      '/p1',
    )
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('is a no-op for Codex sessions', async () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': { ...createDefaultPerSessionState(), sessionProvider: 'codex' as const } }
    await _ensureClaudeSessionReadyForSend(
      () => ({ projectSessions: { '/p1': proj } } as never),
      '/p1',
    )
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('forwards to window.app.resumeSession for Claude sessions', async () => {
    resumeSession.mockResolvedValueOnce({})
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': { ...createDefaultPerSessionState(), sessionProvider: 'claude' as const } }
    await _ensureClaudeSessionReadyForSend(
      () => ({ projectSessions: { '/p1': proj } } as never),
      '/p1',
    )
    expect(resumeSession).toHaveBeenCalledWith('/p1', 'sid-1', '/p1')
  })
})
