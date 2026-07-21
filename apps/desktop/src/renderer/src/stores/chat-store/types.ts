import type {
  AccountInfo,
  AcpResources,
  AgentEvent,
  AgentInfo,
  AgentStatus,
  AskUserQuestionRequest,
  ChatMessage,
  ClaudeResources,
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexResources,
  CodexReviewTarget,
  CodexUsageInfo,
  ContextUsageInfo,
  EffortLevel,
  HarnessId,
  HarnessResourcesMap,
  ImageAttachment,
  ModelOption,
  PermissionMode,
  PermissionRequest,
  PlanApprovalRequest,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SandboxMode,
  SessionHistoryEntry,
  SessionInfo,
  SkillInfo,
  SlashCommandInfo,
  TodoItem,
} from '@superone/shared/agent-types'
import type { BrowserAnnotation } from './helpers/browser-annotation'

export type Corner = 'br' | 'bl' | 'tr' | 'tl' | 'tm' | 'rm' | 'bm' | 'lm'
export type ChatProvider = HarnessId

export interface SessionWriteTarget {
  projectPath: string
  sessionId: string
}

export type MentionKind = 'file' | 'directory' | 'agent' | 'miniapp'
export interface Mention {
  kind: MentionKind
  value: string
  displayName: string
}

/** An ordered piece of a composed message: a text run (optionally a paste chip) or an inline attachment reference. */
export type InputSegment = { text: string; isPaste: boolean } | { attachmentId: string }

export interface MiniAppContextSlot {
  appId: string
  appName: string
  summary: string
  content: string
  mode: 'inject' | 'suggest'
  color?: string
  checked: boolean
}

export interface PerSessionState {
  cwd: string
  _title: string | null
  messages: ChatMessage[]
  status: AgentStatus
  awaitingAssistantReply: boolean
  session: SessionInfo | null
  /** Provider-side session id (Claude SDK / ACP agent). Survives harnesses with no SessionInfo. */
  _providerSessionId: string | null
  sessionProvider: ChatProvider | null
  totalCostUsd: number
  contextTokens: number
  contextWindow: number | null
  detailedUsage: ContextUsageInfo | null
  subagentTokens: Record<string, { input: number; output: number }>
  subagentColors: Record<string, number>
  _subagentColorsFree: number[]
  taskProgress: Record<string, { description: string; taskId?: string; lastToolName?: string; summary?: string; totalTokens: number; toolUses: number; durationMs: number; completed?: boolean; status?: 'completed' | 'failed' | 'stopped'; outputFile?: string; toolHistory: Array<{ toolName: string; description: string }> }>
  /** Live browser_download (URL) tasks keyed by taskId (bdl_*), for tool-block UI. */
  browserDownloads: Record<string, {
    status: 'progressing' | 'completed' | 'failed'
    path?: string
    filename?: string
    bytes?: number
    totalBytes?: number
    mimeType?: string
    url?: string
    error?: string
  }>
  /** Video generation status keyed by generationId, updated by media_generate_video and media_video_status results. */
  videoGenStatuses: Record<string, {
    status: string
    generationId: string
    prompt?: string
    provider?: string
    model?: string
    savedPaths?: string[]
    warnings?: string[]
    error?: string
  }>
  streamingTokens: { input: number; output: number }
  codexUsageSnapshot: CodexUsageInfo | null
  codexTurnLastUsage: CodexUsageInfo | null
  selectedModel: string
  selectedEffort?: EffortLevel
  modelUserChosen: boolean
  effortUserChosen: boolean
  selectedCodexModel: string
  selectedCodexReasoningEffort?: CodexReasoningEffort
  codexModelUserChosen: boolean
  codexReasoningEffortUserChosen: boolean
  selectedCodexPermissionPreset: CodexPermissionPreset
  selectedCodexCollaborationMode: CodexCollaborationMode
  codexPlanRejectHintActive: boolean
  chatInputFocusNonce: number
  chatInputRestoreFocusNonce: number
  preferredProvider: ChatProvider
  /** Selected ACP agent id when preferredProvider/sessionProvider is acp. */
  acpAgentId: string | null
  /** Models from ACP session/new configOptions (category=model). */
  acpModels: ModelOption[]
  /** ACP config option id used for set_config_option (usually "model"). */
  acpModelConfigId: string | null
  acpModelsStatus: 'idle' | 'loading' | 'ready' | 'error'
  acpModelsError: string | null
  /** Modes from ACP configOptions (category=mode). */
  acpModes: ModelOption[]
  acpModeConfigId: string | null
  selectedAcpModeId: string | null
  acpModesStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Slash commands from ACP available_commands_update (lazy-loaded on / popup). */
  acpSlashCommands: SlashCommandInfo[]
  acpSlashCommandsStatus: 'idle' | 'loading' | 'ready' | 'error'
  draftText: string
  /** Editor JSON snapshot (Tiptap doc) — preserves chip nodes & their inline positions across session switches, unlike the plain-text draft. */
  draftJson: object | null
  promptSuggestion: string | null
  attachments: ImageAttachment[]
  browserAnnotations: BrowserAnnotation[]
  mentions: Mention[]
  pendingPermissions: PermissionRequest[]
  permissionMode: PermissionMode
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  planApprovalOutcome: { approved: boolean; feedback?: string } | null
  slashCommandOutput: { command: string; content: string } | null
  _streamingToolInputPreviews: Record<string, Record<string, unknown>>
  _pendingSlashCommand: string
  _pendingCompactUserId: string
  todos: Record<string, TodoItem>
  showTodos: boolean
  _todosUserDismissed: boolean
  _nextTodoId: number
  isCompacting: boolean
  compactError: string | null
  rateLimitInfo: { status: 'allowed_warning' | 'rejected'; resetsAt?: number; rateLimitType?: string; utilization?: number; errorCode?: 'credits_required'; canUserPurchaseCredits?: boolean; hasChargeableSavedPaymentMethod?: boolean } | null
  _gitBranch: string | null
  _worktreePath: string | null
  _worktreeRemoved: boolean
  additionalDirs: string[]
  additionalDirsDirty: boolean
  apiRetry: { attempt: number; maxRetries: number; delayMs: number } | null
  modelFallback: { trigger: string; fromModel?: string; toModel?: string } | null
  lastEventAt: number
  queuedMessages: ChatMessage[]
  activeCodexMessageId: string | null
  lastAssistantMessageId: string | null
  miniAppContexts: Record<string, MiniAppContextSlot>
  userSelections: string[]
  _historyHydrated: boolean
  apiProviderId: string | null
}

export interface ProjectState {
  _activeSessionId: string | null
  _previousSessionId: string | null
  _sessions: Record<string, PerSessionState>
  slashCommands: SlashCommandInfo[]
  _projectSkills: SlashCommandInfo[]
  _projectCommands: SlashCommandInfo[]
  agents: AgentInfo[]
  homedir: string
  sandboxInfo: SandboxInfo
  sessions: SessionHistoryEntry[]
  sessionsPage: number
  sessionsHasMore: boolean
  hasUnseenActivity: boolean
  hasPendingInteraction: boolean
  unseenCompletedSessions: Set<string>
  codexModels: ModelOption[]
  codexModelsLoading: boolean
  _codexSkills: SkillInfo[]
  _codexSkillsLoading: boolean
  projectAdditionalDirs: string[]
  userAdditionalDirs: string[]
  projectSharedDirs: string[]
  projectLocalDirs: string[]
  showDirManager: boolean
  showReviewPanel: boolean
}

export type ActiveSessionView = PerSessionState & ProjectState

export interface ToolRendererState {
  callId: string
  appId: string
  toolSlug: string
  toolName: string
  toolUseId: string | null
  templateUrl: string
  agentInput: Record<string, unknown>
  status: 'awaiting' | 'submitted' | 'cancelled'
}

export type PersistedSessionState = {
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  isWorktree: boolean
  gitBranch: string | null
  worktreePath: string | null
  provider: ChatProvider
  apiProviderId?: string | null
  acpAgentId?: string | null
  title?: string | null
}

export interface ChatStore {
  projectSessions: Record<string, ProjectState>
  activeProject: string | null
  remoteSessions: Record<string, string[]>
  mountedSessions: Record<string, string[]>
  _previousFocusedSession: { projectPath: string; sessionId: string } | null

  agentTitles: Record<string, string>

  _bashOutputs: Record<string, { content: string; finished: boolean; outputPath?: string }>
  _shareProgress: Record<string, { loaded: number; total: number }>

  toolRenderers: Record<string, ToolRendererState>
  openToolIntercept: (state: ToolRendererState) => void
  submitToolIntercept: (callId: string, userInput: Record<string, unknown>) => void
  cancelToolIntercept: (callId: string, reason?: string) => void
  clearToolIntercepts: (callIds: string[]) => void

  _pendingStandaloneCalls: Record<string, { callId: string; appId: string; projectDir: string; toolName: string; arguments: Record<string, unknown> }>
  mapStandaloneCall: (toolUseId: string, payload: { callId: string; appId: string; projectDir: string; toolName: string; arguments: Record<string, unknown> }) => void

  isOpen: boolean
  corner: Corner

  harnessResources: {
    claude: ClaudeResources | null
    codex: CodexResources | null
    acp: AcpResources | null
  }
  initializedHarnesses: Set<HarnessId>
  disabledSkills: string[]

  setHarnessResources<H extends HarnessId>(harness: H, resources: HarnessResourcesMap[H]): void
  initializeHarness(harness: HarnessId): Promise<void>
  setDisabledSkills: (list: string[]) => void

  handleAgentEvent: (event: AgentEvent) => void
  syncLiveSnapshots: () => Promise<void>

  focusProject: (projectPath: string) => Promise<void>
  ensureSession: (projectPath: string) => void

  sendMessage: (content: string, segments?: InputSegment[], explicitMentions?: Mention[], attachments?: ImageAttachment[]) => Promise<void>
  approveCodexPlan: () => Promise<void>
  rejectCodexPlan: (feedback?: string) => Promise<void>
  interrupt: () => Promise<void>
  disconnectRemoteSession: () => void

  toggleOpen: () => void
  requestChatInputFocusRestore: () => void
  setCorner: (corner: Corner) => void
  clearMessages: () => void
  resetSession: () => Promise<void>
  resetSessionForWorktreeSwitch: (projectPath: string, opts?: { wtPath?: string; gitBranch?: string | null }) => void
  removeSessionFromMemory: (projectPath: string, sessionId: string) => void
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>
  rewindCodeAndChat: (userMessageId: string) => Promise<RewindFilesResult>
  rewindConversation: (userMessageId: string) => Promise<RewindFilesResult>
  previewRewind: (checkpointId: string) => Promise<RewindFilesResult>

  editQueuedMessage: (messageId: string, target?: SessionWriteTarget) => void
  deleteQueuedMessage: (messageId: string, target?: SessionWriteTarget) => void

  setDraftText: (text: string, target?: SessionWriteTarget) => void
  setDraftJson: (json: object | null, target?: SessionWriteTarget) => void

  assignSubagentColor: (toolUseId: string) => void

  setDetailedUsage: (projectPath: string, sessionId: string, usage: ContextUsageInfo | null) => void

  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort?: EffortLevel) => void
  setFastMode: (enabled: boolean) => void
  setSelectedCodexModel: (model: string) => void
  setSelectedCodexReasoningEffort: (effort?: CodexReasoningEffort) => void
  setSelectedCodexPermissionPreset: (preset: CodexPermissionPreset) => void
  setSelectedCodexCollaborationMode: (mode: CodexCollaborationMode) => void
  refreshCodexModels: (force?: boolean) => Promise<void>
  refreshCodexSkills: (projectPath?: string) => Promise<void>
  setPreferredProvider: (provider: ChatProvider) => void
  setAcpAgentId: (agentId: string | null) => void
  setSelectedAcpMode: (modeId: string) => void
  /** Lazy-load ACP slash commands when the / popup opens (also refreshes cache). */
  ensureAcpSlashCommands: () => void

  setSessionApiProviderId: (apiProviderId: string | null) => Promise<void>
  openProviderPopup: () => void
  openMcpPopup: () => void

  addAttachment: (attachment: ImageAttachment, target?: SessionWriteTarget) => void
  removeAttachment: (index: number, target?: SessionWriteTarget) => void
  removeAttachmentById: (id: string, target?: SessionWriteTarget) => void
  clearAttachments: (target?: SessionWriteTarget) => void
  addBrowserAnnotation: (annotation: BrowserAnnotation, target?: SessionWriteTarget) => void
  updateBrowserAnnotation: (id: string, patch: Partial<Pick<BrowserAnnotation, 'comment' | 'styleChanges' | 'screenshot'>>, target?: SessionWriteTarget) => void
  removeBrowserAnnotation: (id: string, target?: SessionWriteTarget) => void
  clearBrowserAnnotations: (target?: SessionWriteTarget) => void

  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>) => Promise<boolean>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: () => void
  togglePlanModeShortcut: () => void
  setSandboxMode: (mode: SandboxMode) => Promise<void>

  answerQuestion: (requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => void
  dismissQuestion: (requestId: string) => void

  respondToPlanApproval: (requestId: string, approved: boolean, feedback?: string, postApprovalMode?: PermissionMode) => void

  dismissSlashCommandOutput: (target?: SessionWriteTarget) => void
  dismissCompactError: () => void

  toggleTodos: () => void

  addMention: (mention: Mention, target?: SessionWriteTarget) => void
  removeMention: (value: string, target?: SessionWriteTarget) => void

  fetchSessions: () => Promise<void>
  fetchSessionsPage: () => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  switchToSession: (projectPath: string, sessionId: string) => Promise<void>
  mountSession: (projectPath: string, sessionId: string) => Promise<void>
  unmountSession: (projectPath: string, sessionId: string) => void
  renameSession: (sessionId: string, title: string) => Promise<void>

  setMiniAppContext: (appId: string, data: { appName: string; summary: string; content: string; mode: 'inject' | 'suggest'; color?: string }, target?: SessionWriteTarget) => void
  clearMiniAppContext: (appId: string, target?: SessionWriteTarget) => void
  toggleMiniAppContext: (appId: string, target?: SessionWriteTarget) => void

  addUserSelection: (text: string, target?: SessionWriteTarget) => void
  removeUserSelectionAt: (index: number, target?: SessionWriteTarget) => void
  clearUserSelections: (target?: SessionWriteTarget) => void

  addDir: (path: string, scope: 'session' | 'project', target?: SessionWriteTarget) => void
  removeDir: (path: string, scope: 'session' | 'project', target?: SessionWriteTarget) => void
  setShowDirManager: (show: boolean) => void
  setShowReviewPanel: (show: boolean) => void
  startCodexReview: (target: CodexReviewTarget) => void
}

export const SUBAGENT_COLOR_POOL = ['purple', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'rose'] as const
export type SubagentColor = (typeof SUBAGENT_COLOR_POOL)[number]
