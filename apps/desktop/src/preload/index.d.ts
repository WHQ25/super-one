import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentEvent, AgentInfo, AgentPrewarmHint, ApiProvider, AppSettings, AppSettingsPatch, Automation, AutomationRunStatus, BashOutputEvent, ChatMessage, ChatMessageContext, ClaudePreferences, ClaudeResources, CodexAuthStatus, CodexCollaborationMode, CodexPermissionPreset, CodexProviderTestProgress, CodexReasoningEffort, CodexResources, CodexReviewTarget, CodexRunResult, CodexSetAuthRequest, ContentBlock, ContextUsageInfo, CreateAutomationRequest, CreateProviderRequest, FileOpResult, FileSearchResult, FileTreeEntry, GitDirtyStatus, GitFileContent, GitFileDiff, GitInfo, GitLogEntry, GitResult, GitStatusFile, HookConfig, HookSavePayload, ImageAttachment, ListDirEntry, LoadSessionMessagesResult, Locale, MarketplacePlugin, MarketplacePluginDetail, MarketplaceScope, McpCheckResult, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, MentionSearchItem, ModelOption, PermissionMode, PinnedSessionEntry, PluginDetail, PluginInfo, QuestionAnnotations, RecentFolder, RemoteDeviceConfig, ResourceScope, RewindFilesResult, SandboxInfo, SandboxMode, SandboxProbeResult, SendMessageRequest, SessionHistoryEntry, SessionSettingsPatch, SetupEvent, SkillDetail, SkillInfo, StartupData, TerminalEvent, TerminalListItem, TerminalSnapshot, UpdateAutomationRequest, UpdateEvent, UpdateProviderRequest, WorktreeActivateRequest, WorktreeInfo, WorktreeHandoffResult, SessionForkRequest, SessionForkResult } from '@superone/shared/agent-types'
import type { MiniAppEntry, MiniAppInstallMeta, MiniAppInstallResult, MiniAppPackResult, MiniAppPreviewResult, MiniAppToolCallRequest, MiniAppFsWatchEvent, MiniAppToolInterceptOpenRequest, MiniAppWorkerInfo, DevRegistryEntry, DevRegistryView } from '@superone/shared/miniapp-types'
import type { McpbInstallRequest, McpbInstalledEntry, McpbPreview } from '@superone/shared/mcpb-types'
import type { LiveSessionSnapshot } from '@superone/shared/session-types'


interface AgentAPI {
  sendMessage(projectPath: string, request: SendMessageRequest): Promise<void>
  dequeueMessage(projectPath: string, clientMessageId: string): Promise<boolean>
  prewarm(projectPath: string, hint?: AgentPrewarmHint): Promise<void>
  interrupt(sessionId: string): Promise<boolean>
  respondToPermission(sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>): Promise<boolean>
  setPermissionMode(projectPath: string, mode: PermissionMode): Promise<void>
  setSandboxMode(projectPath: string, mode: SandboxMode): Promise<SandboxInfo>
  setSessionSettings(projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null }): Promise<void>
  setSessionApiProvider(sessionId: string, apiProviderId: string | null): Promise<void>
  broadcastSessionSetting(sessionId: string, patch: SessionSettingsPatch): Promise<void>
  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): Promise<void>
  dismissQuestion(sessionId: string, requestId: string): Promise<void>
  respondToPlanApproval(sessionId: string, requestId: string, approved: boolean, feedback?: string): Promise<void>
  createSession(projectPath: string): Promise<string>
  resetSession(sessionId: string, newSessionId?: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | null>
  truncateAtCheckpoint(projectPath: string, checkpointId: string): Promise<boolean>
  parkSession(projectPath: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo }>
  activateSession(projectPath: string, sessionId: string): Promise<void>
  getLiveSnapshots(): Promise<LiveSessionSnapshot[]>
  rewindFiles(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  previewRewind(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  rewindCodeAndChat(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  rewindConversation(projectPath: string): Promise<RewindFilesResult>
  getSessionId(projectPath: string): Promise<string>
  getMcpServerStatus(projectPath: string): Promise<McpServerInfo[]>
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
  connectClaude(): Promise<ClaudeResources>
  connectCodex(): Promise<CodexResources>
  getStartupData(): Promise<StartupData>
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
  codexRun(sessionId: string, projectPath: string, prompt: string, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, collaborationMode?: CodexCollaborationMode, threadId?: string, messageId?: string, images?: ImageAttachment[], cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] }): Promise<CodexRunResult>
  codexSteer(sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] }): Promise<void>
  codexReview(sessionId: string, projectPath: string, target: CodexReviewTarget, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] }): Promise<CodexRunResult>
  codexCompact(sessionId: string, projectPath: string, model?: string, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] }): Promise<CodexRunResult>
  codexListModels(projectPath: string, apiProviderId?: string | null, force?: boolean): Promise<ModelOption[]>
  codexPlanApproval(projectPath: string, sessionId: string, messageId: string, status: 'approved' | 'rejected', feedback?: string): Promise<void>
  codexCollaborationModeChange(projectPath: string, sessionId: string, mode: string): Promise<void>
  codexGetAuthStatus(projectPath: string): Promise<CodexAuthStatus>
  codexSetAuth(projectPath: string, request: CodexSetAuthRequest): Promise<CodexAuthStatus>
  installUpdate(): Promise<void>
  checkForUpdates(): Promise<void>
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
  cacheRemoteImage(url: string): Promise<string | null>
  addMarketplace(source: string, scope: ResourceScope, projectPath: string): Promise<void>
  removeMarketplace(name: string, scope: MarketplaceScope, projectPath: string): Promise<void>
  readMarketplacePlugin(marketplace: string, name: string): Promise<MarketplacePluginDetail | null>
  readMarketplacePluginFile(marketplace: string, name: string, relativePath: string): Promise<string | null>

  // Agents
  listAgents(projectPath: string): Promise<(AgentInfo & { scope: 'user' | 'project' })[]>
  readAgentFile(projectPath: string, name: string): Promise<string | null>

  // Skills
  listSkills(projectPath: string): Promise<SkillInfo[]>
  readSkill(projectPath: string, name: string): Promise<SkillDetail | null>
  readSkillFile(projectPath: string, skillName: string, relativePath: string): Promise<string | null>
  installSkill(sourcePath: string): Promise<SkillInfo>
  deleteSkill(projectPath: string, name: string, scope: ResourceScope): Promise<void>
  toggleSkill(name: string, disabled: boolean): Promise<string[]>

  // Codex Skills
  codexListSkills(projectPath: string): Promise<SkillInfo[]>
  codexReadSkill(projectPath: string, name: string): Promise<SkillDetail | null>
  codexReadSkillFile(projectPath: string, skillName: string, relativePath: string): Promise<string | null>
  codexDeleteSkill(projectPath: string, name: string, scope: ResourceScope): Promise<void>

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
  checkMcpServers(projectPath: string): Promise<McpCheckResult>
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

  // Providers
  listProviders(): Promise<ApiProvider[]>
  createProvider(data: CreateProviderRequest): Promise<ApiProvider>
  updateProvider(id: string, data: UpdateProviderRequest): Promise<ApiProvider | undefined>
  deleteProvider(id: string): Promise<boolean>
  activateProvider(id: string, agentType: string): Promise<boolean>
  deactivateAllProviders(agentType: string): Promise<void>
  testProvider(data: { api_key: string; base_url: string; extra_env: string; provider_id?: string }): Promise<{ success: boolean; models: number; error?: string }>
  testCodexProvider(data: { api_key: string; base_url: string; extra_env: string; name?: string; model?: string; provider_id?: string }): Promise<{ success: boolean; models: number; error?: string }>
  onTestCodexProgress(callback: (progress: CodexProviderTestProgress) => void): () => void

  // File operations
  moveFile(folderPath: string, srcRelPath: string, destDirRelPath: string): Promise<FileOpResult>
  copyFilesIn(folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult>
  moveFilesIn(folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult>
  deleteFile(folderPath: string, relPath: string): Promise<FileOpResult>
  renameFile(folderPath: string, relPath: string, newName: string): Promise<FileOpResult>
  saveFile(folderPath: string, filePath: string, content: string): Promise<FileOpResult>
  readFileAsDataUri(absPath: string): Promise<{ ok: true; dataUri: string } | { ok: false; error: string }>
  saveFileAs(
    sourcePath: string,
    defaultName: string,
  ): Promise<{ ok: true; savedPath: string } | { ok: false; canceled?: boolean; error?: string }>
  showInFolder(folderPath: string, relPath: string): Promise<void>
  openExternalLink(url: string): Promise<void>
  clipboardRead(): Promise<string>
  clipboardWrite(text: string): Promise<void>
  clipboardWriteImage(absPath: string): Promise<{ ok: true } | { ok: false; error: string }>
  revealFile(absPath: string): Promise<void>
  getPathForFile(file: File): string
  startDrag(paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }): void
  pathStat(path: string): Promise<{ isFile: boolean; isDirectory: boolean } | null>

  // File watcher
  startFileWatch(folderPath: string): Promise<void>
  stopFileWatch(): Promise<void>
  onFileChangeEvent(callback: (event: { folderPath: string }) => void): () => void
  onGitHeadChange(callback: (event: { folderPath: string }) => void): () => void
  onSessionChanged(callback: () => void): () => void

  // Bash output watcher
  watchBashOutput(toolUseId: string, filePath: string, tailLines?: number): Promise<void>
  unwatchBashOutput(toolUseId: string): Promise<void>
  readBashOutputMore(toolUseId: string, tailLines: number): Promise<string>
  readBashOutputFile(filePath: string, tailLines: number): Promise<string>
  onBashOutputEvent(callback: (event: BashOutputEvent) => void): () => void

  // Settings
  getProjectPreferences(projectPath: string): Promise<ClaudePreferences>
  saveProjectPreferences(projectPath: string, preferences: Partial<ClaudePreferences>): Promise<ClaudePreferences>
  setFastMode(enabled: boolean): Promise<void>
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(patch: AppSettingsPatch): Promise<AppSettings>
  onAppSettingsChange(callback: (settings: AppSettings) => void): () => void
  getSystemLocale(): Promise<string>
  onLocaleChanged(callback: (locale: Locale) => void): () => void

  // Logging
  getLogPath(): Promise<string>

  // Usage statistics
  queryUsage(range?: { from?: string; to?: string }): Promise<{
    rows: Array<{
      day: string
      harness: 'claude' | 'codex'
      model: string
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
    }>
  }>
  queryUsageCounts(range?: { from?: string; to?: string; harness?: 'claude' | 'codex' }): Promise<{
    sessions: number
    messages: number
  }>
  getUsageBackfillStatus(): Promise<'done' | 'pending'>
  onUsageBackfillDone(callback: (summary: { scanned: number; claudeRecorded: number; codexRecorded: number; durationMs: number }) => void): () => void

  onContentZoom(callback: (action: 'in' | 'out' | 'reset') => void): () => void

  onCloseTabShortcut(callback: () => void): () => void

  closeWindow(): void

  // Window state
  getFullscreen(): Promise<boolean>
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void
  setMinWindowSize(width: number, height: number): Promise<void>
  openSessionWindow(projectPath: string, sessionId: string, title?: string): Promise<void>
  setWindowAlwaysOnTop(value: boolean): Promise<boolean>
  getTheme(): Promise<boolean>
  setTheme(dark: boolean): Promise<void>
  onThemeChange(callback: (dark: boolean) => void): () => void

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
  handoffToLocal(worktreePath: string): Promise<WorktreeHandoffResult>
  getHandoffPreview(worktreePath: string): Promise<GitDirtyStatus | null>
  forkSessionToWorktree(request: SessionForkRequest): Promise<SessionForkResult>
  getGitStatusFiles(folderPath: string): Promise<GitStatusFile[]>
  getGitLog(folderPath: string, query?: string): Promise<GitLogEntry[]>
  getGitDiffFile(folderPath: string, filePath: string, staged: boolean): Promise<GitFileDiff>
  readProjectFile(folderPath: string, filePath: string): Promise<GitFileContent>
  getFileTree(folderPath: string): Promise<FileTreeEntry[]>
  listDir(folderPath: string, dirRelPath: string): Promise<FileTreeEntry[]>

  // Session history
  listSessions(projectPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolder(folderPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolderPage(folderPath: string, limit: number, offset: number): Promise<SessionHistoryEntry[]>
  resumeSession(projectPath: string, sessionId: string, worktreeCwd?: string, permissionMode?: PermissionMode): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined>
  loadSessionMessages(projectPath: string, sessionId: string, limit: number, cursor?: number): Promise<LoadSessionMessagesResult>
  renameSession(sessionId: string, title: string): Promise<void>
  loadSessionState(sessionId: string): Promise<{ messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; worktreePath: string | null; provider: string } | null>
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
  startPairing(): Promise<{ channelId: string; tempKeyHex: string; relayUrl: string }>
  confirmPairing(code: string): Promise<void>
  cancelPairing(): Promise<void>
  onPairingCodeReceived(callback: (info: { code: string; deviceName: string }) => void): () => void
  onPairingExpired(callback: () => void): () => void
  onPairingAlreadyPaired(callback: (info: { deviceName: string }) => void): () => void
  onRelayStatusChanged(callback: (connected: boolean) => void): () => void
  onLanStatusChanged(callback: (active: boolean) => void): () => void

  widgetIframeReady(widgetId: string): Promise<void>

  // Automations
  listAutomations(projectPath: string): Promise<Automation[]>
  createAutomation(projectPath: string, data: CreateAutomationRequest): Promise<Automation>
  updateAutomation(id: string, data: UpdateAutomationRequest): Promise<Automation | undefined>
  deleteAutomation(id: string): Promise<boolean>
  runAutomationNow(id: string): Promise<void>
  onAutomationEvent(callback: (event: { automationId: string; status: AutomationRunStatus; sessionId?: string; error?: string }) => void): () => void
}

interface MiniAppAPI {
  list(projectDir?: string): Promise<MiniAppEntry[]>
  open(appId: string, projectDir: string, sessionId: string): Promise<void>
  close(appId: string, projectDir: string, sessionId: string): Promise<void>
  authorize(appIds: string[], projectDir: string, sessionId: string): Promise<void>
  unauthorize(appIds: string[], projectDir: string, sessionId: string): Promise<void>
  toolResult(callId: string, result: unknown, error?: string): Promise<void>
  fsRequest(projectDir: string, appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  gitRequest(projectDir: string, appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  dbRequest(appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  kvRequest(appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
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

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    terminal: TerminalAPI
    app: AppAPI
    miniapp: MiniAppAPI
  }
}
