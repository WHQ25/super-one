/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat-store/index'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { getActiveSessionView } from '@/stores/chat-store/selectors'
import { Session } from './session'
import type { SessionBackend, SessionStateChange } from './types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getName: () => 'SuperOne', isPackaged: false }, ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), transports: { file: {}, console: {} } } }))

const projectPath = '/codex-model-retention'
const fallback: ModelOption = { id: 'gpt-5.4', name: 'GPT-5.4', description: '', isDefault: true }
const astra: ModelOption = {
  id: 'gpt-6-astra', name: 'GPT-6 Astra', description: '',
  supportedReasoningEfforts: [{ value: 'high', description: 'High' }],
  defaultReasoningEffort: 'high',
}

beforeEach(() => {
  localStorage.clear()
  Object.assign(window.agent, { broadcastSessionSetting: vi.fn().mockResolvedValue(undefined) })
  Object.assign(window.app, { resumeSession: vi.fn().mockResolvedValue(null) })
  useChatStore.setState({
    activeProject: projectPath,
    projectSessions: {
      [projectPath]: {
        ...createDefaultProjectState(),
        _activeSessionId: 'astra',
        codexModels: [fallback, astra],
        _sessions: Object.fromEntries(['astra', 'other'].map((id) => [id, {
          ...createDefaultPerSessionState(),
          sessionProvider: 'codex' as const,
          preferredProvider: 'codex' as const,
          _historyHydrated: true,
        }])),
      },
    },
  })
})

describe('Codex session model retention', () => {
  it.each([false, true])('sends the chosen model outside the catalog (queued=%s)', async (queued) => {
    useChatStore.getState().setSelectedCodexModel(astra.id)
    useChatStore.setState((state) => ({ projectSessions: { [projectPath]: {
      ...state.projectSessions[projectPath], codexModels: [fallback],
      _sessions: { ...state.projectSessions[projectPath]._sessions, astra: {
        ...state.projectSessions[projectPath]._sessions.astra, status: queued ? 'streaming' : 'idle',
      } },
    } } }))
    Object.assign(window.agent, { sendMessage: vi.fn().mockResolvedValue(undefined) })
    Object.assign(window.app, { codexRun: vi.fn().mockResolvedValue({ finalResponse: 'Done', items: [] }) })
    await useChatStore.getState().sendMessage('Continue')
    if (queued) {
      expect(window.agent.sendMessage).toHaveBeenCalledWith(
        projectPath, expect.objectContaining({ model: astra.id }),
      )
    } else {
      expect(vi.mocked(window.app.codexRun).mock.calls[0]?.[3]).toBe(astra.id)
    }
  })

  it('keeps a model picked while cold history is still loading', async () => {
    const project = useChatStore.getState().projectSessions[projectPath]
    useChatStore.setState({ projectSessions: { [projectPath]: {
      ...project, _activeSessionId: 'other', _sessions: {
        ...project._sessions,
        astra: { ...project._sessions.astra, _historyHydrated: false },
      },
    } } })
    let finish!: (saved: unknown) => void
    Object.assign(window.app, { loadSessionState: vi.fn(() => new Promise((resolve) => { finish = resolve })) })
    const restore = useChatStore.getState().switchSession('astra')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    useChatStore.getState().setSelectedCodexModel(astra.id, { projectPath, sessionId: 'astra' })
    finish({ messages: [], provider: 'codex', selectedModel: fallback.id, totalCostUsd: 0, contextTokens: 0 })
    await restore
    expect(getActiveSessionView(null).selectedCodexModel).toBe(astra.id)
  })

  it('persists a model pick before another message is sent', async () => {
    let saved: SessionStateChange | undefined
    const session = new Session({
      id: 'astra', projectPath, cwd: projectPath, providerId: 'codex', harnessId: 'codex',
      providerConfig: {}, model: fallback.id,
      initialMessages: [{ id: 'previous', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'Previous reply' }], createdAt: '2026-09-05T00:00:00Z', providerId: 'codex' }],
      backend: {
        onEvent: () => () => {},
        onProviderSessionId: () => () => {},
        onPermissionModeApplied: () => () => {},
      } as unknown as SessionBackend,
      onStateChange: (snapshot) => { saved = snapshot },
    })
    Object.assign(window.agent, {
      broadcastSessionSetting: vi.fn(async (_id, patch) => session.broadcastSettingsPatch(patch)),
    })

    useChatStore.getState().setSelectedCodexModel(astra.id)

    expect(saved?.selectedModel).toBe(astra.id)
    const project = useChatStore.getState().projectSessions[projectPath]
    useChatStore.setState({ projectSessions: { [projectPath]: {
      ...project, _activeSessionId: 'other', _sessions: { other: project._sessions.other },
    } } })
    Object.assign(window.app, {
      loadSessionState: vi.fn().mockResolvedValue({ ...saved, provider: 'codex' }),
      getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
    })
    await useChatStore.getState().switchSession('astra')
    expect(getActiveSessionView(null).selectedCodexModel).toBe(astra.id)
  })

  it.each([null, ''])('keeps a selected model when a settings replay has no model (%s)', async (model) => {
    useChatStore.getState().setSelectedCodexModel(astra.id)
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath,
      sessionId: 'astra',
      patch: { selectedCodexModel: model },
    })
    await useChatStore.getState().switchSession('other')
    await useChatStore.getState().switchSession('astra')
    expect(getActiveSessionView(null).selectedCodexModel).toBe(astra.id)
  })

  it.each([false, true])('restores the persisted Codex model when reopening a session (stub=%s)', async (hasStub) => {
    const project = useChatStore.getState().projectSessions[projectPath]
    useChatStore.setState({ projectSessions: {
      [projectPath]: {
        ...project,
        _activeSessionId: 'other',
        _sessions: {
          other: project._sessions.other,
          ...(hasStub ? { astra: { ...createDefaultPerSessionState(), sessionProvider: 'codex' as const, _historyHydrated: false } } : {}),
        },
      },
    } })
    Object.assign(window.app, {
      loadSessionState: vi.fn().mockResolvedValue({
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        isWorktree: false,
        gitBranch: null,
        worktreePath: null,
        provider: 'codex',
        selectedModel: astra.id,
        selectedEffort: 'high',
      }),
      getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
    })

    await useChatStore.getState().switchSession('astra')

    const restored = getActiveSessionView(null)
    expect(restored.selectedCodexModel).toBe(astra.id)
    expect(restored.selectedCodexReasoningEffort).toBe('high')
    expect(restored.codexModelUserChosen).toBe(true)
    expect(restored.codexReasoningEffortUserChosen).toBe(true)
  })

  it('reuses the manually fetched catalog when switching sessions within one project', async () => {
    Object.assign(window.app, { codexListModels: vi.fn().mockResolvedValue([astra]) })
    await useChatStore.getState().loadCodexModels(projectPath, null, true)
    useChatStore.getState().setSelectedCodexModel(astra.id)
    await useChatStore.getState().switchSession('other')
    await useChatStore.getState().refreshCodexModels()
    await useChatStore.getState().switchSession('astra')
    await useChatStore.getState().refreshCodexModels()

    expect(getActiveSessionView(null).codexModels).toEqual([astra])
    expect(getActiveSessionView(null).selectedCodexModel).toBe(astra.id)
    expect(window.app.codexListModels).toHaveBeenCalledTimes(1)
  })

  it.each([{ models: [] }, { models: [fallback] }])('keeps the selected model and effort after switching with catalog $models', async ({ models }) => {
    useChatStore.getState().setSelectedCodexModel(astra.id)
    await useChatStore.getState().switchSession('other')
    useChatStore.setState((state) => ({
      projectSessions: {
        ...state.projectSessions,
        [projectPath]: { ...state.projectSessions[projectPath], codexModels: models },
      },
    }))

    await useChatStore.getState().switchSession('astra')

    const session = useChatStore.getState().projectSessions[projectPath]._sessions.astra
    expect(session.selectedCodexModel).toBe(astra.id)
    expect(session.selectedCodexReasoningEffort).toBe('high')
  })

  it('keeps the selection when a refreshed catalog omits the model', async () => {
    useChatStore.getState().setSelectedCodexModel(astra.id)
    Object.assign(window.app, { codexListModels: vi.fn().mockResolvedValue([fallback]) })

    await useChatStore.getState().loadCodexModels(projectPath, null, true)

    const session = useChatStore.getState().projectSessions[projectPath]._sessions.astra
    expect(session.selectedCodexModel).toBe(astra.id)
    expect(session.selectedCodexReasoningEffort).toBe('high')
  })
})
