import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import type { PerSessionState, ProjectState } from './types'
import { SUBAGENT_COLOR_POOL } from './types'

const SUBAGENT_COLOR_POOL_SIZE = SUBAGENT_COLOR_POOL.length

export function freshSubagentColorPool(): number[] {
  return Array.from({ length: SUBAGENT_COLOR_POOL_SIZE }, (_, i) => i)
}

/**
 * Generate a fresh session id. Shared with the main process 1:1 as
 * `Session.id`; no draft/promotion dance — the id assigned here is the
 * stable identity used in DB, IPC, and the main-process SessionManager.
 */
export function createSessionId(): string {
  return crypto.randomUUID()
}

export function createDefaultPerSessionState(): PerSessionState {
  return {
    cwd: '',
    _title: null,
    messages: [],
    status: 'idle',
    awaitingAssistantReply: false,
    session: null,
    sessionProvider: null,
    totalCostUsd: 0,
    contextTokens: 0,
    contextWindow: null,
    detailedUsage: null,
    subagentTokens: {},
    subagentColors: {},
    _subagentColorsFree: freshSubagentColorPool(),
    taskProgress: {},
    streamingTokens: { input: 0, output: 0 },
    codexUsageSnapshot: null,
    codexTurnLastUsage: null,
    selectedModel: '',
    selectedEffort: undefined,
    modelUserChosen: false,
    effortUserChosen: false,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    codexModelUserChosen: false,
    codexReasoningEffortUserChosen: false,
    selectedCodexPermissionPreset: 'default',
    selectedCodexCollaborationMode: 'default',
    codexPlanRejectHintActive: false,
    chatInputFocusNonce: 0,
    chatInputRestoreFocusNonce: 0,
    preferredProvider: 'claude',
    draftText: '',
    promptSuggestion: null,
    attachments: [],
    browserAnnotations: [],
    mentions: [],
    pendingPermissions: [],
    permissionMode: 'default',
    pendingQuestion: null,
    pendingPlanApproval: null,
    planApprovalOutcome: null,
    slashCommandOutput: null,
    _streamingToolInputPreviews: {},
    _pendingSlashCommand: '',
    _pendingCompactUserId: '',
    todos: {},
    showTodos: false,
    _todosUserDismissed: false,
    _nextTodoId: 1,
    isCompacting: false,
    compactError: null,
    rateLimitInfo: null,
    _gitBranch: null,
    _worktreePath: null,
    _worktreeRemoved: false,
    additionalDirs: [],
    additionalDirsDirty: false,
    apiRetry: null,
    modelFallback: null,
    lastEventAt: 0,
    queuedMessages: [],
    activeCodexMessageId: null,
    lastAssistantMessageId: null,
    miniAppContexts: {},
    userSelections: [],
    _historyHydrated: true,
    apiProviderId: null,
  }
}

export function createDefaultProjectState(): ProjectState {
  return {
    _activeSessionId: null,
    _previousSessionId: null,
    _sessions: {},
    slashCommands: [],
    _projectSkills: [],
    _projectCommands: [],
    agents: [],
    homedir: '',
    sandboxInfo: { enabled: false, autoAllowBash: false },
    sessions: [],
    sessionsPage: 0,
    sessionsHasMore: true,
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    unseenCompletedSessions: new Set(),
    codexModels: [],
    codexModelsLoading: false,
    _codexSkills: [],
    _codexSkillsLoading: false,
    projectAdditionalDirs: [],
    userAdditionalDirs: [],
    projectSharedDirs: [],
    projectLocalDirs: [],
    showDirManager: false,
    showReviewPanel: false,
  }
}

export function getDefaultEffortForModel(model?: ModelOption): EffortLevel | undefined {
  const levels = model?.supportedEffortLevels
  if (!levels?.length) return undefined
  if (levels.includes('high')) return 'high'
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}

// Cache-dependent invalidators stay re-exported from index.ts (they read
// module-level cache state populated by _loadDefaultSessionPrefs).
export {
  invalidateDefaultPermissionModeCache,
  invalidateDefaultClaudePreferencesCache,
  invalidateDefaultCodexPreferencesCache,
} from './index'
