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
    _providerSessionId: null,
    dshPreset: null,
    sessionProvider: null,
    totalCostUsd: 0,
    contextTokens: 0,
    contextWindow: null,
    detailedUsage: null,
    subagentTokens: {},
    subagentColors: {},
    _subagentColorsFree: freshSubagentColorPool(),
    taskProgress: {},
    browserDownloads: {},
    videoGenStatuses: {},
    streamingTokens: { input: 0, output: 0 },
    codexUsageSnapshot: null,
    codexTurnLastUsage: null,
    selectedModel: '',
    selectedEffort: undefined,
    cursorModelParams: {},
    modelUserChosen: false,
    effortUserChosen: false,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    selectedCodexServiceTier: null,
    codexModelUserChosen: false,
    codexReasoningEffortUserChosen: false,
    selectedCodexPermissionPreset: 'auto-review',
    selectedCodexCollaborationMode: 'default',
    codexPlanRejectHintActive: false,
    chatInputFocusNonce: 0,
    chatInputRestoreFocusNonce: 0,
    preferredProvider: 'claude',
    harnessUserChosen: false,
    acpAgentId: null,
    openCodeAgentId: null,
    acpModels: [],
    acpModelConfigId: null,
    acpModelsStatus: 'idle',
    acpModelsError: null,
    acpModes: [],
    acpModeConfigId: null,
    selectedAcpModeId: null,
    acpModesStatus: 'idle',
    acpSlashCommands: [],
    acpSlashCommandsStatus: 'idle',
    acpGoal: null,
    draftText: '',
    draftJson: null,
    draftId: null,
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
    runningSlashCommand: null,
    _streamingToolInputPreviews: {},
    _latestCodexTodoList: null,
    _pendingSlashCommand: '',
    _pendingCompactUserId: '',
    todos: {},
    showTodos: false,
    _todosUserDismissed: false,
    _nextTodoId: 1,
    isCompacting: false,
    isRecapping: false,
    compactError: null,
    rateLimitInfo: null,
    _gitBranch: null,
    _worktreePath: null,
    _worktreeRemoved: false,
    additionalDirs: [],
    additionalDirsDirty: false,
    apiRetry: null,
    lastEventAt: 0,
    queuedMessages: [],
    _remoteTurnQueue: [],
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
    codexModelsByProvider: {},
    codexModelsLoading: false,
    claudeModels: [],
    claudeModelsByProvider: {},
    claudeModelsLoading: false,
    _codexSkills: [],
    _codexSkillsLoading: false,
    _cursorSlashItems: [],
    _cursorSlashItemsLoading: false,
    projectExtraDirs: [],
    showDirManager: false,
    showReviewPanel: false,
    reviewPanelInitialMode: 'uncommitted',
  }
}

export function getDefaultEffortForModel(model?: ModelOption): EffortLevel | undefined {
  const levels = model?.supportedEffortLevels
  if (!levels?.length) return undefined
  if (levels.includes('high')) return 'high'
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}

