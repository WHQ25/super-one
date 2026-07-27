import { create } from 'zustand'
import { useAppStore } from '../app'
import { useActivityViewStateStore } from '../activity-view-state'
import { buildSlashCommands, extractModeFromSuggestions, findCheckpointTarget } from './helpers/chat-helpers'
import {
  accumulateCodexFooterTokens,
  type CodexCommand,
  findLatestCodexUsage,
  formatCodexAuthStatus,
  getCodexUsageStepTokens,
  getLatestCodexThreadId,
  hasValidCodexUsageSnapshot,
  parseCodexCommand,
  removeCodexItem,
  resolveCodexModelSelection,
  resolveCodexReasoningEffort,
  upsertCodexItem,
} from './helpers/codex-helpers'
import {
  applyDelta,
  extractSessionTitle,
  mergeMessagesByMaxSeq,
} from './helpers/event-helpers'
import {
  inferProviderFromHarnessId,
  resolveProvider,
} from './helpers/provider-routing'
import { checkAutoModeEligibility } from '@/lib/auto-mode-eligibility'
import { PERMISSION_MODES } from '@/components/chat/PermissionModeList'
import { extractPartialToolInput } from '@/components/chat/tool-display'
import type { AccountInfo, AgentEvent, AgentInfo, AgentPrewarmHint, AgentStatus, AskUserQuestionRequest, ChatMessage, ChatMessageContext, ClaudeResources, CodexAgentMessageItem, CodexAuthMode, CodexAuthStatus, CodexCollaborationMode, CodexPermissionPreset, CodexPlanApprovalState, CodexReasoningEffort, CodexResources, CodexReviewTarget, CodexThreadItem, CodexUsageInfo, ContentBlock, ContextUsageInfo, EffortLevel, HarnessId, HarnessResourcesMap, ImageAttachment, ModelOption, PlanApprovalRequest, PermissionMode, PermissionRequest, QuestionAnnotations, RewindFilesResult, SandboxInfo, SandboxMode, SessionHistoryEntry, SessionInfo, SkillInfo, SlashCommandInfo, TodoItem, UserQuestion } from '@superone/shared/agent-types'
import { applySeqToMessage, compareMessageSeq, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'

import type {
  ActiveSessionView,
  ChatProvider,
  ChatStore,
  Corner,
  Mention,
  MiniAppContextSlot,
  PerSessionState,
  PersistedSessionState,
  ProjectState,
  ToolRendererState,
} from './types'
export type {
  ChatProvider,
  ChatStore,
  Corner,
  ActiveSessionView,
  MentionKind,
  Mention,
  MiniAppContextSlot,
  PerSessionState,
  PersistedSessionState,
  ProjectState,
  SessionWriteTarget,
  ToolRendererState,
  SubagentColor,
} from './types'
export { SUBAGENT_COLOR_POOL } from './types'
export type { BrowserAnnotation } from './helpers/browser-annotation'
export const DEFAULT_PROVIDER: ChatProvider = 'claude'
export const SESSIONS_PAGE_SIZE = 30
const CODEX_LAST_SELECTION_STORAGE_KEY = 'super-one.codex.last-selection.v1'
export const CODEX_REJECT_PLAN_PLACEHOLDER = 'Tell Codex what to do differently'

export const CLAUDE_INTERCEPTED_COMMANDS: Record<string, () => Promise<void>> = {
  clear: async () => {
    await useChatStore.getState().resetSession()
  },
  provider: async () => {
    useChatStore.getState().openProviderPopup()
  },
  mcp: async () => {
    useChatStore.getState().openMcpPopup()
  },
}

export const CLAUDE_INTERCEPTED_COMMAND_NAMES: ReadonlySet<string> =
  new Set(Object.keys(CLAUDE_INTERCEPTED_COMMANDS))

export async function runClaudeInterceptedCommand(name: string): Promise<void> {
  const handler = CLAUDE_INTERCEPTED_COMMANDS[name]
  if (handler) await handler()
}

import { createDefaultPerSessionState, createDefaultProjectState, createSessionId, freshSubagentColorPool, getDefaultEffortForModel } from './defaults'
export { createDefaultPerSessionState, createDefaultProjectState, createSessionId, getDefaultEffortForModel } from './defaults'
export { applyEventToSession } from './event-reducer'

export function markMessageEventApplied(messages: ChatMessage[], messageId: string, event: AgentEvent): ChatMessage[] | null {
  if (event.seq === undefined) return null
  return messages.map((msg) => (
    msg.id === messageId ? { ...msg, ...applySeqToMessage(event) } : msg
  ))
}

export function persistStreamingToolInput(messages: ChatMessage[], messageId: string, toolUseId: string, input: string | undefined): ChatMessage[] {
  if (input === undefined) return messages
  return messages.map((msg) => {
    if (msg.id !== messageId) return msg
    return {
      ...msg,
      content: msg.content.map((block) => (
        block.type === 'tool_use' && block.toolUseId === toolUseId && block.input !== input
          ? { ...block, input }
          : block
      )),
    }
  })
}

// PerSessionState / ProjectState / ActiveSessionView are now defined in ./types
// createSessionId / createDefaultPerSessionState / getDefaultEffortForModel moved to ./defaults

export {
  _computeClaudeDefaultPatch,
  _computeCodexDefaultPatch,
  _reapplyAgentDefaultsToSessions,
  applyDefaultModel,
  applySessionAgentDefaults,
  resolveDefaultClaudeEffort,
  resolveDefaultClaudeModel,
} from './helpers/agent-defaults'

import {
  _reapplyAgentDefaultsToSessions,
  applyDefaultModel,
  applySessionAgentDefaults,
} from './helpers/agent-defaults'

// createDefaultProjectState moved to ./defaults

// --- Store interface ---
// ToolRendererState / ChatStore are now defined in ./types

export {
  getProject,
  getActivePerSession,
  getScopedPerSession,
  mergeProjectAndSessionDirs,
  triggerPrewarm,
  schedulePrewarm,
  cancelPrewarm,
  inheritMiniAppToolsForNewSession,
  updateProjectState,
  updatePerSession,
  updateActivePerSession,
  commitPerSession,
  resolveActiveSessionId,
} from './helpers/store-helpers'

import {
  getProject,
  getActivePerSession,
  getScopedPerSession,
  mergeProjectAndSessionDirs,
  triggerPrewarm,
  schedulePrewarm,
  cancelPrewarm,
  inheritMiniAppToolsForNewSession,
  updateProjectState,
  updatePerSession,
  updateActivePerSession,
  commitPerSession,
  resolveActiveSessionId,
} from './helpers/store-helpers'

export {
  createLocalTextUserMessage,
  getCodexCompletionEventMeta,
  getCodexContextTokens,
  getCodexHelpText,
  getCodexPlanActionContext,
  getCodexTraceItems,
  isRunnableCodexCommand,
  pruneTransientCodexItems,
  readLastCodexSelection,
  resolveDefaultCodexSelection,
  resolveSessionCodexSelection,
  saveLastCodexSelection,
  summarizeCodexTraceItem,
  updateCodexPlanApproval,
  type CodexRunnableCommand,
} from './helpers/codex-helpers'

import {
  createLocalTextUserMessage,
  getCodexCompletionEventMeta,
  getCodexContextTokens,
  getCodexHelpText,
  getCodexPlanActionContext,
  isRunnableCodexCommand,
  pruneTransientCodexItems,
  resolveDefaultCodexSelection,
  resolveSessionCodexSelection,
  updateCodexPlanApproval,
  type CodexRunnableCommand,
} from './helpers/codex-helpers'

export {
  _getEffectiveSessionId,
  _createLocalCodexSessionId,
  _isLocalCodexSessionId,
  _getSessionGitBranch,
  _getSessionCwd,
  _mergeHydratedSessionState,
  _mergePersistedMessages,
  _mergePersistedSessionState,
  _ensureSessionHydrated,
  _hydrateSessionState,
} from './helpers/persistence'

import {
  _createLocalCodexSessionId,
  _ensureSessionHydrated,
  _getEffectiveSessionId,
  _getSessionCwd,
  _getSessionWorktreePath,
  _hydrateSessionState,
  _isLocalCodexSessionId,
  _mergeHydratedSessionState,
} from './helpers/persistence'

export {
  _clearDefaultPrefsCache,
  _getDefaultPermissionMode,
  _loadDefaultSessionPrefs,
  applyCachedCodexPermissionPreset,
  defaultPrefsCache,
  sandboxModeToInfo,
} from './helpers/prefs-cache'

import {
  _clearDefaultPrefsCache,
  _getDefaultPermissionMode,
  _loadDefaultSessionPrefs,
  applyCachedCodexPermissionPreset,
  defaultPrefsCache,
  sandboxModeToInfo,
} from './helpers/prefs-cache'

export function invalidateDefaultPermissionModeCache(): Promise<void> {
  _clearDefaultPrefsCache()
  return _loadDefaultSessionPrefs()
}

export function invalidateDefaultClaudePreferencesCache(): Promise<void> {
  _clearDefaultPrefsCache()
  return _loadDefaultSessionPrefs().then(() => _reapplyAgentDefaultsToSessions('claude'))
}

export function invalidateDefaultCodexPreferencesCache(): Promise<void> {
  _clearDefaultPrefsCache()
  return _loadDefaultSessionPrefs().then(() => _reapplyAgentDefaultsToSessions('codex'))
}

export {
  _buildQuestionAnswerItem,
  _computeHasPendingInteraction,
  _ensureClaudeSessionReadyForSend,
  _isBusyStatus,
  _isLiveSession,
  _needsForegroundActivation,
  _parkActiveSession,
  _syncAndResumeSession,
  _truncateAtCheckpoint,
  type ChatStoreSet,
} from './helpers/lifecycle'

import {
  _buildQuestionAnswerItem,
  _computeHasPendingInteraction,
  _ensureClaudeSessionReadyForSend,
  _isBusyStatus,
  _isLiveSession,
  _needsForegroundActivation,
  _parkActiveSession,
  _syncAndResumeSession,
  _truncateAtCheckpoint,
  type ChatStoreSet,
} from './helpers/lifecycle'

export { runCodexCommand } from './codex/runner'
import { runCodexCommand } from './codex/runner'
import { approveCodexPlanImpl, rejectCodexPlanImpl } from './codex/plan-actions'
import { sendMessageImpl } from './helpers/send-message'
import {
  clearMessagesImpl,
  disconnectRemoteSessionImpl,
  ensureSessionImpl,
  focusProjectImpl,
  interruptImpl,
  resetSessionForWorktreeSwitchImpl,
  resetSessionImpl,
  setPreferredProviderImpl,
  setAcpAgentIdImpl,
  ensureAcpSlashCommandsImpl,
} from './helpers/session-lifecycle'
import {
  answerQuestionImpl,
  cyclePermissionModeImpl,
  dismissQuestionImpl,
  respondToPermissionImpl,
  respondToPlanApprovalImpl,
  setPermissionModeImpl,
  setSandboxModeImpl,
  setSessionApiProviderIdImpl,
  togglePlanModeShortcutImpl,
} from './helpers/interaction'
import { resetLock } from './helpers/lifecycle'

// --- Store implementation ---

export function isRemoteSession(state: ChatStore, projectPath: string, sessionId: string | null | undefined): boolean {
  if (!sessionId) return false
  const ids = state.remoteSessions[projectPath]
  return !!ids && ids.includes(sessionId)
}

export function isMountedSession(state: ChatStore, projectPath: string, sessionId: string | null | undefined): boolean {
  if (!sessionId) return false
  const ids = state.mountedSessions[projectPath]
  return !!ids && ids.includes(sessionId)
}

function addSessionToRegistry(map: Record<string, string[]>, projectPath: string, sessionId: string): Record<string, string[]> {
  const existing = map[projectPath] ?? []
  if (existing.includes(sessionId)) return map
  return { ...map, [projectPath]: [...existing, sessionId] }
}

function removeSessionFromRegistry(map: Record<string, string[]>, projectPath: string, sessionId: string): Record<string, string[]> {
  const existing = map[projectPath]
  if (!existing || !existing.includes(sessionId)) return map
  const next = existing.filter((id) => id !== sessionId)
  if (next.length === 0) {
    const { [projectPath]: _omit, ...rest } = map
    return rest
  }
  return { ...map, [projectPath]: next }
}

export const addRemoteSession = addSessionToRegistry
export const removeRemoteSession = removeSessionFromRegistry
export const addMountedSession = addSessionToRegistry
export const removeMountedSession = removeSessionFromRegistry

import type { HarnessHandler, HarnessHandlerMap } from './harness/harness-handler'
import { applyAcpResources, connectAcpResources, getCachedAcpCatalog, refreshAcpModels, sessionPatchFromAcpCatalog } from './harness/acp-handler'
import { applyClaudeResources } from './harness/claude-handler'
import { applyCodexResources } from './harness/codex-handler'
import { applyOpenCodeResources, resolveDefaultOpenCodeAgent, resolveDefaultOpenCodeSelection } from './harness/opencode-handler'

const harnessHandlers: HarnessHandlerMap = {
  claude: {
    connect: () => window.app.connectClaude(),
    apply: (s, r) => applyClaudeResources(s, r, applyDefaultModel),
  },
  codex: {
    connect: () => window.app.connectCodex(),
    apply: (s, r) => applyCodexResources(s, r, resolveSessionCodexSelection),
  },
  acp: {
    // Serve disk cache immediately; background refresh runs once per app open in main.
    connect: () => connectAcpResources(),
    apply: (s, r) => applyAcpResources(s, r),
  },
  opencode: {
    connect: () => window.app.connectOpenCode(),
    apply: (s, r) => applyOpenCodeResources(s, r),
  },
}

import { createToolSlice } from './slices/tool-slice'
import { createClaudeSlice } from './slices/claude-slice'
import { createCodexSlice } from './slices/codex-slice'
import { createSessionSlice } from './slices/session-slice'
import { createCoreSlice } from './slices/core-slice'
import { createEventSlice } from './slices/event-slice'
import { createOpenCodeSlice } from './slices/opencode-slice'

export const useChatStore = create<ChatStore>((set, get, store) => ({
  ...createToolSlice(set, get, store),
  ...createClaudeSlice(set, get, store),
  ...createCodexSlice(set, get, store),
  ...createSessionSlice(set, get, store),
  ...createCoreSlice(set, get, store),
  ...createEventSlice(set, get, store),
  ...createOpenCodeSlice(set, get, store),

  projectSessions: {},
  activeProject: null,
  remoteSessions: {},
  mountedSessions: {},
  _previousFocusedSession: null,
  agentTitles: {},

  isOpen: false,
  corner: 'br',
  harnessResources: { claude: null, codex: null, acp: null, opencode: null },
  initializedHarnesses: new Set<HarnessId>(),
  claudeResourcesLoading: false,
  disabledSkills: [],

  setHarnessResources: (harness, resources) => {
    const handler = harnessHandlers[harness] as HarnessHandler<typeof harness>
    set((s) => handler.apply(s, resources))
  },

  initializeHarness: async (harness) => {
    if (get().initializedHarnesses.has(harness)) return
    set((s) => ({ initializedHarnesses: new Set([...s.initializedHarnesses, harness]) }))
    try {
      const handler = harnessHandlers[harness] as HarnessHandler<typeof harness>
      const resources = await handler.connect()
      get().setHarnessResources(harness, resources)
      // ACP: re-pull once after main's per-launch model probe (cache-first, then refresh).
      if (harness === 'acp') {
        void refreshAcpModels().then((fresh) => {
          if (fresh) get().setHarnessResources('acp', fresh)
        })
      }
    } catch (err) {
      set((s) => {
        const next = new Set(s.initializedHarnesses)
        next.delete(harness)
        return { initializedHarnesses: next }
      })
      console.warn(`[initializeHarness:${harness}] failed:`, err)
    }
  },

  setDisabledSkills: (list: string[]) => {
    set((s) => {
      const claude = s.harnessResources.claude
      const disabledSet = new Set(list)
      const projects = { ...s.projectSessions }
      let changed = false
      for (const [path, project] of Object.entries(projects)) {
        if (!project._activeSessionId) continue
        projects[path] = {
          ...project,
          slashCommands: buildSlashCommands(
            claude?.slashCommands ?? [], claude?.skills ?? [], claude?.commands ?? [],
            project._projectSkills, project._projectCommands,
            disabledSet,
          ),
        }
        changed = true
      }
      return changed
        ? { disabledSkills: list, projectSessions: projects }
        : { disabledSkills: list }
    })
  },

  // handleAgentEvent + syncLiveSnapshots now provided by createEventSlice

  focusProject: async (projectPath) => focusProjectImpl(set, get, projectPath),

  ensureSession: (projectPath) => ensureSessionImpl(set, projectPath),

  sendMessage: async (content, segments, explicitMentions, attachments, target) => sendMessageImpl(set, get, content, segments, explicitMentions, attachments, target),

  approveCodexPlan: async () => approveCodexPlanImpl(set, get),

  rejectCodexPlan: async (feedback) => rejectCodexPlanImpl(set, get, feedback),

  disconnectRemoteSession: () => disconnectRemoteSessionImpl(set, get),

  interrupt: async () => interruptImpl(set, get),

  clearMessages: () => clearMessagesImpl(set, get),

  resetSessionForWorktreeSwitch: (projectPath, opts) => resetSessionForWorktreeSwitchImpl(set, get, projectPath, opts),

  resetSession: async () => resetSessionImpl(set, get),

  // rewindFiles / rewindCodeAndChat / rewindConversation / previewRewind
  // editQueuedMessage / deleteQueuedMessage / setDraftText / assignSubagentColor /
  // setDetailedUsage now provided by createSessionSlice

  // setSelectedModel / setSelectedEffort / setFastMode now provided by createClaudeSlice
  // setSelectedCodexModel / setSelectedCodexReasoningEffort / setSelectedCodexPermissionPreset /
  // setSelectedCodexCollaborationMode / refreshCodexModels / refreshCodexSkills now provided by createCodexSlice

  setPreferredProvider: (provider) => setPreferredProviderImpl(set, get, provider),
  setAcpAgentId: (agentId) => setAcpAgentIdImpl(set, get, agentId),
  ensureAcpSlashCommands: () => ensureAcpSlashCommandsImpl(set, get),

  // addAttachment / removeAttachment / clearAttachments now provided by createCoreSlice

  respondToPermission: async (requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers) =>
    respondToPermissionImpl(set, get, requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers),
  setPermissionMode: async (mode) => setPermissionModeImpl(set, get, mode),
  answerQuestion: (requestId, answers, annotations) => answerQuestionImpl(set, get, requestId, answers, annotations),
  dismissQuestion: (requestId) => dismissQuestionImpl(set, get, requestId),
  respondToPlanApproval: (requestId, approved, feedback, postApprovalMode) =>
    respondToPlanApprovalImpl(set, get, requestId, approved, feedback, postApprovalMode),
  setSandboxMode: async (mode) => setSandboxModeImpl(set, get, mode),
  cyclePermissionMode: () => cyclePermissionModeImpl(get),
  togglePlanModeShortcut: () => togglePlanModeShortcutImpl(get),

  // dismissSlashCommandOutput / openProviderPopup / openMcpPopup now provided by createCoreSlice

  setSessionApiProviderId: async (apiProviderId) => setSessionApiProviderIdImpl(set, get, apiProviderId),

  // toggleTodos / addMention / removeMention / setMiniAppContext / clearMiniAppContext /
  // toggleMiniAppContext / addUserSelection / removeUserSelectionAt / clearUserSelections
  // now provided by createCoreSlice

  fetchSessions: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    try {
      const sessions = await window.app.listSessionsForFolderPage(activeProject, SESSIONS_PAGE_SIZE, 0)
      set((s) => updateProjectState(s, activeProject, () => ({
        sessions,
        sessionsPage: 1,
        sessionsHasMore: sessions.length >= SESSIONS_PAGE_SIZE,
      })))
    } catch (err) { console.warn('[chat] fetchSessions failed:', err) }
  },

  fetchSessionsPage: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    if (!project.sessionsHasMore) return
    const pageToFetch = project.sessionsPage
    const offset = pageToFetch * SESSIONS_PAGE_SIZE
    try {
      const page = await window.app.listSessionsForFolderPage(activeProject, SESSIONS_PAGE_SIZE, offset)
      set((s) => updateProjectState(s, activeProject, (proj) => {
        if (proj.sessionsPage !== pageToFetch) return {}
        return {
          sessions: [...proj.sessions, ...page],
          sessionsPage: pageToFetch + 1,
          sessionsHasMore: page.length >= SESSIONS_PAGE_SIZE,
        }
      }))
    } catch (err) { console.warn('[chat] fetchSessionsPage failed:', err) }
  },

  switchToSession: async (projectPath, sessionId) => {
    const state = get()
    if (projectPath === state.activeProject) {
      const activeSid = state.projectSessions[projectPath]?._activeSessionId ?? null
      if (sessionId === activeSid) return
      await get().switchSession(sessionId)
      return
    }
    // Cross-project hop goes through useAppStore.selectProject so the sidebar's
    // currentFolder/currentProjectId update too, not just useChatStore.activeProject.
    await useAppStore.getState().selectProject(projectPath)
    const fresh = get()
    if (fresh.projectSessions[projectPath]?._activeSessionId !== sessionId) {
      await fresh.switchSession(sessionId)
    }
  },

  renameSession: async (sessionId, title) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.app.renameSession(sessionId, title)
    set((s) => updateProjectState(s, activeProject, (proj) => ({
      sessions: proj.sessions.map((entry) =>
        entry.sessionId === sessionId ? { ...entry, title } : entry
      ),
    })))
  },

  switchSession: async (sessionId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    {
      const activeSession = getActivePerSession(get())
      window.app.trace?.('session.lifecycle', 'switchSession', {
        from: project._activeSessionId,
        to: sessionId,
        fromStatus: activeSession.status,
        fromAwaitingReply: activeSession.awaitingAssistantReply,
        fromProvider: activeSession.sessionProvider,
        toInSessions: !!project._sessions[sessionId],
        knownSids: Object.keys(project._sessions),
      })
    }

    // Track the outgoing session as "previous" so Ctrl+Tab can bounce back even if it's idle.
    const prevSid = project._activeSessionId
    if (prevSid && prevSid !== sessionId) {
      set((s) => ({
        ...updateProjectState(s, activeProject, () => ({ _previousSessionId: prevSid })),
        _previousFocusedSession: { projectPath: activeProject, sessionId: prevSid },
      }))
    }

    if (project.unseenCompletedSessions.has(sessionId)) {
      set((s) => {
        const proj = s.projectSessions[activeProject]
        if (!proj) return {}
        const next = new Set(proj.unseenCompletedSessions)
        next.delete(sessionId)
        return { projectSessions: { ...s.projectSessions, [activeProject]: { ...proj, unseenCompletedSessions: next } } }
      })
    }

    // Case A: Session already in _sessions (background streaming or parked)
    if (project._sessions[sessionId]) {
      const activeSession = getActivePerSession(get())
      if (_isBusyStatus(activeSession.status) || activeSession.awaitingAssistantReply) {
        await _parkActiveSession(activeProject, project._activeSessionId)
      }

      const cachedTarget = project._sessions[sessionId]
      const worktreeMissing =
        !!cachedTarget._worktreePath &&
        !cachedTarget._worktreeRemoved &&
        !(await window.app.pathExists(cachedTarget._worktreePath))

      set((s) => {
        const proj = getProject(s, activeProject)
        const targetSession = proj._sessions[sessionId]
        const nextCwd = worktreeMissing ? activeProject : _getSessionCwd(activeProject, targetSession)
        const cwdPatched: PerSessionState = worktreeMissing
          ? { ...targetSession, _worktreeRemoved: true, cwd: activeProject }
          : targetSession.cwd === nextCwd
            ? targetSession
            : { ...targetSession, cwd: nextCwd }
        // An explicit history selection must not trust a provider-less empty cache.
        // This state can be produced by an earlier load that raced the first DB save;
        // mark it pending so Case A retries the persisted transcript below.
        const providerMismatched = _isLocalCodexSessionId(sessionId)
          && cwdPatched.sessionProvider !== null
          && cwdPatched.sessionProvider !== 'codex'
        const providerMissingOrMismatched = !cwdPatched.sessionProvider || providerMismatched
        const patched = providerMissingOrMismatched
          && cwdPatched.messages.length === 0
          && cwdPatched._historyHydrated
          ? {
              ...cwdPatched,
              ...(providerMismatched ? { sessionProvider: null } : {}),
              _historyHydrated: false,
            }
          : cwdPatched
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: sessionId,
              _sessions: patched === targetSession
                ? proj._sessions
                : { ...proj._sessions, [sessionId]: patched },
            },
          },
        }
      })

      let targetSession = get().projectSessions[activeProject]!._sessions[sessionId]

      if (!targetSession._historyHydrated) {
        const hydrated = await _ensureSessionHydrated(sessionId, targetSession)
        if (hydrated) {
          set((s) => {
            const proj = s.projectSessions[activeProject]
            const currentSession = proj?._sessions[sessionId]
            if (!proj || !currentSession) return {}
            const merged = currentSession === targetSession
              ? hydrated
              : _mergeHydratedSessionState(currentSession, hydrated)
            return {
              projectSessions: {
                ...s.projectSessions,
                [activeProject]: {
                  ...proj,
                  _sessions: { ...proj._sessions, [sessionId]: merged },
                },
              },
            }
          })
          targetSession = get().projectSessions[activeProject]!._sessions[sessionId] ?? hydrated
        }
      }

      const runtimeSession = targetSession

      window.app.trace?.('agent.store', 'switchSession:A', {
        sessionId,
        _worktreePath: targetSession._worktreePath,
        _gitBranch: targetSession._gitBranch,
        _worktreeRemoved: targetSession._worktreeRemoved,
      })
      useAppStore.getState().setActiveWorktree(activeProject, _getSessionWorktreePath(targetSession))

      const defaultsPatch = applySessionAgentDefaults(
        targetSession,
        getProject(get(), activeProject),
        get().harnessResources.claude?.models ?? [],
      )
      if (Object.keys(defaultsPatch).length > 0) {
        set((s) => updatePerSession(s, activeProject, sessionId, () => defaultsPatch))
      }

      try {
        await _syncAndResumeSession(activeProject, sessionId, set, _getSessionCwd(activeProject, runtimeSession))
      } catch (err) {
        console.warn('[chat] resumeSession failed:', err)
      }
      return
    }

    // Case B: Load from DB
    let savedMessages: ChatMessage[] = []
    let savedCost = 0
    let savedTokens = 0
    let savedGitBranch: string | null = null
    let savedWorktreePath: string | undefined
    let savedProvider: string | null = null
    let savedApiProviderId: string | null = null
    let savedAcpAgentId: string | null = null
    let savedOpenCodeAgentId: string | null = null
    let savedTitle: string | null = null
    try {
      const saved = await window.app.loadSessionState(sessionId) as PersistedSessionState | null
      if (saved) {
        savedMessages = saved.messages
        savedCost = saved.totalCostUsd
        savedTokens = saved.contextTokens
        savedGitBranch = saved.gitBranch
        savedProvider = saved.provider
        savedWorktreePath = saved.worktreePath ?? undefined
        savedApiProviderId = saved.apiProviderId ?? null
        savedAcpAgentId = saved.acpAgentId ?? null
        savedOpenCodeAgentId = saved.messages.findLast((message) => message.role === 'assistant')?.metadata?.agent ?? null
        savedTitle = saved.title ?? null
      }
    } catch (err) { console.warn('[chat] loadSessionState failed:', err) }

    const restoredProvider: ChatProvider = (savedProvider as ChatProvider) ?? DEFAULT_PROVIDER
    const restoredCodexUsage = findLatestCodexUsage(savedMessages)

    const freshProject = getProject(get())
    const freshActiveSession = getActivePerSession(get())
    if (_isBusyStatus(freshActiveSession.status)) {
      await _parkActiveSession(activeProject, freshProject._activeSessionId)
    }

    const defaultPermissionMode = await _getDefaultPermissionMode()
    const restoredSession: PerSessionState = {
      ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()),
      cwd: _getSessionCwd(activeProject, { _worktreePath: savedWorktreePath ?? null, _worktreeRemoved: false }),
      messages: savedMessages,
      totalCostUsd: savedCost,
      contextTokens: savedTokens,
      contextWindow: restoredCodexUsage?.contextWindow && restoredCodexUsage.contextWindow > 0
        ? restoredCodexUsage.contextWindow
        : null,
      codexUsageSnapshot: restoredCodexUsage,
      _gitBranch: savedGitBranch,
      _worktreePath: savedWorktreePath ?? null,
      preferredProvider: restoredProvider,
      sessionProvider: restoredProvider,
      lastAssistantMessageId: savedMessages.findLast((m) => m.role === 'assistant')?.id ?? null,
      apiProviderId: savedApiProviderId,
      acpAgentId: restoredProvider === 'acp' ? savedAcpAgentId : null,
      openCodeAgentId: restoredProvider === 'opencode'
        ? savedOpenCodeAgentId ?? resolveDefaultOpenCodeAgent(get().harnessResources.opencode?.agents ?? [])
        : null,
      _title: savedTitle,
      _historyHydrated: true,
      permissionMode: defaultPermissionMode,
    }
    if (restoredProvider === 'acp' && savedAcpAgentId) {
      const catalog = getCachedAcpCatalog(get().harnessResources.acp, savedAcpAgentId)
      if (catalog) Object.assign(restoredSession, sessionPatchFromAcpCatalog(catalog))
    } else if (restoredProvider === 'opencode') {
      const selection = resolveDefaultOpenCodeSelection(get().harnessResources.opencode?.models ?? [])
      if (selection.modelId) restoredSession.selectedModel = selection.modelId
      restoredSession.selectedEffort = selection.effort
    } else {
      Object.assign(
        restoredSession,
        applySessionAgentDefaults(restoredSession, freshProject, get().harnessResources.claude?.models ?? []),
      )
    }

    set((s) => {
      const proj = getProject(s, activeProject)
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _activeSessionId: sessionId,
            _sessions: { ...proj._sessions, [sessionId]: restoredSession },
          },
        },
      }
    })

    window.app.trace?.('agent.store', 'switchSession:B', {
      sessionId,
      savedWorktreePath,
      savedGitBranch,
    })
    if (savedWorktreePath) {
      useAppStore.getState().setActiveWorktree(activeProject, savedWorktreePath)
    } else {
      useAppStore.getState().setActiveWorktree(activeProject, null)
    }

    try {
      await _syncAndResumeSession(activeProject, sessionId, set, _getSessionCwd(activeProject, getProject(get())._sessions[sessionId]))
    } catch (err) {
      console.warn('[chat] resumeSession failed:', err)
    }
    if (restoredProvider === 'acp') {
      triggerPrewarm(get(), activeProject)
    }
  },

  mountSession: async (projectPath, sessionId) => {
    set((s) => ({ mountedSessions: addMountedSession(s.mountedSessions, projectPath, sessionId) }))
    if (!get().projectSessions[projectPath]?._sessions[sessionId]) {
      set((s) => {
        const proj = s.projectSessions[projectPath] ?? createDefaultProjectState()
        if (proj._sessions[sessionId]) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...proj,
              _sessions: { ...proj._sessions, [sessionId]: { ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()), _historyHydrated: false } },
            },
          },
        }
      })
    }
    const sess = get().projectSessions[projectPath]?._sessions[sessionId]
    if (sess && !sess._historyHydrated) {
      _hydrateSessionState(set, projectPath, sessionId)
    } else if (sess && sess._title == null) {
      // Sessions hydrated via the live-message path are marked _historyHydrated
      // without ever loading the persisted title, so back-fill it from the DB
      // here — otherwise a mosaic tile would fall back to the first message while
      // the sidebar list shows the saved title.
      void window.app.loadSessionState(sessionId).then((saved) => {
        const title = (saved as PersistedSessionState | null)?.title ?? null
        if (!title) return
        set((s) => {
          const proj = s.projectSessions[projectPath]
          const cur = proj?._sessions[sessionId]
          if (!proj || !cur || cur._title != null) return {}
          return { projectSessions: { ...s.projectSessions, [projectPath]: { ...proj, _sessions: { ...proj._sessions, [sessionId]: { ...cur, _title: title } } } } }
        })
      }).catch((err) => console.warn('[mountSession] title back-fill failed:', err))
    }
  },

  unmountSession: (projectPath, sessionId) => {
    set((s) => ({ mountedSessions: removeMountedSession(s.mountedSessions, projectPath, sessionId) }))
  },

  addDir: (path, scope, target) => {
    const projectPath = target?.projectPath ?? get().activeProject
    if (!projectPath) return
    if (scope === 'session') {
      set((s) => {
        const sess = getScopedPerSession(s, target)
        const proj = getProject(s, projectPath)
        if (sess.additionalDirs.includes(path) || proj.projectAdditionalDirs.includes(path)) return {}
        return commitPerSession(s, target, () => ({
          additionalDirs: [...sess.additionalDirs, path],
          additionalDirsDirty: true,
        }))
      })
    } else {
      set((s) => {
        const sess = getScopedPerSession(s, target)
        const proj = getProject(s, projectPath)
        if (sess.additionalDirs.includes(path) || proj.projectLocalDirs.includes(path)) return {}
        window.agent.addProjectAdditionalDir(projectPath, path).catch(() => {})
        const nextLocal = [...proj.projectLocalDirs, path]
        const nextMerged = Array.from(new Set([...proj.projectSharedDirs, ...nextLocal]))
        const merged = { ...s, ...updateProjectState(s, projectPath, () => ({
          projectLocalDirs: nextLocal,
          projectAdditionalDirs: nextMerged,
        })) } as ChatStore
        return commitPerSession(merged, target, () => ({ additionalDirsDirty: true }))
      })
    }
  },

  removeDir: (path, scope, target) => {
    const projectPath = target?.projectPath ?? get().activeProject
    if (!projectPath) return
    if (scope === 'session') {
      set((s) => commitPerSession(s, target, (sess) => ({
        additionalDirs: sess.additionalDirs.filter((d) => d !== path),
        additionalDirsDirty: true,
      })))
    } else {
      set((s) => {
        const proj = getProject(s, projectPath)
        if (!proj.projectLocalDirs.includes(path)) return {}
        window.agent.removeProjectAdditionalDir(projectPath, path).catch(() => {})
        const nextLocal = proj.projectLocalDirs.filter((d) => d !== path)
        const nextMerged = Array.from(new Set([...proj.projectSharedDirs, ...nextLocal]))
        const merged = { ...s, ...updateProjectState(s, projectPath, () => ({
          projectLocalDirs: nextLocal,
          projectAdditionalDirs: nextMerged,
        })) } as ChatStore
        return commitPerSession(merged, target, () => ({ additionalDirsDirty: true }))
      })
    }
  },

  // setShowDirManager / setShowReviewPanel now provided by createCoreSlice

  startCodexReview: (target) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateProjectState(s, activeProject, () => ({ showReviewPanel: false })))
    let command: string
    if (target.type === 'uncommittedChanges') command = '/review'
    else if (target.type === 'baseBranch') command = `/review branch ${target.branch}`
    else command = `/review commit ${target.sha}`
    get().sendMessage(command)
  },
}))

export {
  useActiveSession,
  getActiveSessionView,
  useIsRemoteLocked,
  useBashOutput,
  useShareProgress,
  selectClaudeResources,
  selectCodexResources,
  selectClaudeModels,
  selectCodexModels,
  selectCodexPrompts,
  selectActiveCodexSkills,
  selectClaudeAccount,
  selectClaudeSlashCommands,
  selectClaudeSkills,
  selectClaudeCommands,
  selectClaudeAgents,
  selectClaudeOutputStyles,
} from './selectors'

export { selectOpenCodeAgents, selectOpenCodeCommands } from './opencode-selectors'

export { SessionScopeProvider, useSessionScope, type SessionScope } from './session-scope'

export {
  type CodexCommand,
  accumulateCodexFooterTokens,
  findLatestCodexUsage,
  formatCodexAuthStatus,
  getLatestCodexThreadId,
  parseCodexCommand,
  removeCodexItem,
  resolveCodexModelSelection,
  resolveCodexReasoningEffort,
  upsertCodexItem,
} from './helpers/codex-helpers'

export {
  applyDelta,
  extractSessionTitle,
  mergeMessagesByMaxSeq,
} from './helpers/event-helpers'
