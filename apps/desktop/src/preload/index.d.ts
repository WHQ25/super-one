import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AppMetricsSnapshot } from '@superone/shared/agent-types'
import type { OpenCodeResources } from '@superone/shared/agent-types'
import type { AgentEvent, AgentInfo, AgentPrewarmHint, ApiProvider, AppSettings, AppSettingsPatch, Automation, AutomationRunStatus, BashOutputEvent, BrowserCertError, BrowserOpenTabRequest, BrowserHistoryEntry, ChatMessage, ChatMessageContext, ClaudePreferences, ClaudeResources, CodexAuthStatus, CodexCollaborationMode, CodexGoal, CodexGoalStatus, CodexHookGroup, CodexMarketplaceAddRequest, CodexMarketplaceAddResult, CodexMarketplaceUpgradeResult, CodexPermissionPreset, CodexRateLimits, CodexRateLimitResetOutcome, CodexMcpOauthLoginResult, CodexExternalAgentItem, CodexExternalAgentImportResult, CodexAccountUsage, ClaudeRateLimits, ProviderRateLimits, CodexReasoningEffort, CodexResources, CodexReviewTarget, CodexRunResult, CodexSetAuthRequest, ContentBlock, ContextUsageInfo, CreateAutomationRequest, CreateProviderRequest, DiscoverModelsResult, FileOpResult, FileSearchResult, FileTreeEntry, NativeContextMenuItemSpec, GitDirtyStatus, GitFileContent, GitFileDiff, GitInfo, GitLogEntry, GitResult, GitStatusFile, HarnessId, HookConfig, HookSavePayload, ImageAttachment, ListDirEntry, LoadSessionMessagesResult, Locale, MarketplacePlugin, MarketplacePluginDetail, MarketplaceScope, McpCheckResult, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, MediaProviderStatus, UpsertMediaProviderRequest, MentionSearchItem, ModelOption, PermissionMode, PinnedSessionEntry, PluginDetail, PluginInfo, ProviderEndpointTestResponse, QuestionAnnotations, RecentFolder, RemoteDeviceConfig, ResourceScope, RewindFilesResult, SandboxInfo, SandboxMode, SandboxProbeResult, SendMessageRequest, SessionHistoryEntry, SessionSettingsPatch, SetupEvent, SkillDetail, SkillInfo, SlashCommandInfo, StartupData, TerminalEvent, TerminalListItem, TerminalSnapshot, ThemeMode, UpdateAutomationRequest, UpdateEvent, UpdateProviderRequest, WorktreeActivateRequest, WorktreeInfo, WorktreeHandoffResult, WorktreeAssignResult, SessionForkRequest, SessionForkResult } from '@superone/shared/agent-types'
import type { MiniAppEntry, MiniAppInstallMeta, MiniAppInstallResult, MiniAppPackResult, MiniAppPreviewResult, MiniAppToolCallRequest, MiniAppFsWatchEvent, MiniAppToolInterceptOpenRequest, MiniAppWorkerInfo, DevRegistryEntry, DevRegistryView } from '@superone/shared/miniapp-types'
import type { McpbInstallRequest, McpbInstalledEntry, McpbPreview } from '@superone/shared/mcpb-types'
import type { LiveSessionSnapshot } from '@superone/shared/session-types'
import type { ModelCatalog } from '@superone/shared/model-catalog-types'
import type { ConsumerBinding, ConsumerId, Credential, EndpointOverride, Platform, ServiceEndpoint } from '@superone/shared/platform-registry'
import type {
  DraftListEntry,
  DraftUpsertRequest,
  EnvironmentInstallProgress,
  EnvironmentListItem,
  ProjectSnapshot,
  SupervisorSnapshot,
} from '@superone/shared/environment'
// Re-export so renderer consumers of the preload types see the correlated shape.
export type { EnvironmentInstallProgress } from '@superone/shared/environment'


interface AgentAPI {
  sendMessage(projectPath: string, request: SendMessageRequest): Promise<void>
  dequeueMessage(projectPath: string, clientMessageId: string): Promise<boolean>
  prewarm(projectPath: string, hint?: AgentPrewarmHint): Promise<void>
  interrupt(sessionId: string): Promise<boolean>
  stopTask(sessionId: string, taskId: string): Promise<boolean>
  respondToPermission(sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>): Promise<boolean>
  setPermissionMode(projectPath: string, mode: PermissionMode): Promise<void>
  setSandboxMode(projectPath: string, mode: SandboxMode): Promise<SandboxInfo>
  setSessionSettings(projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null; mode?: string | null }): Promise<void>
  setSessionApiProvider(sessionId: string, apiProviderId: string | null): Promise<void>
  broadcastSessionSetting(sessionId: string, patch: SessionSettingsPatch): Promise<void>
  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): Promise<void>
  dismissQuestion(sessionId: string, requestId: string): Promise<void>
  respondToPlanApproval(sessionId: string, requestId: string, approved: boolean, feedback?: string): Promise<void>
  createSession(projectPath: string): Promise<string>
  resetSession(sessionId: string, newSessionId?: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | null>
  /** Grok ACP manual `/recap` → `x.ai/recap` (auto=false). Returns false if skipped/unavailable. */
  requestSessionRecap(sessionId: string): Promise<boolean>
  truncateAtCheckpoint(projectPath: string, checkpointId: string): Promise<boolean>
  parkSession(projectPath: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo }>
  activateSession(projectPath: string, sessionId: string): Promise<void>
  setSessionForeground(sessionId: string, foreground: boolean): Promise<void>
  getLiveSnapshots(): Promise<LiveSessionSnapshot[]>
  rewindFiles(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  previewRewind(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  rewindCodeAndChat(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  rewindConversation(projectPath: string): Promise<RewindFilesResult>
  getSessionId(projectPath: string): Promise<string>
  getMcpServerStatus(projectPath: string): Promise<McpServerInfo[]>
  authenticateMcpServer(projectPath: string, serverName: string): Promise<void>
  getContextUsage(projectPath: string, sessionId?: string): Promise<ContextUsageInfo | null>
  reloadPlugins(projectPath: string): Promise<boolean>
  listDirectory(projectPath: string, relativePath: string): Promise<ListDirEntry[]>
  listDirectoryForAddDir(projectPath: string, rawInput: string): Promise<{ absolutePath: string; entries: ListDirEntry[] }>
  validateAddDir(projectPath: string, candidate: string): Promise<{ ok: true } | { ok: false; reason: 'not-found' | 'not-directory' | 'same-as-project' | 'same-repo' }>
  findLineNumber(projectPath: string, filePath: string, text: string): Promise<number | null>
  searchFiles(projectPath: string, query: string, additionalDirs?: string[]): Promise<FileSearchResult[]>
  searchMentions(projectPath: string, query: string, agents: { name: string; model: string }[], additionalDirs?: string[], scopeDir?: string): Promise<MentionSearchItem[]>
  disconnectRemoteSession(sessionId?: string): Promise<void>
  readProjectAdditionalDirs(projectPath: string): Promise<{ user: string[]; projectShared: string[]; projectLocal: string[] }>
  addProjectAdditionalDir(projectPath: string, dir: string): Promise<void>
  removeProjectAdditionalDir(projectPath: string, dir: string): Promise<void>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
}

interface AppAPI {
  platform: NodeJS.Platform
  connectClaude(force?: boolean): Promise<ClaudeResources>
  connectCodex(): Promise<CodexResources>
  connectOpenCode(force?: boolean): Promise<OpenCodeResources>
  connectCursor(force?: boolean): Promise<import('@superone/shared/agent-types').CursorResources>
  setCursorApiKey(apiKey: string): Promise<{ ok: true; providerId: string }>
  getCursorAuthStatus(): Promise<{ configured: boolean; apiKeyName: string | null; userEmail: string | null }>
  updateCursorBaseConfig(patch: Record<string, unknown>): Promise<{ ok: true; config: Record<string, unknown> }>
  getCursorBaseConfig(): Promise<import('@superone/cursor').CursorConfig>
  cursorListAgents(opts?: { runtime?: 'local' | 'cloud'; cwd?: string; limit?: number; cursor?: string; includeArchived?: boolean }): Promise<unknown>
  cursorListRuns(agentId: string, opts?: { runtime?: 'local' | 'cloud'; cwd?: string; limit?: number; cursor?: string }): Promise<unknown>
  cursorArchiveAgent(agentId: string): Promise<{ ok: true }>
  cursorUnarchiveAgent(agentId: string): Promise<{ ok: true }>
  cursorDeleteAgent(agentId: string): Promise<{ ok: true }>
  cursorListArtifacts(agentId: string, opts?: { cwd?: string; model?: string }): Promise<Array<{ path: string; sizeBytes: number; updatedAt: string }>>
  cursorDownloadArtifact(agentId: string, path: string, opts?: { cwd?: string; model?: string }): Promise<{ path: string; base64: string; size: number }>
  cursorListRepositories(): Promise<Array<{ url: string }>>
  cursorGetAgent(agentId: string, opts?: { cwd?: string }): Promise<unknown>
  cursorListMessages(agentId: string, opts?: { cwd?: string; limit?: number; offset?: number }): Promise<unknown>
  cursorGetRun(runId: string, opts?: { agentId?: string; cwd?: string; runtime?: 'local' | 'cloud' }): Promise<unknown>
  cursorCancelRun(runId: string, opts?: { agentId?: string; cwd?: string; runtime?: 'local' | 'cloud' }): Promise<{ ok: true }>
  cursorForceRecover(sessionId: string, message?: string): Promise<{ ok: true }>
  cursorSdkLogin(): Promise<{ ok: true; email: string | null; apiKeyExpiresAtMs: number }>
  cursorSdkLogout(): Promise<{ ok: true }>
  cursorSdkAuthStatus(): Promise<
    | { status: 'logged-out' }
    | { status: 'logged-in'; backendUrl: string; email?: string; apiKeyExpiresAtMs?: number }
  >
  cursorGetUsage(agentId: string, opts?: { runId?: string }): Promise<{
    usage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      totalTokens: number
      reasoningTokens?: number
    }
    cost?: { rawCostCents: number; chargedCents: number }
    runs: Array<{
      runId: string
      usage: {
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
        totalTokens: number
        reasoningTokens?: number
      }
      cost?: { rawCostCents: number; chargedCents: number }
    }>
  }>
  cursorListSlashItems(projectPath: string): Promise<SlashCommandInfo[]>
  getStartupData(): Promise<StartupData>
  getAppMetrics(): Promise<AppMetricsSnapshot>
  probeSandbox(): Promise<SandboxProbeResult>
  selectFolder(defaultPath?: string): Promise<string | null>
  getRecentFolders(): Promise<RecentFolder[]>
  getMediaServerPort(): Promise<number>
  addRecentFolder(folderPath: string): Promise<boolean>
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>
  getProjectId(folderPath: string): Promise<string | null>
  openFolder(folderPath: string): Promise<boolean>
  openTmpFolder(): Promise<string>
  closeProject(folderPath: string): Promise<void>
  checkClaude(): Promise<boolean>
  installClaude(): Promise<void>
  /** Local harness installation catalog (Settings → Harnesses). */
  listHarnesses(): Promise<Array<{
    id: string
    enabled: boolean
    state: string
    runtimeSource: string
    requiresAuth: boolean
    runtimeVersion?: string
    command?: string
    diagnostic?: { code: string; message: string }
  }>>
  enableHarness(input: {
    harnessId: string
    artifactPath?: string
    command?: string
    serverUrl?: string
    args?: string[]
    forcePin?: boolean
  }): Promise<unknown>
  disableHarness(harnessId: string): Promise<unknown>
  probeHarness(harnessId: string): Promise<unknown>
  ensureHarness(harnessId: 'claude' | 'codex'): Promise<unknown>
  /** Onboarding: scan PATH for first-party harness CLIs. */
  scanHarnessClis(): Promise<{
    hits: Array<{
      harnessId: 'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok'
      command: string | null
      detected: boolean
      version?: string
    }>
    defaultSelected: Array<'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok'>
    visibleIds: Array<'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok'>
    integrationLabels: Record<
      'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok',
      { label: string }
    >
  }>
  /** Startup fallback: force pin-aligned install for every enabled Claude/Codex harness. */
  alignEnabledHarnesses(): Promise<{
    aligned: Array<{ id: 'claude' | 'codex'; runtimeVersion?: string }>
    failed: Array<{ id: 'claude' | 'codex'; error: string }>
  }>
  /** True when any enabled managed harness is not pin-aligned (skip gate UI if false). */
  needsHarnessAlign(): Promise<boolean>
  onHarnessInstallProgress(callback: (event: {
    harnessId: string
    received: number
    total: number
    phase: 'download' | 'done' | 'error'
    message?: string
  }) => void): () => void
  codexRun(sessionId: string, projectPath: string, prompt: string, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, collaborationMode?: CodexCollaborationMode, threadId?: string, messageId?: string, images?: ImageAttachment[], cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null }): Promise<CodexRunResult>
  codexSteer(sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] }): Promise<void>
  codexReview(sessionId: string, projectPath: string, target: CodexReviewTarget, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null }): Promise<CodexRunResult>
  codexCompact(sessionId: string, projectPath: string, model?: string, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null }): Promise<CodexRunResult>
  codexListModels(projectPath: string, apiProviderId?: string | null, force?: boolean): Promise<ModelOption[]>
  codexPlanApproval(projectPath: string, sessionId: string, messageId: string, status: 'approved' | 'rejected', feedback?: string): Promise<void>
  codexCollaborationModeChange(projectPath: string, sessionId: string, mode: string): Promise<void>
  codexGetAuthStatus(projectPath: string): Promise<CodexAuthStatus>
  codexGetRateLimits(projectPath: string, apiProviderId?: string | null): Promise<CodexRateLimits | null>
  codexGetAccountUsage(projectPath: string, apiProviderId?: string | null): Promise<CodexAccountUsage | null>
  codexConsumeRateLimitReset(projectPath: string, apiProviderId?: string | null, creditId?: string | null): Promise<CodexRateLimitResetOutcome | null>
  codexMcpServerOauthLogin(projectPath: string, serverName: string, apiProviderId?: string | null): Promise<CodexMcpOauthLoginResult>
  codexDetectExternalAgentConfig(projectPath: string, apiProviderId?: string | null): Promise<CodexExternalAgentItem[]>
  codexImportExternalAgentConfig(projectPath: string, items: CodexExternalAgentItem[], apiProviderId?: string | null): Promise<CodexExternalAgentImportResult | null>
  claudeGetRateLimits(force?: boolean): Promise<ClaudeRateLimits | null>
  providerGetRateLimits(apiProviderId: string, force?: boolean): Promise<ProviderRateLimits | null>
  acpGetRateLimits(projectPath: string, agentId: string, force?: boolean): Promise<ProviderRateLimits | null>
  codexSetAuth(projectPath: string, request: CodexSetAuthRequest): Promise<CodexAuthStatus>
  installUpdate(): Promise<void>
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  /** Retry harness pre-fetch after harness-error (app binary already downloaded). */
  retryUpdateHarness(): Promise<void>
  simulateUpdate(): Promise<void>
  onUpdateEvent(callback: (event: UpdateEvent) => void): () => void
  onSetupEvent(callback: (event: SetupEvent) => void): () => void

  // Plugins
  listPlugins(projectPath: string): Promise<PluginInfo[]>
  readPlugin(projectPath: string, key: string): Promise<PluginDetail | null>
  readPluginFile(projectPath: string, pluginKey: string, relativePath: string): Promise<string | null>
  deletePlugin(projectPath: string, key: string, scope: ResourceScope): Promise<void>
  listMarketplacePlugins(projectPath: string): Promise<MarketplacePlugin[]>
  installPlugin(projectPath: string, key: string, scope: ResourceScope): Promise<void>
  updatePlugins(projectPath: string, updates: Array<{ key: string; scope: ResourceScope }>): Promise<void>
  updateMarketplace(name: string): Promise<void>
  getGithubStars(repoSlug: string): Promise<number | null>
  /** Repos under a GitHub user/org for the add-project picker (`owner/` search). */
  searchGithubRepos(owner: string): Promise<
    Array<{
      owner: string
      name: string
      fullName: string
      description: string | null
      private: boolean
      stars: number | null
    }>
  >
  /** Free-text GitHub repository search for the add-project picker. */
  queryGithubRepos(query: string): Promise<
    Array<{
      owner: string
      name: string
      fullName: string
      description: string | null
      private: boolean
      stars: number | null
    }>
  >
  /** Authenticated viewer's repos via `gh` (add-project GitHub default list). */
  listMyGithubRepos(
    page?: number,
    perPage?: number,
  ): Promise<{
    repos: Array<{
      owner: string
      name: string
      fullName: string
      description: string | null
      private: boolean
      stars: number | null
    }>
    hasMore: boolean
    unavailable: boolean
  }>
  cacheRemoteImage(url: string): Promise<string | null>
  resolveFavicon(url: string, isDark: boolean, force?: boolean): Promise<string | null>
  resolveSiteIdentity(url: string, isDark: boolean, force?: boolean): Promise<{ name: string | null; icon: string | null }>
  cacheFavicon(pageUrl: string, faviconUrl: string, isDark: boolean): Promise<void>
  addMarketplace(source: string, scope: ResourceScope, projectPath: string): Promise<void>
  removeMarketplace(name: string, scope: MarketplaceScope, projectPath: string): Promise<void>
  readMarketplacePlugin(marketplace: string, name: string): Promise<MarketplacePluginDetail | null>
  readMarketplacePluginFile(marketplace: string, name: string, relativePath: string): Promise<string | null>

  // Agents
  listAgents(projectPath: string): Promise<(AgentInfo & { scope: 'user' | 'project' })[]>
  readAgentFile(projectPath: string, name: string): Promise<string | null>

  // Skills
  listSkills(projectPath: string): Promise<SkillInfo[]>
  /** Project skills + slash commands (remote node or local project dirs). */
  listSlashResources(projectPath: string): Promise<{
    skills: SlashCommandInfo[]
    commands: SlashCommandInfo[]
  }>
  readSkill(projectPath: string, name: string, sourcePath?: string): Promise<SkillDetail | null>
  readSkillFile(projectPath: string, skillName: string, relativePath: string, sourcePath?: string): Promise<string | null>
  installSkill(sourcePath: string): Promise<SkillInfo>
  deleteSkill(projectPath: string, sourcePath: string): Promise<void>
  toggleSkill(name: string, disabled: boolean): Promise<string[]>

  // Codex Skills
  codexListSkills(projectPath: string, opts?: { forceReload?: boolean }): Promise<SkillInfo[]>
  codexReadSkill(projectPath: string, name: string, sourcePath?: string): Promise<SkillDetail | null>
  codexReadSkillFile(projectPath: string, skillName: string, relativePath: string, sourcePath?: string): Promise<string | null>
  codexDeleteSkill(projectPath: string, sourcePath: string): Promise<void>
  codexToggleSkill(projectPath: string, selector: { name?: string; path?: string }, enabled: boolean): Promise<void>

  // Codex Hooks (read-only)
  codexListHooks(projectPath: string, opts?: { forceReload?: boolean }): Promise<CodexHookGroup[]>
  codexGetMcpStatus(projectPath: string, serverName?: string): Promise<McpServerInfo[]>
  codexReadMcpResource(projectPath: string, serverName: string, uri: string): Promise<Record<string, unknown> | null>
  codexCallMcpTool(projectPath: string, threadId: string, serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<Record<string, unknown>>

  // Codex Goal
  codexGetGoal(sessionId: string, threadId: string): Promise<CodexGoal | null>
  codexSetGoal(sessionId: string, threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null>
  codexClearGoal(sessionId: string, threadId: string): Promise<boolean>

  // Codex Marketplace
  codexMarketplaceAdd(projectPath: string, request: CodexMarketplaceAddRequest): Promise<CodexMarketplaceAddResult>
  codexMarketplaceRemove(projectPath: string, marketplaceName: string): Promise<void>
  codexMarketplaceUpgrade(projectPath: string, marketplaceName?: string): Promise<CodexMarketplaceUpgradeResult>

  // Codex Plugins
  codexListPlugins(projectPath: string): Promise<PluginInfo[]>
  codexReadPlugin(projectPath: string, key: string): Promise<PluginDetail | null>
  codexReadPluginFile(projectPath: string, pluginKey: string, relativePath: string): Promise<string | null>
  codexDeletePlugin(projectPath: string, key: string, scope: ResourceScope): Promise<void>
  codexListMarketplacePlugins(projectPath: string): Promise<MarketplacePlugin[]>
  codexInstallPlugin(projectPath: string, key: string, scope: ResourceScope): Promise<void>

  // Codex MCP config
  codexListMcpConfigs(projectPath: string): Promise<McpServerConfig[]>
  codexSaveMcpConfig(projectPath: string, name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope): Promise<void>
  codexDeleteMcpConfig(projectPath: string, name: string, scope: ResourceScope): Promise<void>
  codexToggleMcpConfig(projectPath: string, name: string, disabled: boolean, scope: ResourceScope): Promise<void>

  // MCP config
  listMcpConfigs(projectPath: string): Promise<McpServerConfig[]>
  saveMcpConfig(projectPath: string, name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope): Promise<void>
  deleteMcpConfig(projectPath: string, name: string, scope: ResourceScope): Promise<void>
  toggleMcpConfig(projectPath: string, name: string, disabled: boolean, scope: ResourceScope): Promise<void>
  checkMcpServers(projectPath: string, harness?: HarnessId): Promise<McpCheckResult>
  getMcpMetaCache(): Promise<Record<string, McpServerMeta>>
  oauthAuthorize(serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse'): Promise<Record<string, string>>

  // MCP library
  listMcpLibrary(): Promise<McpLibraryEntry[]>
  deleteMcpLibraryEntry(name: string): Promise<void>

  // MCP bundles (.mcpb)
  previewMcpb(filePath: string): Promise<McpbPreview>
  installMcpb(request: McpbInstallRequest): Promise<McpbInstalledEntry>
  uninstallMcpb(name: string): Promise<void>
  listInstalledMcpb(): Promise<McpbInstalledEntry[]>
  revealMcpb(name: string): Promise<void>

  // Hooks config
  listHooks(projectPath: string): Promise<HookConfig[]>
  saveHook(projectPath: string, payload: HookSavePayload, replaceId?: string): Promise<void>
  deleteHook(projectPath: string, id: string): Promise<void>

  // Unified AI provider platform (registry + credentials + bindings)
  listPlatforms(): Promise<Platform[]>
  createCustomPlatform(def: Platform): Promise<Platform>
  updateCustomPlatform(def: Platform): Promise<Platform>
  deleteCustomPlatform(id: string): Promise<boolean>
  listCredentials(): Promise<Credential[]>
  createCredential(input: { platformId: string; planId: string; name: string; secret?: string; secretEnv?: string; overrides?: Record<string, EndpointOverride>; endpoints?: ServiceEndpoint[]; notes?: string }): Promise<Credential>
  updateCredential(id: string, patch: { name?: string; secret?: string; secretEnv?: string; overrides?: Record<string, EndpointOverride>; endpoints?: ServiceEndpoint[] | null; notes?: string; sortOrder?: number }): Promise<Credential | undefined>
  deleteCredential(id: string): Promise<boolean>
  listBindings(): Promise<ConsumerBinding[]>
  setBinding(binding: ConsumerBinding): Promise<void>
  clearBinding(consumer: ConsumerId): Promise<void>
  testProviderEndpoint(data: { apiKey: string; credentialId?: string; endpoints: ServiceEndpoint[] }): Promise<ProviderEndpointTestResponse>
  discoverProviderModels(data: { apiKey: string; credentialId?: string; endpoint: ServiceEndpoint }): Promise<DiscoverModelsResult>
  listAcpAgents(): Promise<import('@superone/shared/agent-types').AcpResources>
  refreshAcpModels(agentId?: string): Promise<import('@superone/shared/agent-types').AcpResources>

  // File operations
  moveFile(folderPath: string, srcRelPath: string, destDirRelPath: string): Promise<FileOpResult>
  copyFilesIn(folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult>
  moveFilesIn(folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult>
  deleteFile(folderPath: string, relPath: string): Promise<FileOpResult>
  renameFile(folderPath: string, relPath: string, newName: string): Promise<FileOpResult>
  saveFile(folderPath: string, filePath: string, content: string): Promise<FileOpResult>
  readFileAsDataUri(absPath: string): Promise<{ ok: true; dataUri: string } | { ok: false; error: string }>
  getMediaProviders(): Promise<MediaProviderStatus[]>
  getModelCatalog(): Promise<ModelCatalog>
  refreshModelCatalog(): Promise<ModelCatalog>
  listWorkflowAgents(transcriptDir: string): Promise<Array<{ agentId: string; jsonlPath: string; label: string; prompt?: string; toolCount: number; tokens?: number; resultText?: string }>>
  readWorkflowOutput(filePath: string): Promise<{ summary?: string; agentCount?: number; logs: string[]; result?: unknown } | null>
  readWorkflowScript(filePath: string): Promise<string | null>
  /** Project + user `.grok/workflows/*.rhai` with parsed supported args. */
  discoverGrokWorkflows(projectPath?: string | null): Promise<Array<{
    name: string
    description: string
    whenToUse?: string
    source: 'project' | 'user'
    path: string
    args: Array<{ name: string; description?: string; required?: boolean }>
    exampleJson?: string
  }>>
  saveFileAs(
    sourcePath: string,
    defaultName: string,
    defaultDir?: string,
  ): Promise<{ ok: true; savedPath: string } | { ok: false; canceled?: boolean; error?: string }>
  showInFolder(folderPath: string, relPath: string): Promise<void>
  showContextMenu(items: NativeContextMenuItemSpec[]): Promise<string | null>
  openExternalLink(url: string): Promise<void>
  clipboardRead(): Promise<string>
  clipboardWrite(text: string): Promise<void>
  clipboardWriteImage(absPath: string): Promise<{ ok: true } | { ok: false; error: string }>
  fetchBrowserImage(
    url: string,
  ): Promise<{ ok: true; base64: string; mimeType: string } | { ok: false; error: string }>
  saveBrowserImage(
    base64: string,
    mimeType: string,
    suggestedName: string,
    defaultDir?: string,
  ): Promise<{ ok: true; savedPath: string } | { ok: false; canceled?: boolean; error?: string }>
  copyBrowserImageAt(
    webContentsId: number,
    x: number,
    y: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  revealFile(absPath: string): Promise<void>
  getPathForFile(file: File): string
  startDrag(paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }): void
  pathStat(path: string): Promise<{ isFile: boolean; isDirectory: boolean } | null>

  // File watcher
  startFileWatch(folderPath: string): Promise<void>
  stopFileWatch(): Promise<void>
  onFileChangeEvent(callback: (event: { folderPath: string }) => void): () => void
  onGitHeadChange(callback: (event: { folderPath: string }) => void): () => void
  onCodexSkillsChanged(callback: (event: { projectPath: string }) => void): () => void
  onSessionChanged(callback: () => void): () => void

  // Bash output watcher
  watchBashOutput(toolUseId: string, filePath: string, tailLines?: number): Promise<void>
  unwatchBashOutput(toolUseId: string): Promise<void>
  readBashOutputMore(toolUseId: string, tailLines: number): Promise<string>
  readBashOutputFile(filePath: string, tailLines: number): Promise<string>
  readSubagentTranscript(outputFile: string, dir?: string): Promise<Array<{ type: string; message: { content: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> } }> | null>
  onBashOutputEvent(callback: (event: BashOutputEvent) => void): () => void

  // Settings
  getProjectPreferences(projectPath: string): Promise<ClaudePreferences>
  saveProjectPreferences(projectPath: string, preferences: Partial<ClaudePreferences>): Promise<ClaudePreferences>
  setFastMode(enabled: boolean): Promise<void>
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(patch: AppSettingsPatch): Promise<AppSettings>
  getInstallId(): Promise<string>
  /**
   * false — status only.
   * true | 'guided' — two-step onboarding float (first enable).
   * 'accessibility' | 'screenRecording' — single-permission float.
   */
  openComputerUsePermissions(
    request?: boolean | 'guided' | 'accessibility' | 'screenRecording',
  ): Promise<{
    requested: boolean
    accessibility?: string
    screenRecording?: string
    helperName?: string
    helperBundleId?: string
    helperPath?: string
    screenRecordingNeedsRelaunch?: boolean
    reason?: string
    error?: string
  }>
  /** Restart helper once and re-read TCC / runtime permission status. */
  recheckComputerUsePermissions(): Promise<{
    requested: boolean
    accessibility?: string
    screenRecording?: string
    helperName?: string
    helperBundleId?: string
    helperPath?: string
    screenRecordingNeedsRelaunch?: boolean
    reason?: string
    error?: string
  }>
  closeComputerUsePermissionFloat(): Promise<void>
  resizeComputerUsePermissionFloat(width: number, height: number): Promise<void>
  continueComputerUsePermissionStep(): Promise<void>
  onComputerUsePermissionStatus(
    callback: (status: {
      accessibility?: string
      screenRecording?: string
      helperName?: string
      helperBundleId?: string
      helperPath?: string
      screenRecordingNeedsRelaunch?: boolean
      pane?: 'accessibility' | 'screenRecording'
      flow?: 'guided' | 'single'
    }) => void,
  ): () => void
  listComputerUseRunningApps(): Promise<
    Array<{ app: string; bundleId: string; pid: number; frontmost: boolean }>
  >
  /** Best-effort PNG data URI for a macOS app bundle id; null when lookup fails. */
  listComputerUseInstalledApps(): Promise<
    Array<{ app: string; bundleId: string; aliases: string[] }>
  >
  grantComputerUseSessionApps(
    sessionId: string,
    apps: Array<{ app: string; bundleId: string }>,
  ): Promise<boolean>
  resolveComputerUseAppIcon(bundleId: string): Promise<string | null>
  recordBrowserHistory(url: string, title: string, titleOnly?: boolean): Promise<void>
  suggestBrowserHistory(query: string, limit?: number): Promise<BrowserHistoryEntry[]>
  deleteBrowserHistory(url: string | null): Promise<void>
  browserCertProceed(url: string): Promise<void>
  onBrowserCertError(callback: (payload: BrowserCertError) => void): () => void
  onBrowserOpenTab(callback: (payload: BrowserOpenTabRequest) => void): () => void
  pickAppIconFile(): Promise<string | null>
  setAppIcon(pngDataUri: string): Promise<AppSettings>
  resetAppIcon(): Promise<AppSettings>
  onAppSettingsChange(callback: (settings: AppSettings) => void): () => void
  getSystemLocale(): Promise<string>
  onLocaleChanged(callback: (locale: Locale) => void): () => void

  // Logging
  getLogPath(): Promise<string>

  // Usage statistics
  queryUsage(range?: { from?: string; to?: string }): Promise<{
    rows: Array<{
      day: string
      harness: 'claude' | 'codex' | 'grok'
      model: string
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
    }>
  }>
  queryUsageCounts(range?: { from?: string; to?: string; harness?: 'claude' | 'codex' | 'grok' | 'cursor' | 'opencode' }): Promise<{
    sessions: number
    messages: number
  }>
  queryHarnessSessionRanks(days?: number): Promise<import('@superone/shared/agent-types').HarnessSessionRank[]>
  getUsageBackfillStatus(): Promise<'done' | 'pending'>
  onUsageBackfillDone(callback: (summary: { scanned: number; claudeRecorded: number; codexRecorded: number; grokRecorded: number; durationMs: number }) => void): () => void

  onContentZoom(callback: (action: 'in' | 'out' | 'reset') => void): () => void

  onCloseTabShortcut(callback: () => void): () => void

  onBrowserAnnotateShortcut(callback: (webContentsId: number) => void): () => void

  onBrowserBookmarkShortcut(callback: (webContentsId: number) => void): () => void

  onBrowserNewTabShortcut(callback: () => void): () => void

  closeWindow(): void

  // Window state
  getFullscreen(): Promise<boolean>
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void
  setMinWindowSize(width: number, height: number): Promise<void>
  openSessionWindow(projectPath: string, sessionId: string, title?: string, position?: { x: number; y: number }): Promise<void>
  startDragPreview(title: string): Promise<void>
  endDragPreview(): Promise<void>
  onDragPreviewUpdate(callback: (data: { title: string; dark: boolean }) => void): () => void
  onDragPreviewZone(callback: (zone: 'inside' | 'outside') => void): () => void
  setWindowAlwaysOnTop(value: boolean): Promise<boolean>
  getTheme(): Promise<{ mode: ThemeMode; dark: boolean }>
  setTheme(mode: ThemeMode): Promise<void>
  onThemeChange(callback: (state: { mode: ThemeMode; dark: boolean }) => void): () => void

  // Git
  getGitInfo(folderPath: string): Promise<GitInfo | null>
  getGitIsRepo(folderPath: string): Promise<boolean>
  gitInit(folderPath: string): Promise<GitResult>
  getGitBranches(folderPath: string): Promise<string[]>
  switchGitBranch(folderPath: string, branch: string): Promise<GitResult>
  createBranch(folderPath: string, branch: string): Promise<GitResult>
  pathExists(p: string): Promise<boolean>
  getWorktreeInfo(folderPath: string): Promise<WorktreeInfo | null>
  getCheckedOutBranches(folderPath: string): Promise<string[]>
  activateWorktree(folderPath: string, request: WorktreeActivateRequest | null): Promise<{ ok: true; path: string } | { ok: false; error: string }>
  switchToExistingWorktree(folderPath: string, wtPath: string, gitBranch: string | null): Promise<{ ok: true } | { ok: false; error: string }>
  handoffToLocal(worktreePath: string, folderPath?: string): Promise<WorktreeHandoffResult>
  getHandoffPreview(worktreePath: string, folderPath?: string): Promise<GitDirtyStatus | null>
  assignBranch(folderPath: string, worktreePath: string, name: string): Promise<WorktreeAssignResult>
  forkSession(request: SessionForkRequest): Promise<SessionForkResult>
  getGitStatusFiles(folderPath: string): Promise<GitStatusFile[]>
  getGitLog(folderPath: string, query?: string): Promise<GitLogEntry[]>
  getGitDiffFile(folderPath: string, filePath: string, staged: boolean): Promise<GitFileDiff>
  readProjectFile(folderPath: string, filePath: string): Promise<GitFileContent>
  setUnsavedEditorBuffer(filePath: string, content: string | null): Promise<void>
  getFileTree(folderPath: string): Promise<FileTreeEntry[]>
  listDir(folderPath: string, dirRelPath: string): Promise<FileTreeEntry[]>

  // Session history
  listSessions(projectPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolder(folderPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolderPage(folderPath: string, limit: number, offset: number): Promise<SessionHistoryEntry[]>
  resumeSession(projectPath: string, sessionId: string, worktreeCwd?: string, permissionMode?: PermissionMode): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined>
  loadSessionMessages(projectPath: string, sessionId: string, limit: number, cursor?: number): Promise<LoadSessionMessagesResult>
  renameSession(sessionId: string, title: string): Promise<void>
  loadSessionState(sessionId: string): Promise<{ messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; worktreePath: string | null; provider: string; apiProviderId?: string | null; acpAgentId?: string | null; title?: string | null } | null>
  deleteSession(sessionId: string): Promise<void>
  deleteSessionsOlderThan(folderPath: string, cutoffDate: string): Promise<string[]>
  pinSession(sessionId: string, pinned: boolean): Promise<void>
  hideSession(sessionId: string, hidden: boolean): Promise<void>
  listPinnedSessions(): Promise<PinnedSessionEntry[]>

  trace(source: string, type: string, data: unknown, tag?: string): void

  submitToolIntercept(callId: string, userInput: Record<string, unknown>): Promise<void>
  cancelToolIntercept(callId: string, reason?: string): Promise<void>
  onToolInterceptOpen(callback: (req: MiniAppToolInterceptOpenRequest) => void): () => void
  onToolInterceptClear(callback: (projectDir: string, callIds: string[]) => void): () => void

  // Remote control
  getRelayStatus(): Promise<boolean>
  getLanStatus(): Promise<boolean>
  getHostname(): Promise<string>
  getRemoteConfig(): Promise<RemoteDeviceConfig | null>
  saveRemoteConfig(config: RemoteDeviceConfig): Promise<void>
  onRecentFoldersChanged(callback: (folders: unknown[]) => void): () => void
  onRemoteCommand(callback: (command: unknown) => void): () => void
  onClientRegistered(callback: (info: { deviceName: string }) => void): () => void
  listPairedDevices(): Promise<import('@superone/shared/agent-types').PairedDevice[]>
  removePairedDevice(id: string): Promise<void>
  onDeviceStatusChanged(callback: (device: import('@superone/shared/agent-types').RemoteDeviceStatus) => void): () => void
  onUploadProgress(callback: (progress: import('@superone/shared/agent-types').MobileUploadProgress) => void): () => void
  startPairing(): Promise<{ channelId: string; tempKeyHex: string; relayUrl: string }>
  confirmPairing(code: string): Promise<void>
  cancelPairing(): Promise<void>
  onPairingCodeReceived(callback: (info: { code: string; deviceName: string }) => void): () => void
  onPairingExpired(callback: () => void): () => void
  onPairingAlreadyPaired(callback: (info: { deviceName: string }) => void): () => void
  onRelayStatusChanged(callback: (connected: boolean) => void): () => void
  onLanStatusChanged(callback: (active: boolean) => void): () => void

  widgetIframeReady(widgetId: string): Promise<void>
  saveWidgetTemplate(projectPath: string | null, input: import('@superone/shared/agent-types').SaveWidgetTemplateRequest): Promise<import('@superone/shared/agent-types').SavedWidgetTemplate>

  // Automations
  listAutomations(projectPath: string): Promise<Automation[]>
  createAutomation(projectPath: string, data: CreateAutomationRequest): Promise<Automation>
  updateAutomation(id: string, data: UpdateAutomationRequest): Promise<Automation | undefined>
  deleteAutomation(id: string): Promise<boolean>
  runAutomationNow(id: string): Promise<void>
  onAutomationEvent(callback: (event: { automationId: string; status: AutomationRunStatus; sessionId?: string; error?: string; projectPath?: string }) => void): () => void
  /** List mutation (create/update/delete). projectPath scopes which sidebars should re-list. */
  onAutomationsChanged(callback: (event: { projectPath?: string }) => void): () => void
}

interface MiniAppAPI {
  list(projectDir?: string): Promise<MiniAppEntry[]>
  open(appId: string, projectDir: string, sessionId: string): Promise<void>
  close(appId: string, projectDir: string, sessionId: string): Promise<void>
  authorize(appIds: string[], projectDir: string, sessionId: string): Promise<void>
  unauthorize(appIds: string[], projectDir: string, sessionId: string): Promise<void>
  toolResult(callId: string, result: unknown, error?: string): Promise<void>
  fsRequest(projectDir: string, appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  startDrag(projectDir: string, appId: string, paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }): void
  gitRequest(projectDir: string, appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  dbRequest(projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  kvRequest(projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  onGitHeadChangeEvent(callback: (event: { projectDir: string; appId: string }) => void): () => void
  onLazyOpenRequest(callback: (event: { appId: string; projectDir: string; sessionId: string }) => void): () => void
  onPeerEvent(callback: (event: { sessionId: string; appId: string; event: string; payload: unknown }) => void): () => void
  peerEmit(appId: string, event: string, payload: unknown): void
  workerStart(projectDir: string, appId: string): Promise<{ running: boolean; since?: number }>
  workerStop(projectDir: string, appId: string): Promise<{ running: boolean }>
  workerStatus(projectDir: string, appId: string): Promise<{ running: boolean; since?: number }>
  workerSend(projectDir: string, appId: string, payload: unknown): void
  onWorkerEvent(handler: (data: { appId: string; projectDir: string; payload: unknown }) => void): () => void
  workerList(): Promise<MiniAppWorkerInfo[]>
  onWorkerState(handler: (workers: MiniAppWorkerInfo[]) => void): () => void
  fsWatch(projectDir: string, appId: string, path: string): Promise<number>
  fsUnwatch(watchId: number): Promise<void>
  onFsWatchEvent(callback: (event: MiniAppFsWatchEvent) => void): () => void
  iframeReady(appId: string, projectDir: string): Promise<void>
  onToolCall(callback: (call: MiniAppToolCallRequest) => void): () => void
  getPreloadPath(): Promise<string>
  detectDev(projectDir: string): Promise<MiniAppEntry[]>
  onDevAppReady(callback: (projectDir: string, appId: string) => void): () => void
  preview(s1appPath: string): Promise<MiniAppPreviewResult>
  confirmInstall(tempDir: string, installDir?: string, preapprovedTools?: string[]): Promise<MiniAppInstallResult>
  cancelInstall(tempDir: string): Promise<void>
  uninstall(appId: string, installDir?: string): Promise<void>
  pack(appDir: string, outputDir: string): Promise<MiniAppPackResult>
  getInstallMeta(appId: string): Promise<MiniAppInstallMeta | null>
  getPreapproved(appId: string): Promise<string[]>
  setPreapproved(appId: string, tools: string[]): Promise<void>
  devRegistry: {
    list(): Promise<DevRegistryView[]>
    add(): Promise<DevRegistryEntry | null>
    remove(appId: string, cascade?: boolean): Promise<void>
    install(appId: string, scope: 'user' | 'project', projectDir?: string, force?: boolean): Promise<{ installDir: string }>
    uninstall(appId: string, scope: 'user' | 'project', projectDir?: string): Promise<void>
    setEnabled(appId: string, scope: 'user' | 'project', enabled: boolean, projectDir?: string): Promise<void>
    revealSource(appId: string): Promise<void>
  }
}

interface TerminalAPI {
  create(opts: { projectPath: string; sessionId?: string; title?: string; cols?: number; rows?: number }): Promise<TerminalListItem>
  list(cwd?: string): Promise<TerminalListItem[]>
  snapshot(terminalId: string): Promise<TerminalSnapshot | null>
  write(terminalId: string, data: string): Promise<void>
  resize(terminalId: string, cols: number, rows: number): Promise<void>
  kill(terminalId: string): Promise<void>
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void
}

/** Multi-environment / remote node — Main EnvironmentHost product path. */
export interface EnvironmentAPI {
  list(): Promise<unknown[]>
  getLocalId(): Promise<string>
  workspaceListDir(
    project: { environmentId: string; projectId: string },
    relativePath: string,
  ): Promise<unknown>
  workspaceReadFile(
    project: { environmentId: string; projectId: string },
    relativePath: string,
  ): Promise<unknown>
  workspaceTailWatchStart(
    project: { environmentId: string; projectId: string },
    relativePath: string,
    offset?: number,
    absolutePath?: string,
  ): Promise<{ watchId: string; offset: number; relativePath: string; absolutePath?: string }>
  workspaceTailWatchPoll(
    watchId: string,
    project?: { environmentId: string; projectId: string },
  ): Promise<{ content: string; encoding: 'base64'; offset: number; size: number; missing?: boolean }>
  workspaceTailWatchStop(
    watchId: string,
    project: { environmentId: string; projectId: string },
  ): Promise<{ ok: boolean }>
  pairRemote(input: {
    baseUrl: string
    pairingToken: string
    label: string
  }): Promise<{ connectionId: string; descriptor: unknown; persisted: boolean }>
  connectWithFailover(connectionId: string): Promise<unknown>
  /** Dev-only: probe local remote-node lab on loopback. */
  localLabStatus(): Promise<{
    available: boolean
    baseUrl: string
    label: string
    nodeHome: string
    reachable: boolean
    environmentId?: string
    nodePublicKeyFingerprint?: string
    error?: string
    startHint: string
  }>
  /** Dev-only: mint token + pair/connect to local lab. */
  pairLocalLab(): Promise<{
    connectionId: string
    alreadyPaired: boolean
    persisted: boolean
    baseUrl: string
    label: string
  }>

  listItems(): Promise<EnvironmentListItem[]>
  addOverSsh(input: {
    destination: string
    remoteExec?: string
    installSource?: 'registry' | 'upload'
    packageVersion?: string
    remotePort?: number
    remoteNodeHome?: string
    sshPort?: number
    identityFile?: string
    label?: string
  }): Promise<{
    connectionId: string
    persisted: boolean
    warnings: string[]
    installed?: {
      version: string
      target: string
      sha256: string
      remoteExec: string
      source: 'registry' | 'upload'
    }
  }>
  /**
   * Install this desktop's CLI version on an already-paired node, restart it,
   * and reconnect. Only valid when `nodeUpgrade.canUpgradeOverSsh` is true.
   */
  upgradeNode(connectionId: string): Promise<{ version: string; warnings: string[] }>
  /** Host aliases from the local OpenSSH client config (~/.ssh/config). */
  listSshConfigHosts(): Promise<SshConfigHostEntry[]>
  /** Admin harness catalog on a connected remote node. */
  listHarnesses(connectionId: string): Promise<
    Array<{
      id: string
      runtimeSource: string
      enabled: boolean
      state: string
      runtimeVersion?: string
      command?: string
      requiresAuth: boolean
      diagnostic?: { code: string; message: string }
    }>
  >
  enableHarness(
    connectionId: string,
    input: {
      harnessId: string
      artifactPath?: string
      command?: string
      serverUrl?: string
      args?: string[]
    },
  ): Promise<{
    id: string
    enabled: boolean
    state: string
    command?: string
    diagnostic?: { code: string; message: string }
  }>
  disableHarness(
    connectionId: string,
    harnessId: string,
  ): Promise<{ id: string; enabled: boolean; state: string }>
  probeHarness(connectionId: string, harnessId: string): Promise<unknown>
  /** Projects for sidebar: `local` or a remote connectionId (must be connected). */
  listProjects(connectionId: string, options?: { refresh?: boolean }): Promise<ProjectSnapshot[]>
  /** Open/register a project path on a host; `createIfMissing` backs "Create & Add". */
  openProject(
    connectionId: string,
    projectPath: string,
    opts?: { createIfMissing?: boolean },
  ): Promise<ProjectSnapshot>
  /** Unregister a project from a host list (does not delete disk files). */
  removeProject(
    connectionId: string,
    input: { projectId?: string; path?: string },
  ): Promise<{ projectId?: string; path: string; name?: string; lastActiveAt?: number }>
  /**
   * Unsent composer drafts owned by this environment. A remote list merges in
   * anything still queued locally for that node (`pendingSync: true`); an
   * unreachable node contributes nothing rather than a stale mirror.
   */
  listDrafts(connectionId: string, projectPath?: string): Promise<DraftListEntry[]>
  upsertDraft(connectionId: string, draft: DraftUpsertRequest): Promise<DraftListEntry>
  deleteDraft(connectionId: string, draftId: string): Promise<void>
  /**
   * List sessions for a project on any environment (local or remote).
   * Local: connectionId `'local'`, projectId = project UUID or absolute folder path.
   * Prefer this over window.app.listSessions* (legacy).
   */
  listSessions(
    connectionId: string,
    projectId: string,
    options: { limit: number; offset: number },
  ): Promise<
    Array<{
      sessionId: string
      title: string
      lastActiveAt: string
      provider?: string
      messageCount: number
      isPinned?: boolean
      isHidden?: boolean
      worktreePath?: string | null
      isWorktree?: boolean
      parentSessionId?: string
      gitBranch?: string
      isAutomation?: boolean
      automationId?: string
      acpAgentId?: string
      providerSessionId?: string
    }>
  >
  /** Create a session on a remote node project. */
  createSession(
    connectionId: string,
    input: { projectId: string; title?: string; providerId?: string; harnessId?: string },
  ): Promise<{
    sessionId: string
    title: string
    lastActiveAt: string
    provider?: string
    messageCount: number
  }>
  getSession(connectionId: string, sessionId: string): Promise<unknown>
  /** Node-local AI provider store. */
  listRemoteCredentials(connectionId: string): Promise<unknown>
  createRemoteCredential(connectionId: string, input: Record<string, unknown>): Promise<unknown>
  updateRemoteCredential(connectionId: string, input: Record<string, unknown>): Promise<unknown>
  deleteRemoteCredential(connectionId: string, id: string): Promise<unknown>
  listRemoteBindings(connectionId: string): Promise<unknown>
  setRemoteBinding(connectionId: string, binding: Record<string, unknown>): Promise<unknown>
  clearRemoteBinding(connectionId: string, consumer: string): Promise<unknown>
  listRemoteCustomPlatforms(connectionId: string): Promise<unknown>
  upsertRemoteCustomPlatform(connectionId: string, def: Record<string, unknown>): Promise<unknown>
  deleteRemoteCustomPlatform(connectionId: string, id: string): Promise<unknown>
  pushLocalProvidersToRemote(
    connectionId: string,
    opts?: { replaceAll?: boolean },
  ): Promise<{ credentials: number; bindings: number }>
  pullRemoteProvidersToLocal(
    connectionId: string,
    opts?: { replaceAll?: boolean },
  ): Promise<{ credentials: number; bindings: number }>
  listRemoteModels(
    connectionId: string,
    harness: string,
    apiProviderId?: string | null,
  ): Promise<Array<{ id: string; name: string; description: string; isDefault?: boolean }>>
  sendSessionMessage(
    connectionId: string,
    input: {
      sessionId: string
      text: string
      clientMessageId?: string
      projectPath?: string
      providerId?: string
      cwdHostPath?: string | null
      model?: string | null
      effort?: string | null
      permissionMode?: string | null
      additionalDirectories?: string[]
      enabledSkills?: string[]
      disabledSkills?: string[]
      images?: Array<{ name?: string; mimeType: string; base64: string }>
      apiProviderId?: string | null
      /** Codex turn kind for session.send options.turnKind (runtime already forwarded). */
      turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
      collaborationMode?: string | Record<string, unknown> | null
      reviewTarget?: unknown
    },
  ): Promise<unknown>
  /** Poll durable node `session.events` after sequence (exclusive). */
  listSessionEvents(connectionId: string, afterSequence?: string): Promise<unknown[]>
  /**
   * Paged denser message catalog (`session.messages.list`) for remote UI hydrate.
   * Prefer over text-only recovery when available.
   */
  listSessionMessages(
    connectionId: string,
    input: { sessionId: string; cursor?: string | number | null; limit?: number },
  ): Promise<{
    messages?: Array<Record<string, unknown>>
    nextCursor?: string | number | null
    hasMore?: boolean
  }>
  interruptSession(connectionId: string, sessionId: string): Promise<void>
  renameSession(connectionId: string, sessionId: string, title: string): Promise<unknown>
  removeSession(connectionId: string, sessionId: string): Promise<unknown>
  setSessionUiFlags(
    connectionId: string,
    sessionId: string,
    flags: { isPinned?: boolean; isHidden?: boolean },
  ): Promise<unknown>
  /** Fork a remote session onto a new node worktree or same-dir local. */
  forkSession(
    connectionId: string,
    input: { sessionId: string; mode?: 'local' | 'worktree'; forkFromMessageId?: string },
  ): Promise<{ ok: true; sessionId: string; worktreePath?: string } | { ok: false; error: string }>
  respondSessionPermission(
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      decision: 'allow' | 'deny' | 'allow_always'
      formAnswers?: Record<string, unknown>
      cancel?: boolean
      continueDrain?: {
        projectPath?: string
        providerId?: string
        timeoutMs?: number
      }
    },
  ): Promise<unknown>
  respondSessionQuestion(
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      answers: unknown
      continueDrain?: {
        projectPath?: string
        providerId?: string
        timeoutMs?: number
      }
    },
  ): Promise<unknown>
  respondSessionPlan(
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      decision: 'approve' | 'reject'
      options?: Record<string, unknown>
      continueDrain?: {
        projectPath?: string
        providerId?: string
        timeoutMs?: number
      }
    },
  ): Promise<unknown>
  /** Resume live event drain for a still-streaming remote session. */
  resumeRemoteSessionEvents(
    connectionId: string,
    input: {
      sessionId: string
      projectPath?: string
      providerId?: string
      settleAfterInteractionId?: string
      timeoutMs?: number
    },
  ): Promise<unknown>
  /** Directory listing for the add-project path browser. */
  browsePath(
    connectionId: string,
    absolutePath: string,
  ): Promise<{ path: string; entries: Array<{ name: string; path: string; type: 'directory' }> }>
  /** Clone a repository onto a host and register the clone as a project. */
  cloneRepository(
    connectionId: string,
    input: { remoteUrl: string; parentPath: string; directoryName?: string },
  ): Promise<{ projectId: string; path: string; name: string; lastActiveAt?: number }>
  connect(connectionId: string): Promise<unknown>
  disconnect(connectionId: string): Promise<void>
  forget(connectionId: string): Promise<void>
  retryNow(
    connectionId: string,
  ): Promise<'started' | 'already_connected' | 'blocked' | 'disposed'>
  repairPairing(input: {
    connectionId: string
    baseUrl: string
    pairingToken: string
  }): Promise<unknown>
  /**
   * Re-pair over the stored SSH endpoint. The desktop mints a fresh pairing
   * token on the host and keeps the same connectionId (no project-key churn).
   */
  repairPairingOverSsh(connectionId: string): Promise<unknown>

  /**
   * Node harness.resources aggregate (models + skills/commands/agents/prompts).
   * Prefer over desktop CONNECT_* caches for remote project boot.
   */
  getRemoteHarnessResources(
    connectionId: string,
    input: {
      projectId: string
      harnessId?: string
      apiProviderId?: string | null
    },
  ): Promise<unknown>

  /** Node session_providers list (optional harness filter). */
  listRemoteSessionProviders(
    connectionId: string,
    harnessId?: string,
  ): Promise<unknown>
  getRemoteSessionProvider(connectionId: string, id: string): Promise<unknown>
  getRemoteSessionProviderBase(connectionId: string, harnessId: string): Promise<unknown>
  createRemoteSessionProvider(
    connectionId: string,
    input: { harnessId: string; name: string; config?: unknown; id?: string },
  ): Promise<unknown>
  updateRemoteSessionProvider(
    connectionId: string,
    id: string,
    patch: { name?: string; config?: unknown },
  ): Promise<unknown>
  deleteRemoteSessionProvider(connectionId: string, id: string): Promise<unknown>

  onStatusEvent(callback: (snapshot: SupervisorSnapshot) => void): () => void
  onInstallProgress(callback: (progress: EnvironmentInstallProgress) => void): () => void
}

/** Selectable Host from local ~/.ssh/config (see main environment/ssh-config). */
export interface SshConfigHostEntry {
  alias: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  display: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    terminal: TerminalAPI
    app: AppAPI
    environment: EnvironmentAPI
    miniapp: MiniAppAPI
    browserHost: BrowserHostAPI
  }
}

export interface BrowserHostAPI {
  onAutomationCall(
    callback: (req: { callId: string; sessionId: string; op: string; input: unknown }) => void,
  ): () => void
  sendAutomationResult(callId: string, ok: boolean, result?: unknown, error?: string): void
}
