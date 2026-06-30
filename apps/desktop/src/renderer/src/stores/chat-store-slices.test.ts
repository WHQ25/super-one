/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccountInfo, ChatMessage, ClaudeResources, ModelOption } from '@superone/shared/agent-types'

const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageState.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageState.delete(key) }),
  clear: vi.fn(() => { localStorageState.clear() }),
}

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: vi.fn(),
      clearWorktree: vi.fn().mockResolvedValue(undefined),
      sandboxCapability: { supportLevel: 'always', platform: 'darwin', defaultMode: 'on' },
      sandboxProbe: null,
      probeSandbox: vi.fn(async () => ({ ok: true as const })),
    }),
  },
}))

const mockClearForSession = vi.fn()
vi.mock('./activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ clearForSession: mockClearForSession }) },
}))

const mockWindowAgent = {
  prewarm: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  setSessionSettings: vi.fn().mockResolvedValue(undefined),
  rewindFiles: vi.fn().mockResolvedValue({ canRewind: true } as const),
  rewindCodeAndChat: vi.fn().mockResolvedValue({ canRewind: true } as const),
  rewindConversation: vi.fn().mockResolvedValue({ canRewind: true } as const),
  previewRewind: vi.fn().mockResolvedValue({ canRewind: true } as const),
  truncateAtCheckpoint: vi.fn().mockResolvedValue(undefined),
  dequeueMessage: vi.fn().mockResolvedValue(true),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
  parkSession: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  setFastMode: vi.fn().mockResolvedValue(undefined),
  trace: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '' },
    },
  }),
}

const eventTarget = new EventTarget()
vi.stubGlobal('window', {
  agent: mockWindowAgent,
  app: mockWindowApp,
  localStorage: mockLocalStorage,
  dispatchEvent: (e: Event) => eventTarget.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', mockLocalStorage)

const { useChatStore } = await import('./chat')

const PATH = '/test-project'

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null },
    initializedHarnesses: new Set(),
    isOpen: false,
    corner: 'br',
  })
}

function setClaudeResources(partial: Partial<ClaudeResources>) {
  useChatStore.getState().setHarnessResources('claude', {
    models: [],
    account: {} as AccountInfo,
    slashCommands: [],
    skills: [],
    commands: [],
    agents: [],
    outputStyles: [],
    ...partial,
  })
}

function setupProject(path: string = PATH) {
  useChatStore.getState().ensureSession(path)
  useChatStore.setState({ activeProject: path })
}

function patchSession(patch: Record<string, unknown>, path: string = PATH) {
  const state = useChatStore.getState()
  const proj = state.projectSessions[path]
  const sid = proj._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [path]: {
        ...proj,
        _sessions: { ...proj._sessions, [sid]: { ...proj._sessions[sid], ...patch } },
      },
    },
  })
}

function activeSession(path: string = PATH) {
  const proj = useChatStore.getState().projectSessions[path]
  return proj._sessions[proj._activeSessionId!]
}

function activeProjectState(path: string = PATH) {
  return useChatStore.getState().projectSessions[path]
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockLocalStorage.clear()
})

// ─────────────────────────────────────────────────────────────────────────────
// core-slice
// ─────────────────────────────────────────────────────────────────────────────

describe('core-slice: top-level UI toggles', () => {
  it('toggleOpen flips isOpen and setCorner writes corner regardless of active project', () => {
    expect(useChatStore.getState().isOpen).toBe(false)
    useChatStore.getState().toggleOpen()
    expect(useChatStore.getState().isOpen).toBe(true)
    useChatStore.getState().toggleOpen()
    expect(useChatStore.getState().isOpen).toBe(false)

    useChatStore.getState().setCorner('tl')
    expect(useChatStore.getState().corner).toBe('tl')
  })

  it('requestChatInputFocusRestore increments the active session nonce', () => {
    setupProject()
    const before = activeSession().chatInputRestoreFocusNonce
    useChatStore.getState().requestChatInputFocusRestore()
    expect(activeSession().chatInputRestoreFocusNonce).toBe(before + 1)
  })
})

describe('core-slice: slash-command popups (require active project)', () => {
  it('openProviderPopup and openMcpPopup write the slashCommandOutput slot', () => {
    setupProject()
    useChatStore.getState().openProviderPopup()
    expect(activeSession().slashCommandOutput).toEqual({ command: 'provider', content: '' })

    useChatStore.getState().openMcpPopup()
    expect(activeSession().slashCommandOutput).toEqual({ command: 'mcp', content: '' })

    useChatStore.getState().dismissSlashCommandOutput()
    expect(activeSession().slashCommandOutput).toBeNull()
  })

  it('is a no-op when no project is active', () => {
    useChatStore.getState().openProviderPopup()
    useChatStore.getState().openMcpPopup()
    useChatStore.getState().dismissSlashCommandOutput()
    expect(useChatStore.getState().projectSessions).toEqual({})
  })
})

describe('core-slice: todos visibility', () => {
  it('toggleTodos shows todos and resets the user-dismissed flag, then re-toggles to mark dismissed', () => {
    setupProject()
    patchSession({ showTodos: false, _todosUserDismissed: true })

    useChatStore.getState().toggleTodos()
    expect(activeSession().showTodos).toBe(true)
    expect(activeSession()._todosUserDismissed).toBe(false)

    useChatStore.getState().toggleTodos()
    expect(activeSession().showTodos).toBe(false)
    expect(activeSession()._todosUserDismissed).toBe(true)
  })
})

describe('core-slice: attachments', () => {
  it('addAttachment appends, removeAttachment(index) deletes that one, clearAttachments empties', () => {
    setupProject()
    const a1 = { mimeType: 'image/png', base64: 'aaaa', name: 'a.png' }
    const a2 = { mimeType: 'image/png', base64: 'bbbb', name: 'b.png' }
    const a3 = { mimeType: 'image/png', base64: 'cccc', name: 'c.png' }
    useChatStore.getState().addAttachment(a1)
    useChatStore.getState().addAttachment(a2)
    useChatStore.getState().addAttachment(a3)
    expect(activeSession().attachments.map((a) => a.name)).toEqual(['a.png', 'b.png', 'c.png'])

    useChatStore.getState().removeAttachment(1)
    expect(activeSession().attachments.map((a) => a.name)).toEqual(['a.png', 'c.png'])

    useChatStore.getState().clearAttachments()
    expect(activeSession().attachments).toEqual([])
  })
})

describe('core-slice: mentions', () => {
  it('addMention appends new mentions but dedupes by value', () => {
    setupProject()
    const m1 = { kind: 'file' as const, value: 'src/a.ts', displayName: 'a.ts' }
    const m1Dup = { kind: 'file' as const, value: 'src/a.ts', displayName: 'a.ts (again)' }
    const m2 = { kind: 'file' as const, value: 'src/b.ts', displayName: 'b.ts' }
    useChatStore.getState().addMention(m1)
    useChatStore.getState().addMention(m1Dup)
    useChatStore.getState().addMention(m2)
    expect(activeSession().mentions.map((m) => m.value)).toEqual(['src/a.ts', 'src/b.ts'])

    useChatStore.getState().removeMention('src/a.ts')
    expect(activeSession().mentions.map((m) => m.value)).toEqual(['src/b.ts'])
  })
})

describe('core-slice: miniapp context slots', () => {
  it("setMiniAppContext stores the slot with checked=true in 'inject' mode and checked=false in 'suggest' mode", () => {
    setupProject()
    useChatStore.getState().setMiniAppContext('app-1', { appName: 'A', summary: 's', content: 'c', mode: 'inject', color: '#f00' })
    expect(activeSession().miniAppContexts['app-1']).toMatchObject({ appId: 'app-1', mode: 'inject', checked: true, color: '#f00' })

    useChatStore.getState().setMiniAppContext('app-2', { appName: 'B', summary: 's', content: 'c', mode: 'suggest' })
    expect(activeSession().miniAppContexts['app-2'].checked).toBe(false)
  })

  it('toggleMiniAppContext flips checked when slot exists, otherwise is a no-op', () => {
    setupProject()
    useChatStore.getState().setMiniAppContext('app-1', { appName: 'A', summary: 's', content: 'c', mode: 'suggest' })
    useChatStore.getState().toggleMiniAppContext('app-1')
    expect(activeSession().miniAppContexts['app-1'].checked).toBe(true)
    useChatStore.getState().toggleMiniAppContext('app-1')
    expect(activeSession().miniAppContexts['app-1'].checked).toBe(false)

    // unknown id leaves state untouched
    const before = activeSession().miniAppContexts
    useChatStore.getState().toggleMiniAppContext('ghost')
    expect(activeSession().miniAppContexts).toBe(before)
  })

  it('clearMiniAppContext removes only the requested appId', () => {
    setupProject()
    useChatStore.getState().setMiniAppContext('app-1', { appName: 'A', summary: 's', content: 'c', mode: 'inject' })
    useChatStore.getState().setMiniAppContext('app-2', { appName: 'B', summary: 's', content: 'c', mode: 'inject' })
    useChatStore.getState().clearMiniAppContext('app-1')
    expect(Object.keys(activeSession().miniAppContexts)).toEqual(['app-2'])
  })
})

describe('core-slice: user selections', () => {
  it('addUserSelection trims input and rejects empty strings', () => {
    setupProject()
    useChatStore.getState().addUserSelection('  hello  ')
    useChatStore.getState().addUserSelection('   ')
    useChatStore.getState().addUserSelection('')
    useChatStore.getState().addUserSelection('world')
    expect(activeSession().userSelections).toEqual(['hello', 'world'])
  })

  it('removeUserSelectionAt removes by index; clearUserSelections empties the list', () => {
    setupProject()
    useChatStore.getState().addUserSelection('a')
    useChatStore.getState().addUserSelection('b')
    useChatStore.getState().addUserSelection('c')
    useChatStore.getState().removeUserSelectionAt(1)
    expect(activeSession().userSelections).toEqual(['a', 'c'])
    useChatStore.getState().clearUserSelections()
    expect(activeSession().userSelections).toEqual([])
  })
})

describe('core-slice: project-level panels', () => {
  it('setShowDirManager and setShowReviewPanel write to project state, not per-session', () => {
    setupProject()
    useChatStore.getState().setShowDirManager(true)
    useChatStore.getState().setShowReviewPanel(true)
    expect(activeProjectState().showDirManager).toBe(true)
    expect(activeProjectState().showReviewPanel).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// claude-slice
// ─────────────────────────────────────────────────────────────────────────────

const opus: ModelOption = {
  id: 'opus-4-8',
  name: 'Opus 4.8',
  description: '',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high'],
  supportsAutoMode: true,
}

const sonnet: ModelOption = {
  id: 'sonnet-4-6',
  name: 'Sonnet 4.6',
  description: '',
  supportsEffort: false,
  supportsAutoMode: false,
}

describe('claude-slice: setSelectedModel', () => {
  it('writes model + default effort, broadcasts to backend, and marks model user-chosen', () => {
    setupProject()
    setClaudeResources({ models: [opus, sonnet], account: { subscriptionType: 'Claude Max' } as AccountInfo })

    useChatStore.getState().setSelectedModel('opus-4-8')

    const sess = activeSession()
    expect(sess.selectedModel).toBe('opus-4-8')
    expect(sess.selectedEffort).toBe('high')
    expect(sess.modelUserChosen).toBe(true)
    expect(sess.effortUserChosen).toBe(false)
    expect(sess.contextWindow).toBeNull()
    expect(mockWindowAgent.setSessionSettings).toHaveBeenCalledWith(PATH, { model: 'opus-4-8', effort: 'high' })
    expect(mockWindowAgent.setPermissionMode).not.toHaveBeenCalled()
    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })

  it("downgrades permissionMode to 'default' when active mode is 'auto' but the model can't sustain Auto Mode", () => {
    setupProject()
    setClaudeResources({ models: [opus, sonnet], account: { subscriptionType: 'Claude Max' } as AccountInfo })
    patchSession({ permissionMode: 'auto' })

    useChatStore.getState().setSelectedModel('sonnet-4-6')

    expect(activeSession().permissionMode).toBe('default')
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith(PATH, 'default')
  })

  it("keeps permissionMode='auto' when the picked model still supports Auto Mode", () => {
    setupProject()
    setClaudeResources({ models: [opus, sonnet], account: { subscriptionType: 'Claude Max' } as AccountInfo })
    patchSession({ permissionMode: 'auto' })

    useChatStore.getState().setSelectedModel('opus-4-8')
    expect(activeSession().permissionMode).toBe('auto')
    expect(mockWindowAgent.setPermissionMode).not.toHaveBeenCalled()
  })

  it('triggers prewarm when there is unsent draft text', () => {
    setupProject()
    setClaudeResources({ models: [opus], account: { subscriptionType: 'Claude Max' } as AccountInfo })
    patchSession({ draftText: 'hello' })

    useChatStore.getState().setSelectedModel('opus-4-8')
    expect(mockWindowAgent.prewarm).toHaveBeenCalledTimes(1)
    expect(mockWindowAgent.prewarm.mock.calls[0]?.[0]).toBe(PATH)
  })

  it('is a no-op when no project is active', () => {
    setClaudeResources({ models: [opus] })
    useChatStore.getState().setSelectedModel('opus-4-8')
    expect(mockWindowAgent.setSessionSettings).not.toHaveBeenCalled()
  })
})

describe('claude-slice: setSelectedEffort', () => {
  it('writes effort + effortUserChosen=true and broadcasts to backend', () => {
    setupProject()
    useChatStore.getState().setSelectedEffort('high')
    expect(activeSession().selectedEffort).toBe('high')
    expect(activeSession().effortUserChosen).toBe(true)
    expect(mockWindowAgent.setSessionSettings).toHaveBeenCalledWith(PATH, { effort: 'high' })
  })

  it('forwards undefined as null to backend when effort is cleared', () => {
    setupProject()
    useChatStore.getState().setSelectedEffort(undefined)
    expect(mockWindowAgent.setSessionSettings).toHaveBeenCalledWith(PATH, { effort: null })
  })

  it('triggers prewarm when there is unsent draft text', () => {
    setupProject()
    patchSession({ draftText: 'draft' })
    useChatStore.getState().setSelectedEffort('medium')
    expect(mockWindowAgent.prewarm).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when no project is active', () => {
    useChatStore.getState().setSelectedEffort('low')
    expect(mockWindowAgent.setSessionSettings).not.toHaveBeenCalled()
  })
})

describe('claude-slice: setFastMode', () => {
  it('forwards the toggle straight to window.app.setFastMode', () => {
    useChatStore.getState().setFastMode(true)
    expect(mockWindowApp.setFastMode).toHaveBeenCalledWith(true)
    useChatStore.getState().setFastMode(false)
    expect(mockWindowApp.setFastMode).toHaveBeenLastCalledWith(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// session-slice
// ─────────────────────────────────────────────────────────────────────────────

function makeUserMessage(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: '' }],
    createdAt: '',
    providerId: 'claude',
    ...overrides,
  }
}

describe('session-slice: rewindFiles', () => {
  it('marks the targeted message as rewound=code when the IPC reports canRewind=true', async () => {
    setupProject()
    patchSession({ messages: [makeUserMessage('m1', { checkpointId: 'cp-1' })] })

    await useChatStore.getState().rewindFiles('cp-1')

    expect(mockWindowAgent.rewindFiles).toHaveBeenCalledWith(PATH, 'cp-1')
    expect(activeSession().messages[0].rewound).toBe('code')
  })

  it('leaves messages untouched when the IPC reports canRewind=false', async () => {
    mockWindowAgent.rewindFiles.mockResolvedValueOnce({ canRewind: false } as never)
    setupProject()
    patchSession({ messages: [makeUserMessage('m1', { checkpointId: 'cp-1' })] })

    await useChatStore.getState().rewindFiles('cp-1')
    expect(activeSession().messages[0].rewound).toBeUndefined()
  })

  it('throws when no project is active', async () => {
    await expect(useChatStore.getState().rewindFiles('cp-1')).rejects.toThrow('No active project')
  })
})

describe('session-slice: rewindCodeAndChat / rewindConversation', () => {
  it('rewindCodeAndChat truncates messages at the checkpoint when canRewind=true', async () => {
    setupProject()
    patchSession({
      messages: [
        makeUserMessage('m1', { checkpointId: 'cp-1' }),
        makeUserMessage('m2', { checkpointId: 'cp-2' }),
        makeUserMessage('m3', { checkpointId: 'cp-3' }),
      ],
    })

    await useChatStore.getState().rewindCodeAndChat('cp-2')
    expect(mockWindowAgent.rewindCodeAndChat).toHaveBeenCalledWith(PATH, 'cp-2')
    // _truncateAtCheckpoint keeps messages strictly before the checkpoint
    expect(activeSession().messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('rewindConversation truncates by user-message id (IPC argument is project-only)', async () => {
    setupProject()
    patchSession({
      messages: [
        makeUserMessage('m1', { checkpointId: 'cp-1' }),
        makeUserMessage('m2', { checkpointId: 'cp-2' }),
      ],
    })

    await useChatStore.getState().rewindConversation('cp-2')
    expect(mockWindowAgent.rewindConversation).toHaveBeenCalledWith(PATH)
    expect(activeSession().messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('rewindCodeAndChat leaves messages intact when IPC reports canRewind=false', async () => {
    mockWindowAgent.rewindCodeAndChat.mockResolvedValueOnce({ canRewind: false } as never)
    setupProject()
    const messages = [
      makeUserMessage('m1', { checkpointId: 'cp-1' }),
      makeUserMessage('m2', { checkpointId: 'cp-2' }),
    ]
    patchSession({ messages })

    await useChatStore.getState().rewindCodeAndChat('cp-2')
    expect(activeSession().messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('session-slice: previewRewind', () => {
  it('passes through to window.agent.previewRewind without touching store state', async () => {
    setupProject()
    mockWindowAgent.previewRewind.mockResolvedValueOnce({ canRewind: true, files: ['a.ts'] } as never)
    const result = await useChatStore.getState().previewRewind('cp-1')
    expect(mockWindowAgent.previewRewind).toHaveBeenCalledWith(PATH, 'cp-1')
    expect(result).toEqual({ canRewind: true, files: ['a.ts'] })
  })
})

describe('session-slice: queued-message edit/delete', () => {
  const queued = (id: string, text: string) => ({
    id,
    content: [{ type: 'text' as const, text }],
    attachments: [],
  })

  it('editQueuedMessage moves the queued text back into draftText and removes it from the queue', async () => {
    setupProject()
    patchSession({
      queuedMessages: [queued('q1', 'first'), queued('q2', 'second')],
      draftText: '',
      codexPlanRejectHintActive: true,
    })

    await useChatStore.getState().editQueuedMessage('q1')

    expect(mockWindowAgent.dequeueMessage).toHaveBeenCalledWith(PATH, 'q1')
    expect(activeSession().queuedMessages.map((m) => m.id)).toEqual(['q2'])
    expect(activeSession().draftText).toBe('first')
    expect(activeSession().codexPlanRejectHintActive).toBe(false)
  })

  it('editQueuedMessage is a no-op when the backend rejects dequeue', async () => {
    mockWindowAgent.dequeueMessage.mockResolvedValueOnce(false as never)
    setupProject()
    patchSession({ queuedMessages: [queued('q1', 'first')], draftText: 'kept' })

    await useChatStore.getState().editQueuedMessage('q1')
    expect(activeSession().queuedMessages.map((m) => m.id)).toEqual(['q1'])
    expect(activeSession().draftText).toBe('kept')
  })

  it('editQueuedMessage skips dequeue entirely when the message id is unknown', async () => {
    setupProject()
    patchSession({ queuedMessages: [queued('q1', 'first')] })

    await useChatStore.getState().editQueuedMessage('ghost')
    expect(mockWindowAgent.dequeueMessage).not.toHaveBeenCalled()
  })

  it('deleteQueuedMessage removes the message but never touches draftText', async () => {
    setupProject()
    patchSession({
      queuedMessages: [queued('q1', 'first'), queued('q2', 'second')],
      draftText: 'keep me',
    })

    await useChatStore.getState().deleteQueuedMessage('q2')
    expect(mockWindowAgent.dequeueMessage).toHaveBeenCalledWith(PATH, 'q2')
    expect(activeSession().queuedMessages.map((m) => m.id)).toEqual(['q1'])
    expect(activeSession().draftText).toBe('keep me')
  })

  it('deleteQueuedMessage is a no-op when the backend rejects dequeue', async () => {
    mockWindowAgent.dequeueMessage.mockResolvedValueOnce(false as never)
    setupProject()
    patchSession({ queuedMessages: [queued('q1', 'first')] })

    await useChatStore.getState().deleteQueuedMessage('q1')
    expect(activeSession().queuedMessages.map((m) => m.id)).toEqual(['q1'])
  })
})

describe('session-slice: setDraftText', () => {
  it('writes the draft and clears the codex-plan-reject hint when text becomes non-empty', () => {
    setupProject()
    patchSession({ codexPlanRejectHintActive: true })
    useChatStore.getState().setDraftText('typing')
    expect(activeSession().draftText).toBe('typing')
    expect(activeSession().codexPlanRejectHintActive).toBe(false)
  })

  it('keeps the codex-plan-reject hint intact when text is cleared to empty', () => {
    setupProject()
    patchSession({ codexPlanRejectHintActive: true, draftText: 'x' })
    useChatStore.getState().setDraftText('')
    expect(activeSession().codexPlanRejectHintActive).toBe(true)
  })

  it('writes to the scoped target session, not the project-active one (mosaic pane isolation)', () => {
    setupProject()
    const proj = useChatStore.getState().projectSessions[PATH]
    const sidA = proj._activeSessionId!
    const sidB = 'session-b'
    // Mimic mosaic→single→mosaic: session B is the project-active one while
    // pane A (a non-active pane) re-syncs its own draft.
    useChatStore.setState({
      projectSessions: {
        ...useChatStore.getState().projectSessions,
        [PATH]: {
          ...proj,
          _activeSessionId: sidB,
          _sessions: { ...proj._sessions, [sidB]: { ...proj._sessions[sidA], draftText: '' } },
        },
      },
    })

    useChatStore.getState().setDraftText('hello', { projectPath: PATH, sessionId: sidA })

    const after = useChatStore.getState().projectSessions[PATH]
    expect(after._sessions[sidA].draftText).toBe('hello')
    expect(after._sessions[sidB].draftText).toBe('')
  })
})

// A non-active mosaic pane writing per-session state must hit its own session,
// never the project's active one. setupTwoSessions returns { active, other }
// where `other` is the non-active pane mimicked by a mosaic tile.
function setupTwoSessions() {
  setupProject()
  const proj = useChatStore.getState().projectSessions[PATH]
  const active = proj._activeSessionId!
  const other = 'session-other'
  useChatStore.setState({
    projectSessions: {
      ...useChatStore.getState().projectSessions,
      [PATH]: {
        ...proj,
        _sessions: { ...proj._sessions, [other]: { ...proj._sessions[active] } },
      },
    },
  })
  return { active, other }
}

function sessionOf(sid: string) {
  return useChatStore.getState().projectSessions[PATH]._sessions[sid]
}

describe('per-session writers: scoped target isolation', () => {
  it('addAttachment lands on the scoped pane, leaving the active session untouched', () => {
    const { active, other } = setupTwoSessions()
    const att = { mimeType: 'image/png', base64: 'aaaa', name: 'a.png' }
    useChatStore.getState().addAttachment(att, { projectPath: PATH, sessionId: other })
    expect(sessionOf(other).attachments.map((a) => a.name)).toEqual(['a.png'])
    expect(sessionOf(active).attachments).toEqual([])
  })

  it('addMention / removeMention target the scoped pane only', () => {
    const { active, other } = setupTwoSessions()
    const target = { projectPath: PATH, sessionId: other }
    useChatStore.getState().addMention({ kind: 'file', value: 'a.ts', displayName: 'a.ts' }, target)
    expect(sessionOf(other).mentions.map((m) => m.value)).toEqual(['a.ts'])
    expect(sessionOf(active).mentions).toEqual([])
    useChatStore.getState().removeMention('a.ts', target)
    expect(sessionOf(other).mentions).toEqual([])
  })

  it('toggleMiniAppContext flips the scoped pane only', () => {
    const { active, other } = setupTwoSessions()
    const slot = { appId: 'x', appName: 'X', summary: '', content: '', mode: 'inject' as const, checked: true }
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: {
          ...s.projectSessions[PATH],
          _sessions: {
            ...s.projectSessions[PATH]._sessions,
            [other]: { ...s.projectSessions[PATH]._sessions[other], miniAppContexts: { x: slot } },
            [active]: { ...s.projectSessions[PATH]._sessions[active], miniAppContexts: { x: slot } },
          },
        },
      },
    }))
    useChatStore.getState().toggleMiniAppContext('x', { projectPath: PATH, sessionId: other })
    expect(sessionOf(other).miniAppContexts.x.checked).toBe(false)
    expect(sessionOf(active).miniAppContexts.x.checked).toBe(true)
  })

  it('editQueuedMessage restores draft into the scoped pane, not the active one', async () => {
    const { active, other } = setupTwoSessions()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: {
          ...s.projectSessions[PATH],
          _sessions: {
            ...s.projectSessions[PATH]._sessions,
            [other]: {
              ...s.projectSessions[PATH]._sessions[other],
              queuedMessages: [{ id: 'q1', content: [{ type: 'text', text: 'queued' }], attachments: [] } as unknown as ChatMessage],
              draftText: '',
            },
          },
        },
      },
    }))
    await useChatStore.getState().editQueuedMessage('q1', { projectPath: PATH, sessionId: other })
    expect(sessionOf(other).draftText).toBe('queued')
    expect(sessionOf(other).queuedMessages).toEqual([])
    expect(sessionOf(active).draftText).toBe('')
  })
})

describe('session-slice: assignSubagentColor', () => {
  it('assigns a color from the pool, removes it from _subagentColorsFree, and is idempotent per toolUseId', () => {
    setupProject()
    useChatStore.getState().assignSubagentColor('use-1')
    const after1 = activeSession()
    const color1 = after1.subagentColors['use-1']
    expect(typeof color1).toBe('number')
    expect(after1._subagentColorsFree).not.toContain(color1)

    const freeBefore = after1._subagentColorsFree
    useChatStore.getState().assignSubagentColor('use-1')
    expect(activeSession().subagentColors['use-1']).toBe(color1)
    expect(activeSession()._subagentColorsFree).toEqual(freeBefore)
  })

  it('replenishes the pool from freshSubagentColorPool() when _subagentColorsFree is empty', () => {
    setupProject()
    patchSession({ _subagentColorsFree: [] })
    useChatStore.getState().assignSubagentColor('use-1')
    expect(typeof activeSession().subagentColors['use-1']).toBe('number')
    // pool was empty, refilled, then one color taken → fewer than the full pool remain
    expect(activeSession()._subagentColorsFree.length).toBeGreaterThan(0)
  })
})

describe('session-slice: setDetailedUsage', () => {
  it('writes detailedUsage for an existing session', () => {
    setupProject()
    const sid = activeProjectState()._activeSessionId!
    const usage = { contextTokens: 12345, contextWindow: 200000 }

    useChatStore.getState().setDetailedUsage(PATH, sid, usage as never)
    expect(activeSession().detailedUsage).toEqual(usage)
  })

  it('is a no-op for an unknown session id and never creates phantom session entries', () => {
    setupProject()
    const before = useChatStore.getState().projectSessions[PATH]
    useChatStore.getState().setDetailedUsage(PATH, 'unknown-sid', { x: 1 } as never)
    expect(useChatStore.getState().projectSessions[PATH]).toBe(before)
  })
})

describe('session-slice: removeSessionFromMemory', () => {
  it('drops the session entry and tells the activity-view-state store to clean up', () => {
    setupProject()
    const sid = activeProjectState()._activeSessionId!
    useChatStore.getState().removeSessionFromMemory(PATH, sid)

    expect(activeProjectState()._sessions[sid]).toBeUndefined()
    expect(mockClearForSession).toHaveBeenCalledWith(sid)
  })

  it('is a strict no-op when the session id does not exist on the project — no activity-view-state ping either', () => {
    setupProject()
    const before = useChatStore.getState().projectSessions[PATH]
    useChatStore.getState().removeSessionFromMemory(PATH, 'ghost-sid')
    expect(useChatStore.getState().projectSessions[PATH]).toBe(before)
    expect(mockClearForSession).not.toHaveBeenCalled()
  })

  it('is a strict no-op when the projectPath has no project entry at all', () => {
    useChatStore.getState().removeSessionFromMemory('/no-such-project', 'sid')
    expect(useChatStore.getState().projectSessions).toEqual({})
    expect(mockClearForSession).not.toHaveBeenCalled()
  })
})
