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
import { perfEvent } from '@/lib/perf-trace'

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
  ToolRendererState,
  SubagentColor,
} from './types'
export { SUBAGENT_COLOR_POOL } from './types'
export const DEFAULT_PROVIDER: ChatProvider = 'claude'
export const SESSIONS_PAGE_SIZE = 30
const CODEX_LAST_SELECTION_STORAGE_KEY = 'super-one.codex.last-selection.v1'
const CODEX_APPROVE_PLAN_PROMPT = 'Plan approved, start implementation.'
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
  mergeProjectAndSessionDirs,
  triggerPrewarm,
  schedulePrewarmKeepalive,
  inheritMiniAppToolsForNewSession,
  updateProjectState,
  updatePerSession,
  updateActivePerSession,
  resolveActiveSessionId,
} from './helpers/store-helpers'

import {
  getProject,
  getActivePerSession,
  mergeProjectAndSessionDirs,
  triggerPrewarm,
  schedulePrewarmKeepalive,
  inheritMiniAppToolsForNewSession,
  updateProjectState,
  updatePerSession,
  updateActivePerSession,
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
  _getWorktreeBranch,
  _getSessionCwd,
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
  _hydrateSessionState,
} from './helpers/persistence'

export {
  _clearDefaultPrefsCache,
  _getDefaultPermissionMode,
  _loadDefaultSessionPrefs,
  defaultPrefsCache,
  sandboxModeToInfo,
} from './helpers/prefs-cache'

import {
  _clearDefaultPrefsCache,
  _getDefaultPermissionMode,
  _loadDefaultSessionPrefs,
  defaultPrefsCache,
  sandboxModeToInfo,
} from './helpers/prefs-cache'

export function invalidateDefaultPermissionModeCache(): void {
  _clearDefaultPrefsCache()
  _loadDefaultSessionPrefs()
}

export function invalidateDefaultClaudePreferencesCache(): void {
  _clearDefaultPrefsCache()
  void _loadDefaultSessionPrefs().then(() => _reapplyAgentDefaultsToSessions('claude'))
}

export function invalidateDefaultCodexPreferencesCache(): void {
  _clearDefaultPrefsCache()
  void _loadDefaultSessionPrefs().then(() => _reapplyAgentDefaultsToSessions('codex'))
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
import { sendMessageImpl } from './helpers/send-message'
import { resetLock } from './helpers/lifecycle'

// --- Store implementation ---

export function isRemoteSession(state: ChatStore, projectPath: string, sessionId: string | null | undefined): boolean {
  if (!sessionId) return false
  const ids = state.remoteSessions[projectPath]
  return !!ids && ids.includes(sessionId)
}

export function addRemoteSession(map: Record<string, string[]>, projectPath: string, sessionId: string): Record<string, string[]> {
  const existing = map[projectPath] ?? []
  if (existing.includes(sessionId)) return map
  return { ...map, [projectPath]: [...existing, sessionId] }
}

export function removeRemoteSession(map: Record<string, string[]>, projectPath: string, sessionId: string): Record<string, string[]> {
  const existing = map[projectPath]
  if (!existing || !existing.includes(sessionId)) return map
  const next = existing.filter((id) => id !== sessionId)
  if (next.length === 0) {
    const { [projectPath]: _omit, ...rest } = map
    return rest
  }
  return { ...map, [projectPath]: next }
}

import type { HarnessHandler, HarnessHandlerMap } from './harness/harness-handler'
import { applyClaudeResources } from './harness/claude-handler'
import { applyCodexResources } from './harness/codex-handler'

const harnessHandlers: HarnessHandlerMap = {
  claude: {
    connect: () => window.app.connectClaude(),
    apply: (s, r) => applyClaudeResources(s, r, applyDefaultModel),
  },
  codex: {
    connect: () => window.app.connectCodex(),
    apply: (s, r) => applyCodexResources(s, r, resolveSessionCodexSelection),
  },
}

import { createToolSlice } from './slices/tool-slice'
import { createClaudeSlice } from './slices/claude-slice'
import { createCodexSlice } from './slices/codex-slice'
import { createSessionSlice } from './slices/session-slice'
import { createCoreSlice } from './slices/core-slice'
import { createEventSlice } from './slices/event-slice'

export const useChatStore = create<ChatStore>((set, get, store) => ({
  ...createToolSlice(set, get, store),
  ...createClaudeSlice(set, get, store),
  ...createCodexSlice(set, get, store),
  ...createSessionSlice(set, get, store),
  ...createCoreSlice(set, get, store),
  ...createEventSlice(set, get, store),

  projectSessions: {},
  activeProject: null,
  remoteSessions: {},
  _previousFocusedSession: null,
  agentTitles: {},

  isOpen: false,
  corner: 'br',
  harnessResources: { claude: null, codex: null },
  initializedHarnesses: new Set<HarnessId>(),
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

  focusProject: async (projectPath: string) => {
    const currentProject = get().activeProject
    perfEvent('project_switch', { from: currentProject, to: projectPath })
    if (currentProject && currentProject !== projectPath) {
      const project = get().projectSessions[currentProject]
      if (project) {
        const outgoingSid = project._activeSessionId
        const activeSession = outgoingSid ? project._sessions[outgoingSid] : null
        const isRemote = isRemoteSession(get(), currentProject, outgoingSid)
        if ((activeSession && (_isBusyStatus(activeSession.status) || activeSession.awaitingAssistantReply)) && !isRemote) {
          await _parkActiveSession(currentProject, outgoingSid)
        }
        if (outgoingSid) {
          // B1: hold the outgoing session in _sessions so Ctrl+Tab can bounce back to it even when
          // it's an idle history session that hasn't been opened in this run yet. Stub now, hydrate async.
          if (!project._sessions[outgoingSid]) {
            set((s) => {
              const proj = s.projectSessions[currentProject]
              if (!proj || proj._sessions[outgoingSid]) return {}
              const stub = createDefaultPerSessionState()
              stub.cwd = currentProject
              return {
                projectSessions: {
                  ...s.projectSessions,
                  [currentProject]: { ...proj, _sessions: { ...proj._sessions, [outgoingSid]: stub } },
                },
              }
            })
            _hydrateSessionState(set, currentProject, outgoingSid)
          } else if (!project._sessions[outgoingSid]._historyHydrated) {
            _hydrateSessionState(set, currentProject, outgoingSid)
          }
          set({ _previousFocusedSession: { projectPath: currentProject, sessionId: outgoingSid } })
        }
      }
    }
    const targetProject = get().projectSessions[projectPath]
    const targetSid = targetProject?._activeSessionId
    const targetSession = targetSid ? targetProject?._sessions[targetSid] : undefined
    set((s) => {
      const project = s.projectSessions[projectPath]
      const updates: Partial<ChatStore> = { activeProject: projectPath }
      if (project) {
        let { unseenCompletedSessions } = project
        const nextSession = targetSid ? project._sessions[targetSid] : undefined
        const nextSessions = targetSid && nextSession
          ? {
              ...project._sessions,
              [targetSid]: { ...nextSession, cwd: _getSessionCwd(projectPath, nextSession) },
            }
          : project._sessions
        if (project._activeSessionId && unseenCompletedSessions.has(project._activeSessionId)) {
          unseenCompletedSessions = new Set(unseenCompletedSessions)
          unseenCompletedSessions.delete(project._activeSessionId)
        }
        updates.projectSessions = {
          ...s.projectSessions,
          [projectPath]: { ...project, _sessions: nextSessions, hasUnseenActivity: false, unseenCompletedSessions },
        }
      }
      return updates
    })
    if (targetSid) {
      const targetSession = targetProject?._sessions[targetSid]
      try {
        await window.app.resumeSession(projectPath, targetSid, _getSessionCwd(projectPath, targetSession))
      } catch (err) { console.warn('[chat] resumeSession failed:', err) }
    }
    const switchedProject = get().projectSessions[projectPath]
    const switchedSid = switchedProject?._activeSessionId
    const switchedSession = switchedSid ? switchedProject?._sessions[switchedSid] : undefined
    const isCodexActive = (switchedSession?.sessionProvider ?? switchedSession?.preferredProvider) === 'codex'
    if (isCodexActive && switchedProject && switchedProject._codexSkills.length === 0 && !switchedProject._codexSkillsLoading) {
      void get().refreshCodexSkills(projectPath)
    }
  },

  ensureSession: (projectPath: string) => {
    let created = false
    set((s) => {
      if (s.projectSessions[projectPath]) return {}
      const project = createDefaultProjectState()
      project.agents = s.harnessResources.claude?.agents ?? []
      project.codexModels = s.harnessResources.codex?.models ?? []
      if (defaultPrefsCache.sandboxMode) project.sandboxInfo = sandboxModeToInfo(defaultPrefsCache.sandboxMode)
      const draftId = createSessionId()
      project._activeSessionId = draftId
      const newSession = createDefaultPerSessionState()
      newSession.cwd = projectPath
      if (defaultPrefsCache.permissionMode) newSession.permissionMode = defaultPrefsCache.permissionMode
      applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
      const codexSelection = resolveDefaultCodexSelection(project.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      project._sessions = { [draftId]: newSession }
      created = true
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: project,
        },
      }
    })
  },

  sendMessage: async (content, segments, explicitMentions) => sendMessageImpl(set, get, content, segments, explicitMentions),

  approveCodexPlan: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

    const context = getCodexPlanActionContext(get, activeProject)
    if (!context) return

    const userMessageId = `user_${Date.now()}`
    const userMessage = createLocalTextUserMessage(userMessageId, CODEX_APPROVE_PLAN_PROMPT)

    set((s) => ({
      ...updateActivePerSession(s, (sess) => {
        const approvedSession = updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'approved' })
        return {
          ...approvedSession,
          selectedCodexCollaborationMode: 'default',
          codexPlanRejectHintActive: false,
          additionalDirsDirty: false,
          messages: [...(approvedSession.messages ?? sess.messages), userMessage],
        }
      }),
      isOpen: true,
    }))

    window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'approved')
    window.app.codexCollaborationModeChange(activeProject, context.codexSessionId, 'default')

    await runCodexCommand(set, get, {
      activeProject,
      codexSessionId: context.codexSessionId,
      session: context.session,
      codexCommand: { kind: 'run', prompt: CODEX_APPROVE_PLAN_PROMPT },
      finalContent: CODEX_APPROVE_PLAN_PROMPT,
      userMessageId,
      attachments: [],
      selectedCodexPermissionPreset: context.session.selectedCodexPermissionPreset,
      collaborationMode: 'default',
      resolvedCodexModel: context.resolvedCodexModel,
      resolvedCodexReasoningEffort: context.resolvedCodexReasoningEffort,
    })
  },

  rejectCodexPlan: async (feedback) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

    const context = getCodexPlanActionContext(get, activeProject)
    if (!context) return

    const trimmedFeedback = feedback?.trim()
    if (!trimmedFeedback) {
      set((s) => ({
        ...updateActivePerSession(s, (sess) => ({
          ...updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'rejected' }),
          codexPlanRejectHintActive: true,
          chatInputFocusNonce: sess.chatInputFocusNonce + 1,
        })),
        isOpen: true,
      }))
      window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'rejected')
      return
    }

    const userMessageId = `user_${Date.now()}`
    const userMessage = createLocalTextUserMessage(userMessageId, trimmedFeedback)

    set((s) => ({
      ...updateActivePerSession(s, (sess) => {
        const rejectedSession = updateCodexPlanApproval(
          sess,
          context.assistantMessageId,
          { status: 'rejected', feedback: trimmedFeedback },
        )
        return {
          ...rejectedSession,
          codexPlanRejectHintActive: false,
          additionalDirsDirty: false,
          messages: [...(rejectedSession.messages ?? sess.messages), userMessage],
        }
      }),
      isOpen: true,
    }))

    window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'rejected', trimmedFeedback)

    await runCodexCommand(set, get, {
      activeProject,
      codexSessionId: context.codexSessionId,
      session: context.session,
      codexCommand: { kind: 'run', prompt: trimmedFeedback },
      finalContent: trimmedFeedback,
      userMessageId,
      attachments: [],
      selectedCodexPermissionPreset: context.session.selectedCodexPermissionPreset,
      collaborationMode: 'plan',
      resolvedCodexModel: context.resolvedCodexModel,
      resolvedCodexReasoningEffort: context.resolvedCodexReasoningEffort,
    })
  },

  disconnectRemoteSession: () => {
    const state = get()
    const projectPath = state.activeProject
    const sid = projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? undefined : undefined
    void window.agent.disconnectRemoteSession(sid)
    if (sid && projectPath) {
      set((s) => ({ remoteSessions: removeRemoteSession(s.remoteSessions, projectPath, sid) }))
    } else {
      set({ remoteSessions: {} })
    }
  },

  interrupt: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get(), activeProject)
    const sid = _getEffectiveSessionId(project)
    set((s) => updateActivePerSession(s, () => ({ awaitingAssistantReply: false })))
    let interrupted = false
    try {
      interrupted = sid ? await window.agent.interrupt(sid) : false
    } catch {
      interrupted = false
    }
    if (!interrupted) {
      set((s) => updateActivePerSession(s, () => ({
        status: 'idle',
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
      })))
    }
  },

  // toggleOpen / requestChatInputFocusRestore / setCorner now provided by createCoreSlice

  clearMessages: () => {
    const { activeProject, _bashOutputs } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    const sessionToolUseIds = new Set<string>()
    if (session) {
      for (const msg of session.messages) {
        for (const b of msg.content) {
          if (b.type === 'tool_use') sessionToolUseIds.add(b.toolUseId)
        }
      }
    }
    for (const id of sessionToolUseIds) {
      if (_bashOutputs[id]) window.app.unwatchBashOutput(id)
    }
    const remainingOutputs: typeof _bashOutputs = {}
    for (const [id, val] of Object.entries(_bashOutputs)) {
      if (!sessionToolUseIds.has(id)) remainingOutputs[id] = val
    }
    set((s) => ({ ...updateActivePerSession(s,() => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null, slashCommandOutput: null,
      pendingPermissions: [], pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      subagentColors: {}, _subagentColorsFree: freshSubagentColorPool(),
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
      awaitingAssistantReply: false,
      codexPlanRejectHintActive: false,
      chatInputFocusNonce: 0,
      queuedMessages: [],
    })), _bashOutputs: remainingOutputs }))
  },

  // removeSessionFromMemory now provided by createSessionSlice

  resetSessionForWorktreeSwitch: (projectPath: string, opts?: { wtPath?: string; gitBranch?: string | null }) => {
    const previousSid = get().projectSessions[projectPath]?._activeSessionId ?? null
    const draftId = createSessionId()
    set((s) => {
      const proj = getProject(s, projectPath)
      const newSession = createDefaultPerSessionState()
      newSession.cwd = opts?.wtPath ?? projectPath
      newSession._worktreePath = opts?.wtPath ?? null
      newSession._worktreeBaseBranch = opts?.gitBranch ?? null
      if (defaultPrefsCache.permissionMode) newSession.permissionMode = defaultPrefsCache.permissionMode
      applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
      const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: {
            ...proj,
            _activeSessionId: draftId,
            _sessions: { ...proj._sessions, [draftId]: newSession },
          },
        },
      }
    })
    useActivityViewStateStore.getState().seedFromCurrent(draftId)
    void inheritMiniAppToolsForNewSession(projectPath, previousSid)
  },

  resetSession: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    const activeSession = getActivePerSession(get())
    const currentSid = resolveActiveSessionId(project)
    const nextProvider = activeSession.sessionProvider ?? activeSession.preferredProvider

    // Idempotent: a pristine current session (no messages, idle, not remote, no worktree)
    // is already "a fresh session". Creating another one just stacks empty drafts in
    // _sessions, which later surface as duplicate "New session" rows in Ctrl+Tab
    // (current + previous both pinned, both falling back to the same title).
    if (
      activeSession.messages.length === 0 &&
      !_isLiveSession(activeSession) &&
      !activeSession._worktreePath &&
      !isRemoteSession(get(), activeProject, currentSid)
    ) {
      window.app.trace?.('session.lifecycle', 'resetSession:skip-pristine', { activeProject, currentSid })
      return
    }

    const newSessionId = nextProvider === 'codex' ? _createLocalCodexSessionId() : createSessionId()
    window.app.trace?.('session.lifecycle', 'resetSession', {
      activeProject,
      oldSid: currentSid,
      newSessionId,
      oldStatus: activeSession.status,
      oldAwaitingReply: activeSession.awaitingAssistantReply,
      oldProvider: activeSession.sessionProvider,
      knownSids: Object.keys(project._sessions),
    })

    set((s) => {
      const proj = getProject(s, activeProject)
      const newSession = createDefaultPerSessionState()
      newSession.cwd = activeProject
      newSession.preferredProvider = nextProvider
      newSession.sessionProvider = nextProvider
      applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
      const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _activeSessionId: newSessionId,
            _sessions: {
              ...proj._sessions,
              [newSessionId]: newSession,
            },
          },
        },
      }
    })
    useActivityViewStateStore.getState().seedFromCurrent(newSessionId)

    let unlock!: () => void
    resetLock.current = new Promise<void>((r) => { unlock = r })

    let agentConfig: { permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined
    try {
      if (activeSession.sessionProvider === 'codex') {
        if (activeSession.status !== 'streaming' && currentSid) {
          await window.agent.resetSession(currentSid).catch(() => {})
        }
      } else if (
        isRemoteSession(get(), activeProject, currentSid) ||
        _isBusyStatus(activeSession.status) ||
        activeSession.awaitingAssistantReply
      ) {
        agentConfig = await _parkActiveSession(activeProject, project._activeSessionId, newSessionId)
      } else if (currentSid) {
        agentConfig = (await window.agent.resetSession(currentSid, newSessionId)) ?? undefined
      }

      await useAppStore.getState().clearWorktree(activeProject)
    } finally {
      resetLock.current = null
      unlock()
    }

    if (agentConfig) {
      set((s) => {
        const proj = s.projectSessions[activeProject]
        if (!proj) return {}
        const sess = proj._sessions[newSessionId]
        if (!sess) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              sandboxInfo: agentConfig!.sandboxInfo,
              _sessions: {
                ...proj._sessions,
                [newSessionId]: { ...sess, permissionMode: agentConfig!.permissionMode },
              },
            },
          },
        }
      })
    }

    void inheritMiniAppToolsForNewSession(activeProject, currentSid)
  },

  // rewindFiles / rewindCodeAndChat / rewindConversation / previewRewind
  // editQueuedMessage / deleteQueuedMessage / setDraftText / assignSubagentColor /
  // setDetailedUsage now provided by createSessionSlice

  // setSelectedModel / setSelectedEffort / setFastMode now provided by createClaudeSlice
  // setSelectedCodexModel / setSelectedCodexReasoningEffort / setSelectedCodexPermissionPreset /
  // setSelectedCodexCollaborationMode / refreshCodexModels / refreshCodexSkills now provided by createCodexSlice

  setPreferredProvider: (provider) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    if (session.sessionProvider && session.messages.length > 0) return
    if (session.sessionProvider === provider || (provider === 'claude' && !session.sessionProvider && session.preferredProvider === 'claude')) {
      return
    }
    const proj0 = getProject(get(), activeProject)
    const currentSid0 = proj0._activeSessionId
    const currentSess0 = currentSid0 ? proj0._sessions[currentSid0] : null
    const willReplaceSid = !!currentSess0 && currentSess0.messages.length === 0
    const nextSid = willReplaceSid
      ? (provider === 'codex' ? _createLocalCodexSessionId() : createSessionId())
      : null
    set((s) => {
      const proj = getProject(s, activeProject)
      const currentSid = proj._activeSessionId
      const currentSess = currentSid ? proj._sessions[currentSid] : null
      if (currentSess && nextSid) {
        const nextSessions = { ...proj._sessions }
        if (currentSid) delete nextSessions[currentSid]
        nextSessions[nextSid] = {
          ...currentSess,
          preferredProvider: provider,
          sessionProvider: provider,
          slashCommandOutput: null,
        }
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: nextSid,
              _sessions: nextSessions,
            },
          },
        }
      }
      return updateActivePerSession(s, () => ({ preferredProvider: provider, sessionProvider: provider, slashCommandOutput: null }))
    })
    if (nextSid) useActivityViewStateStore.getState().seedFromCurrent(nextSid)
    if (provider === 'codex') {
      const project = getProject(get(), activeProject)
      const session = getActivePerSession(get())
      const selected = resolveSessionCodexSelection(
        project.codexModels,
        session.selectedCodexModel,
        session.selectedCodexReasoningEffort,
      )
      if (
        selected.modelId !== session.selectedCodexModel
        || selected.reasoningEffort !== session.selectedCodexReasoningEffort
      ) {
        set((s) => updateActivePerSession(s, () => ({
          selectedCodexModel: selected.modelId,
          selectedCodexReasoningEffort: selected.reasoningEffort,
        })))
      }
      if (project._codexSkills.length === 0 && !project._codexSkillsLoading) {
        void get().refreshCodexSkills(activeProject)
      }
    }
    void get().initializeHarness(provider)
  },


  // addAttachment / removeAttachment / clearAttachments now provided by createCoreSlice

  respondToPermission: async (requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers) => {
    const { activeProject } = get()
    if (!activeProject) return false
    const session = getActivePerSession(get(), activeProject)
    const respondedRequest = session.pendingPermissions.find((p) => p.requestId === requestId)
    if (!respondedRequest) {
      window.app.trace?.('permission.flow', 'click_miss', { reason: 'not_in_active_session_pending', activeProject }, requestId)
      return false
    }
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    window.app.trace?.('permission.flow', 'user_click', { allow, activeSid, provider: session.sessionProvider }, requestId)
    let handled = false
    try {
      const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
      if (targetSid) handled = await window.agent.respondToPermission(targetSid, requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers)
    } catch (err) {
      console.warn('[chat] respondToPermission failed:', err)
      return false
    }
    if (!handled) {
      window.app.trace?.('permission.flow', 'ack_miss', { activeProject, activeSid, provider: session.sessionProvider }, requestId)
      return false
    }
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, (sess) => {
        const updates: Partial<PerSessionState> = {
          pendingPermissions: sess.pendingPermissions.filter((p) => p.requestId !== requestId),
        }
        if (allow && selectedSuggestions) {
          const mode = extractModeFromSuggestions(respondedRequest?.suggestions, selectedSuggestions)
          if (mode) updates.permissionMode = mode as PermissionMode
        }
        return updates
      })
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
    return true
  },

  setPermissionMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.agent.setPermissionMode(activeProject, mode)
    set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
  },

  answerQuestion: (requestId, answers, annotations) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
    if (targetSid) void window.agent.answerQuestion(targetSid, requestId, answers, annotations)
    const codexQaItem = session.sessionProvider === 'codex' && session.pendingQuestion
      ? _buildQuestionAnswerItem(session.pendingQuestion.questions, answers)
      : null
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, (prev) => {
        if (!codexQaItem) return { pendingQuestion: null }
        const lastMsg = prev.messages[prev.messages.length - 1]
        if (!lastMsg?.metadata?.codex) return { pendingQuestion: null }
        const prevCodex = lastMsg.metadata.codex
        return {
          pendingQuestion: null,
          messages: prev.messages.map((msg, i) =>
            i !== prev.messages.length - 1 ? msg : {
              ...msg,
              metadata: { ...msg.metadata, codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] } },
            },
          ),
        }
      })
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
  },

  dismissQuestion: (requestId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
    if (targetSid) void window.agent.dismissQuestion(targetSid, requestId)
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, () => ({ pendingQuestion: null }))
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
  },

  respondToPlanApproval: (requestId, approved, feedback, postApprovalMode) => {
    const { activeProject } = get()
    if (!activeProject) return
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
    if (targetSid) window.agent.respondToPlanApproval(targetSid, requestId, approved, feedback)
    if (approved) {
      const nextMode: PermissionMode = postApprovalMode ?? 'default'
      void window.agent.setPermissionMode(activeProject, nextMode)
    }
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, () => ({
        pendingPlanApproval: null,
        planApprovalOutcome: { approved, feedback },
        ...(approved && { permissionMode: (postApprovalMode ?? 'default') as PermissionMode }),
      }))
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
  },

  setSandboxMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (mode !== 'off') {
      const capability = useAppStore.getState().sandboxCapability
      if (capability?.supportLevel === 'unsupported') return
      if (capability?.supportLevel === 'conditional') {
        const probe = await useAppStore.getState().probeSandbox()
        if (!probe.ok) return
      }
    }
    const updated = await window.agent.setSandboxMode(activeProject, mode)
    set((s) => updateProjectState(s, activeProject, () => ({ sandboxInfo: updated })))
  },

  cyclePermissionMode: () => {
    const session = getActivePerSession(get())
    const claude = get().harnessResources.claude
    const account = claude?.account ?? {}
    const availableModels = claude?.models ?? []
    const modelInfo = availableModels.find((m) => m.id === session.selectedModel)
    const startIdx = PERMISSION_MODES.indexOf(session.permissionMode)
    const anchor = startIdx === -1 ? 0 : startIdx
    for (let step = 1; step <= PERMISSION_MODES.length; step++) {
      const candidate = PERMISSION_MODES[(anchor + step) % PERMISSION_MODES.length]
      if (candidate === 'auto') {
        const elig = checkAutoModeEligibility({
          subscriptionType: account?.subscriptionType,
          apiProvider: account?.apiProvider,
          modelSupportsAutoMode: modelInfo?.supportsAutoMode,
        })
        if (!elig.ok) continue
      }
      get().setPermissionMode(candidate)
      return
    }
  },

  togglePlanModeShortcut: () => {
    const session = getActivePerSession(get())
    const provider = resolveProvider(session)
    if (provider === 'codex') {
      const next: CodexCollaborationMode = session.selectedCodexCollaborationMode === 'plan' ? 'default' : 'plan'
      get().setSelectedCodexCollaborationMode(next)
      return
    }
    get().cyclePermissionMode()
  },


  // dismissSlashCommandOutput / openProviderPopup / openMcpPopup now provided by createCoreSlice

  setSessionApiProviderId: async (apiProviderId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get(), activeProject)
    const sessionId = project._activeSessionId
    if (!sessionId) return
    set((s) => updateActivePerSession(s, () => ({
      apiProviderId,
      slashCommandOutput: null,
    })))
    const sess = project._sessions[sessionId]
    const isCodex = (sess?.sessionProvider ?? sess?.preferredProvider ?? 'claude') === 'codex'
    try {
      await window.agent.setSessionApiProvider(sessionId, apiProviderId)
    } catch (err) {
      console.warn('[chat] setSessionApiProvider failed:', err)
    }
    if (isCodex) {
      void get().refreshCodexModels(false)
    }
  },

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
      set((s) => updateProjectState(s, activeProject, () => ({ _previousSessionId: prevSid })))
      set({ _previousFocusedSession: { projectPath: activeProject, sessionId: prevSid } })
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
        const patched: PerSessionState = worktreeMissing
          ? { ...targetSession, _worktreeRemoved: true, cwd: activeProject }
          : { ...targetSession, cwd: _getSessionCwd(activeProject, targetSession) }
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: sessionId,
              _sessions: {
                ...proj._sessions,
                [sessionId]: patched,
              },
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
            if (!proj?._sessions[sessionId]) return {}
            return {
              projectSessions: {
                ...s.projectSessions,
                [activeProject]: {
                  ...proj,
                  _sessions: { ...proj._sessions, [sessionId]: hydrated },
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
        _worktreeBaseBranch: targetSession._worktreeBaseBranch,
        _worktreeRemoved: targetSession._worktreeRemoved,
      })
      if (targetSession._worktreePath && !targetSession._worktreeRemoved) {
        useAppStore.getState().setActiveWorktree(activeProject, targetSession._worktreePath)
      } else if (!targetSession._worktreeBaseBranch || targetSession._worktreeRemoved) {
        useAppStore.getState().setActiveWorktree(activeProject, null)
      }

      set((s) => updatePerSession(s, activeProject, sessionId, (sess) =>
        applySessionAgentDefaults(sess, getProject(s, activeProject), s.harnessResources.claude?.models ?? []),
      ))

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
    let savedWorktreeBranch: string | null = null
    let savedWorktreePath: string | undefined
    let savedProvider: string | null = null
    let savedApiProviderId: string | null = null
    let savedTitle: string | null = null
    try {
      const saved = await window.app.loadSessionState(sessionId) as PersistedSessionState | null
      if (saved) {
        savedMessages = saved.messages
        savedCost = saved.totalCostUsd
        savedTokens = saved.contextTokens
        savedWorktreeBranch = saved.gitBranch
        savedProvider = saved.provider
        savedWorktreePath = saved.worktreePath ?? undefined
        savedApiProviderId = saved.apiProviderId ?? null
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
      ...createDefaultPerSessionState(),
      cwd: _getSessionCwd(activeProject, { _worktreePath: savedWorktreePath ?? null, _worktreeRemoved: false }),
      messages: savedMessages,
      totalCostUsd: savedCost,
      contextTokens: savedTokens,
      contextWindow: restoredCodexUsage?.contextWindow && restoredCodexUsage.contextWindow > 0
        ? restoredCodexUsage.contextWindow
        : null,
      codexUsageSnapshot: restoredCodexUsage,
      _worktreeBaseBranch: savedWorktreeBranch,
      _worktreePath: savedWorktreePath ?? null,
      preferredProvider: restoredProvider,
      sessionProvider: restoredProvider,
      lastAssistantMessageId: savedMessages.findLast((m) => m.role === 'assistant')?.id ?? null,
      apiProviderId: savedApiProviderId,
      _title: savedTitle,
      _historyHydrated: true,
      permissionMode: defaultPermissionMode,
    }
    Object.assign(
      restoredSession,
      applySessionAgentDefaults(restoredSession, freshProject, get().harnessResources.claude?.models ?? []),
    )

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
      savedWorktreeBranch,
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
  },

  addDir: (path, scope) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (scope === 'session') {
      set((s) => {
        const sess = getActivePerSession(s)
        const proj = getProject(s, activeProject)
        if (sess.additionalDirs.includes(path) || proj.projectAdditionalDirs.includes(path)) return {}
        return updateActivePerSession(s, () => ({
          additionalDirs: [...sess.additionalDirs, path],
          additionalDirsDirty: true,
        }))
      })
    } else {
      set((s) => {
        const sess = getActivePerSession(s)
        const proj = getProject(s, activeProject)
        if (sess.additionalDirs.includes(path) || proj.projectLocalDirs.includes(path)) return {}
        window.agent.addProjectAdditionalDir(activeProject, path).catch(() => {})
        const nextLocal = [...proj.projectLocalDirs, path]
        const nextMerged = Array.from(new Set([...proj.projectSharedDirs, ...nextLocal]))
        const merged = { ...s, ...updateProjectState(s, activeProject, () => ({
          projectLocalDirs: nextLocal,
          projectAdditionalDirs: nextMerged,
        })) } as ChatStore
        return updateActivePerSession(merged, () => ({ additionalDirsDirty: true }))
      })
    }
  },

  removeDir: (path, scope) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (scope === 'session') {
      set((s) => updateActivePerSession(s, (sess) => ({
        additionalDirs: sess.additionalDirs.filter((d) => d !== path),
        additionalDirsDirty: true,
      })))
    } else {
      set((s) => {
        const proj = getProject(s, activeProject)
        if (!proj.projectLocalDirs.includes(path)) return {}
        window.agent.removeProjectAdditionalDir(activeProject, path).catch(() => {})
        const nextLocal = proj.projectLocalDirs.filter((d) => d !== path)
        const nextMerged = Array.from(new Set([...proj.projectSharedDirs, ...nextLocal]))
        const merged = { ...s, ...updateProjectState(s, activeProject, () => ({
          projectLocalDirs: nextLocal,
          projectAdditionalDirs: nextMerged,
        })) } as ChatStore
        return updateActivePerSession(merged, () => ({ additionalDirsDirty: true }))
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
    else if (target.type === 'baseBranch') command = '/review branch'
    else command = `/review commit ${target.sha}`
    get().sendMessage(command)
  },
}))

export {
  useActiveSession,
  useIsRemoteLocked,
  useBashOutput,
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
