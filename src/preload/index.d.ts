import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentEvent, AgentInfo, ChatMessage, CodexAuthStatus, CodexPermissionPreset, CodexReasoningEffort, CodexReviewTarget, CodexRunResult, CodexSetAuthRequest, ConnectResult, FileTreeEntry, GitFileContent, GitFileDiff, GitInfo, GitResult, GitStatusFile, ImageAttachment, ListDirEntry, LoadSessionMessagesResult, MarketplacePlugin, McpCheckResult, McpLibraryEntry, McpServerConfig, McpServerInfo, ModelOption, PermissionMode, PinnedSessionEntry, PluginDetail, PluginInfo, RecentFolder, ResourceScope, RewindFilesResult, SandboxInfo, SandboxMode, SendMessageRequest, SessionHistoryEntry, SetupEvent, SkillDetail, SkillInfo, StartupData, UpdateEvent, WorktreeInfo } from '../shared/agent-types'


interface AgentAPI {
  sendMessage(projectPath: string, request: SendMessageRequest): Promise<void>
  interrupt(projectPath: string): Promise<boolean>
  respondToPermission(projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): Promise<void>
  setPermissionMode(projectPath: string, mode: PermissionMode): Promise<void>
  setSandboxMode(projectPath: string, mode: SandboxMode): Promise<SandboxInfo>
  answerQuestion(projectPath: string, requestId: string, answers: Record<string, string>): Promise<void>
  dismissQuestion(projectPath: string, requestId: string): Promise<void>
  respondToPlanApproval(projectPath: string, requestId: string, approved: boolean, feedback?: string): Promise<void>
  resetSession(projectPath: string): Promise<void>
  parkSession(projectPath: string): Promise<void>
  activateSession(projectPath: string, sessionId: string): Promise<void>
  rewindFiles(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  previewRewind(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  rewindCodeAndChat(projectPath: string, userMessageId: string, resumePointId: string): Promise<RewindFilesResult>
  rewindConversation(projectPath: string, userMessageId: string, resumePointId: string): Promise<RewindFilesResult>
  getSessionId(projectPath: string): Promise<string>
  getMcpServerStatus(projectPath: string): Promise<McpServerInfo[]>
  listDirectory(projectPath: string, relativePath: string): Promise<ListDirEntry[]>
  findLineNumber(projectPath: string, filePath: string, text: string): Promise<number | null>
  readProjectAdditionalDirs(projectPath: string): Promise<string[]>
  writeProjectAdditionalDirs(projectPath: string, dirs: string[]): Promise<void>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
}

interface AppAPI {
  connectClaude(): Promise<ConnectResult>
  getStartupData(): Promise<StartupData>
  selectFolder(): Promise<string | null>
  getRecentFolders(): Promise<RecentFolder[]>
  addRecentFolder(folderPath: string): Promise<boolean>
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>
  openFolder(folderPath: string): Promise<boolean>
  openTmpFolder(): Promise<string>
  closeProject(folderPath: string): Promise<void>
  checkClaude(): Promise<boolean>
  installClaude(): Promise<void>
  codexRun(projectPath: string, prompt: string, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string, images?: ImageAttachment[]): Promise<CodexRunResult>
  codexSteer(projectPath: string, input: string): Promise<void>
  codexReview(projectPath: string, target: CodexReviewTarget, model?: string, reasoningEffort?: CodexReasoningEffort, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string): Promise<CodexRunResult>
  codexCompact(projectPath: string, model?: string, permissionPreset?: CodexPermissionPreset, threadId?: string, messageId?: string): Promise<CodexRunResult>
  codexListModels(projectPath: string): Promise<ModelOption[]>
  codexReset(projectPath: string): Promise<void>
  codexInterrupt(projectPath: string): Promise<boolean>
  codexRespondToPermission(projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string): Promise<boolean>
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

  // File watcher
  startFileWatch(folderPath: string): Promise<void>
  stopFileWatch(): Promise<void>
  onFileChangeEvent(callback: (event: { folderPath: string }) => void): () => void
  onGitHeadChange(callback: (event: { folderPath: string }) => void): () => void
  onSessionChanged(callback: () => void): () => void

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
  getWorktreeInfo(folderPath: string): Promise<WorktreeInfo | null>
  activateWorktree(folderPath: string, baseBranch: string | null, carryLocalChanges?: boolean): Promise<{ ok: true; path: string } | { ok: false; error: string }>
  getGitStatusFiles(folderPath: string): Promise<GitStatusFile[]>
  getGitDiffFile(folderPath: string, filePath: string, staged: boolean): Promise<GitFileDiff>
  getGitReadFile(folderPath: string, filePath: string): Promise<GitFileContent>
  getFileTree(folderPath: string): Promise<FileTreeEntry[]>
  listDir(folderPath: string, dirRelPath: string): Promise<FileTreeEntry[]>

  // Session history
  listSessions(projectPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolder(folderPath: string): Promise<SessionHistoryEntry[]>
  resumeSession(projectPath: string, sessionId: string, worktreeCwd?: string): Promise<void>
  loadSessionMessages(projectPath: string, sessionId: string, limit: number, cursor?: number): Promise<LoadSessionMessagesResult>
  renameSession(sessionId: string, title: string): Promise<void>
  createSession(projectPath: string, claudeSessionId: string, isWorktree?: boolean, gitBranch?: string, worktreePath?: string): Promise<void>
  saveSessionState(claudeSessionId: string, data: { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string }): Promise<void>
  loadSessionState(claudeSessionId: string): Promise<{ messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; isWorktree: boolean; gitBranch: string | null; worktreePath: string | null; provider: string } | null>
  deleteSession(sessionId: string): Promise<void>
  pinSession(sessionId: string, pinned: boolean): Promise<void>
  listPinnedSessions(): Promise<PinnedSessionEntry[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    app: AppAPI
  }
}
