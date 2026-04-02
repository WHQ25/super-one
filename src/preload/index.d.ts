import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentEvent, AgentInfo, ApiProvider, BashOutputEvent, ChatMessage, ClaudePreferences, CodexAuthStatus, CodexCollaborationMode, CodexPermissionPreset, CodexReasoningEffort, CodexReviewTarget, CodexRunResult, CodexSetAuthRequest, ConnectResult, ContextUsageInfo, CreateProviderRequest, FileOpResult, FileSearchResult, FileTreeEntry, GitFileContent, GitFileDiff, GitInfo, GitLogEntry, GitResult, GitStatusFile, ImageAttachment, ListDirEntry, LoadSessionMessagesResult, MarketplacePlugin, McpCheckResult, McpLibraryEntry, McpServerConfig, McpServerInfo, MentionSearchItem, ModelOption, PermissionMode, PinnedSessionEntry, PluginDetail, PluginInfo, QuestionAnnotations, RecentFolder, ResourceScope, RewindFilesResult, SandboxInfo, SandboxMode, SendMessageRequest, SessionHistoryEntry, SetupEvent, SkillDetail, SkillInfo, StartupData, UpdateEvent, UpdateProviderRequest, WorktreeInfo } from '../shared/agent-types'
import type { MiniAppEntry, MiniAppToolCallRequest } from '../shared/miniapp-types'


interface AgentAPI {
  sendMessage(projectPath: string, request: SendMessageRequest): Promise<void>
  dequeueMessage(projectPath: string, clientMessageId: string): Promise<boolean>
  interrupt(projectPath: string): Promise<boolean>
  respondToPermission(projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): Promise<void>
  setPermissionMode(projectPath: string, mode: PermissionMode): Promise<void>
  setSandboxMode(projectPath: string, mode: SandboxMode): Promise<SandboxInfo>
  answerQuestion(projectPath: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): Promise<void>
  dismissQuestion(projectPath: string, requestId: string): Promise<void>
  respondToPlanApproval(projectPath: string, requestId: string, approved: boolean, feedback?: string): Promise<void>
  resetSession(projectPath: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo }>
  parkSession(projectPath: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo }>
  parkDraftSession(projectPath: string, draftSessionId: string, newDraftSessionId: string): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo }>
  activateSession(projectPath: string, sessionId: string): Promise<void>
  rewindFiles(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  previewRewind(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  rewindCodeAndChat(projectPath: string, userMessageId: string, resumePointId: string): Promise<RewindFilesResult>
  rewindConversation(projectPath: string, userMessageId: string, resumePointId: string): Promise<RewindFilesResult>
  getSessionId(projectPath: string): Promise<string>
  getMcpServerStatus(projectPath: string): Promise<McpServerInfo[]>
  getContextUsage(projectPath: string): Promise<ContextUsageInfo | null>
  reloadPlugins(projectPath: string): Promise<boolean>
  listDirectory(projectPath: string, relativePath: string): Promise<ListDirEntry[]>
  findLineNumber(projectPath: string, filePath: string, text: string): Promise<number | null>
  searchFiles(projectPath: string, query: string, additionalDirs?: string[]): Promise<FileSearchResult[]>
  searchMentions(projectPath: string, query: string, agents: { name: string; model: string }[], additionalDirs?: string[], scopeDir?: string): Promise<MentionSearchItem[]>
  disconnectRemoteSession(): Promise<void>
  readProjectAdditionalDirs(projectPath: string): Promise<string[]>
  writeProjectAdditionalDirs(projectPath: string, dirs: string[]): Promise<void>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
}

interface AppAPI {
  platform: NodeJS.Platform
  connectClaude(): Promise<ConnectResult>
  getStartupData(): Promise<StartupData>
  selectFolder(defaultPath?: string): Promise<string | null>
  getRecentFolders(): Promise<RecentFolder[]>
  getMediaServerPort(): Promise<number>
  addRecentFolder(folderPath: string): Promise<boolean>
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>
  openFolder(folderPath: string): Promise<boolean>
  openTmpFolder(): Promise<string>
  closeProject(folderPath: string): Promise<void>
  checkClaude(): Promise<boolean>
  installClaude(): Promise<void>
  codexRun(sessionId: string, projectPath: string, prompt: string, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, collaborationMode?: CodexCollaborationMode, threadId?: string, messageId?: string, images?: ImageAttachment[], cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string): Promise<CodexRunResult>
  codexSteer(sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string): Promise<void>
  codexReview(sessionId: string, projectPath: string, target: CodexReviewTarget, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string): Promise<CodexRunResult>
  codexCompact(sessionId: string, projectPath: string, model?: string, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, cwd?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string): Promise<CodexRunResult>
  codexListModels(projectPath: string): Promise<ModelOption[]>
  codexReset(sessionId: string): Promise<void>
  codexInterrupt(sessionId: string): Promise<boolean>
  codexRespondToPermission(sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, decision?: 'cancel'): Promise<boolean>
  codexAnswerQuestion(sessionId: string, requestId: string, answers: Record<string, string>): Promise<boolean>
  codexDismissQuestion(sessionId: string, requestId: string): Promise<boolean>
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

  // Agents
  listAgents(projectPath: string): Promise<(AgentInfo & { scope: 'user' | 'project' })[]>
  readAgentFile(projectPath: string, name: string): Promise<string | null>

  // Skills
  listSkills(projectPath: string): Promise<SkillInfo[]>
  readSkill(projectPath: string, name: string): Promise<SkillDetail | null>
  readSkillFile(projectPath: string, skillName: string, relativePath: string): Promise<string | null>
  installSkill(sourcePath: string): Promise<SkillInfo>
  deleteSkill(projectPath: string, name: string, scope: ResourceScope): Promise<void>

  // Codex Skills
  codexListSkills(projectPath: string): Promise<SkillInfo[]>
  codexReadSkill(projectPath: string, name: string): Promise<SkillDetail | null>
  codexReadSkillFile(projectPath: string, skillName: string, relativePath: string): Promise<string | null>
  codexDeleteSkill(projectPath: string, name: string, scope: ResourceScope): Promise<void>

  // Codex MCP config
  codexListMcpConfigs(projectPath: string): Promise<McpServerConfig[]>

  // MCP config
  listMcpConfigs(projectPath: string): Promise<McpServerConfig[]>
  saveMcpConfig(projectPath: string, name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope): Promise<void>
  deleteMcpConfig(projectPath: string, name: string, scope: ResourceScope): Promise<void>
  toggleMcpConfig(projectPath: string, name: string, disabled: boolean, scope: ResourceScope): Promise<void>
  checkMcpServers(projectPath: string): Promise<McpCheckResult>
  oauthAuthorize(serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse'): Promise<Record<string, string>>

  // MCP library
  listMcpLibrary(): Promise<McpLibraryEntry[]>
  deleteMcpLibraryEntry(name: string): Promise<void>

  // Providers
  listProviders(): Promise<ApiProvider[]>
  createProvider(data: CreateProviderRequest): Promise<ApiProvider>
  updateProvider(id: string, data: UpdateProviderRequest): Promise<ApiProvider | undefined>
  deleteProvider(id: string): Promise<boolean>
  activateProvider(id: string, agentType: string): Promise<boolean>
  deactivateAllProviders(agentType: string): Promise<void>
  testProvider(data: { api_key: string; base_url: string; extra_env: string }): Promise<{ success: boolean; models: number; error?: string }>

  // File operations
  moveFile(folderPath: string, srcRelPath: string, destDirRelPath: string): Promise<FileOpResult>
  copyFilesIn(folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult>
  moveFilesIn(folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult>
  deleteFile(folderPath: string, relPath: string): Promise<FileOpResult>
  renameFile(folderPath: string, relPath: string, newName: string): Promise<FileOpResult>
  showInFolder(folderPath: string, relPath: string): Promise<void>
  getPathForFile(file: File): string

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
  getUserPreferences(): Promise<ClaudePreferences>
  saveUserPreferences(preferences: Partial<ClaudePreferences>): Promise<ClaudePreferences>
  getProjectPreferences(projectPath: string): Promise<ClaudePreferences>
  saveProjectPreferences(projectPath: string, preferences: Partial<ClaudePreferences>): Promise<ClaudePreferences>
  setFastMode(enabled: boolean): Promise<void>

  // Logging
  getLogPath(): Promise<string>

  // Window state
  getFullscreen(): Promise<boolean>
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void

  // Git
  getGitInfo(folderPath: string): Promise<GitInfo | null>
  getGitBranches(folderPath: string): Promise<string[]>
  switchGitBranch(folderPath: string, branch: string): Promise<GitResult>
  createBranch(folderPath: string, branch: string): Promise<GitResult>
  pathExists(p: string): Promise<boolean>
  getWorktreeInfo(folderPath: string): Promise<WorktreeInfo | null>
  activateWorktree(folderPath: string, baseBranch: string | null, carryLocalChanges?: boolean): Promise<{ ok: true; path: string } | { ok: false; error: string }>
  getGitStatusFiles(folderPath: string): Promise<GitStatusFile[]>
  getGitLog(folderPath: string, query?: string): Promise<GitLogEntry[]>
  getGitDiffFile(folderPath: string, filePath: string, staged: boolean): Promise<GitFileDiff>
  getGitReadFile(folderPath: string, filePath: string): Promise<GitFileContent>
  getFileTree(folderPath: string): Promise<FileTreeEntry[]>
  listDir(folderPath: string, dirRelPath: string): Promise<FileTreeEntry[]>

  // Session history
  listSessions(projectPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolder(folderPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolderPage(folderPath: string, limit: number, offset: number): Promise<SessionHistoryEntry[]>
  resumeSession(projectPath: string, sessionId: string, worktreeCwd?: string): Promise<void>
  loadSessionMessages(projectPath: string, sessionId: string, limit: number, cursor?: number): Promise<LoadSessionMessagesResult>
  renameSession(sessionId: string, title: string): Promise<void>
  createSession(projectPath: string, claudeSessionId: string, isWorktree?: boolean, gitBranch?: string, worktreePath?: string, title?: string): Promise<void>
  saveSessionState(claudeSessionId: string, data: { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string }): Promise<void>
  loadSessionState(claudeSessionId: string): Promise<{ messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; worktreePath: string | null; provider: string } | null>
  deleteSession(sessionId: string): Promise<void>
  deleteSessionsOlderThan(folderPath: string, cutoffDate: string): Promise<string[]>
  pinSession(sessionId: string, pinned: boolean): Promise<void>
  hideSession(sessionId: string, hidden: boolean): Promise<void>
  listPinnedSessions(): Promise<PinnedSessionEntry[]>

  trace(source: string, type: string, data: unknown, tag?: string): void

  // Remote control
  getRemoteConfig(): Promise<{ masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean; relayUrl: string } | null>
  saveRemoteConfig(config: { masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean; relayUrl: string }): Promise<void>
  onRecentFoldersChanged(callback: (folders: unknown[]) => void): () => void
  onRemoteCommand(callback: (command: unknown) => void): () => void
  onClientRegistered(callback: (info: { deviceName: string }) => void): () => void
  listPairedDevices(): Promise<import('../shared/agent-types').PairedDevice[]>
  removePairedDevice(id: string): Promise<void>
  onDeviceStatusChanged(callback: (device: { id: string; online: boolean }) => void): () => void
  startPairing(): Promise<{ channelId: string; tempKeyHex: string; relayUrl: string }>
  confirmPairing(code: string): Promise<void>
  cancelPairing(): Promise<void>
  onPairingCodeReceived(callback: (info: { code: string; deviceName: string }) => void): () => void
  onPairingExpired(callback: () => void): () => void
  onPairingAlreadyPaired(callback: (info: { deviceName: string }) => void): () => void

  widgetIframeReady(widgetId: string): Promise<void>
}

interface MiniAppAPI {
  list(): Promise<MiniAppEntry[]>
  open(appId: string, projectDir: string): Promise<void>
  close(appId: string): Promise<void>
  toolResult(callId: string, result: unknown, error?: string): Promise<void>
  fsRequest(appId: string, op: string, args: Record<string, unknown>): Promise<unknown>
  iframeReady(appId: string): Promise<void>
  onToolCall(callback: (call: MiniAppToolCallRequest) => void): () => void
  getPreloadPath(): Promise<string>
  detectDev(projectDir: string): Promise<MiniAppEntry | null>
  onDevAppReady(callback: (projectDir: string) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    app: AppAPI
    miniapp: MiniAppAPI
  }
}
