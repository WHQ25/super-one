import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AccountInfo, AgentEvent, AgentInfo, ChatMessage, ListDirEntry, LoadSessionMessagesResult, MarketplacePlugin, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, ModelOption, PermissionMode, PluginDetail, PluginInfo, RecentFolder, ResourceScope, RewindFilesResult, SendMessageRequest, SessionHistoryEntry, SetupEvent, SkillDetail, SkillInfo, SlashCommandInfo } from '../shared/agent-types'


interface AgentAPI {
  sendMessage(projectPath: string, request: SendMessageRequest): Promise<void>
  interrupt(projectPath: string): Promise<void>
  getAvailableModels(projectPath: string): Promise<ModelOption[]>
  respondToPermission(projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean): Promise<void>
  setPermissionMode(projectPath: string, mode: PermissionMode): Promise<void>
  answerQuestion(projectPath: string, requestId: string, answers: Record<string, string>): Promise<void>
  dismissQuestion(projectPath: string, requestId: string): Promise<void>
  respondToPlanApproval(projectPath: string, requestId: string, approved: boolean, feedback?: string): Promise<void>
  resetSession(projectPath: string): Promise<void>
  parkSession(projectPath: string): Promise<void>
  activateSession(projectPath: string, sessionId: string): Promise<void>
  rewindFiles(projectPath: string, userMessageId: string): Promise<RewindFilesResult>
  getSessionId(projectPath: string): Promise<string>
  getMcpServerStatus(projectPath: string): Promise<McpServerInfo[]>
  getAccountInfo(projectPath: string): Promise<AccountInfo>
  getSlashCommands(projectPath: string): Promise<SlashCommandInfo[]>
  listDirectory(projectPath: string, relativePath: string): Promise<ListDirEntry[]>
  listAgents(projectPath: string): Promise<AgentInfo[]>
  findLineNumber(projectPath: string, filePath: string, text: string): Promise<number | null>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
}

interface AppAPI {
  selectFolder(): Promise<string | null>
  getRecentFolders(): Promise<RecentFolder[]>
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>
  openFolder(folderPath: string): Promise<boolean>
  openTmpFolder(): Promise<string>
  closeProject(folderPath: string): Promise<void>
  checkClaude(): Promise<boolean>
  installClaude(): Promise<void>
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

  // Skills
  listSkills(projectPath: string): Promise<SkillInfo[]>
  readSkill(projectPath: string, name: string): Promise<SkillDetail | null>
  readSkillFile(projectPath: string, skillName: string, relativePath: string): Promise<string | null>
  installSkill(sourcePath: string): Promise<SkillInfo>
  deleteSkill(projectPath: string, name: string, scope: ResourceScope): Promise<void>

  // MCP config
  listMcpConfigs(projectPath: string): Promise<McpServerConfig[]>
  saveMcpConfig(projectPath: string, name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope): Promise<void>
  deleteMcpConfig(projectPath: string, name: string, scope: ResourceScope): Promise<void>
  toggleMcpConfig(projectPath: string, name: string, disabled: boolean, scope: ResourceScope): Promise<void>
  probeMcpServers(projectPath: string): Promise<Record<string, McpServerMeta>>
  reconnectMcpServer(projectPath: string, serverName: string): Promise<void>
  oauthAuthorize(serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse'): Promise<Record<string, string>>

  // MCP library
  listMcpLibrary(): Promise<McpLibraryEntry[]>
  deleteMcpLibraryEntry(name: string): Promise<void>

  // Window state
  getFullscreen(): Promise<boolean>
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void

  // Session history
  listSessions(projectPath: string): Promise<SessionHistoryEntry[]>
  listSessionsForFolder(folderPath: string): Promise<SessionHistoryEntry[]>
  resumeSession(projectPath: string, sessionId: string): Promise<void>
  loadSessionMessages(projectPath: string, sessionId: string, limit: number, cursor?: number): Promise<LoadSessionMessagesResult>
  renameSession(sessionId: string, title: string): Promise<void>
  createSession(projectPath: string, claudeSessionId: string): Promise<void>
  saveSessionState(claudeSessionId: string, data: { messages: ChatMessage[]; totalCostUsd: number; contextTokens: number; title?: string }): Promise<void>
  loadSessionState(claudeSessionId: string): Promise<{ messages: ChatMessage[]; totalCostUsd: number; contextTokens: number } | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    app: AppAPI
  }
}
