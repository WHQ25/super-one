import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AccountInfo, AgentEvent, AgentInfo, ListDirEntry, LoadSessionMessagesResult, MarketplacePlugin, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, ModelOption, PermissionMode, PluginDetail, PluginInfo, RecentFolder, ResourceScope, RewindFilesResult, SendMessageRequest, SessionHistoryEntry, SetupEvent, SkillDetail, SkillInfo, SlashCommandInfo } from '../shared/agent-types'


interface AgentAPI {
  sendMessage(request: SendMessageRequest): Promise<void>
  interrupt(): Promise<void>
  getAvailableModels(): Promise<ModelOption[]>
  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  answerQuestion(requestId: string, answers: Record<string, string>): Promise<void>
  dismissQuestion(requestId: string): Promise<void>
  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): Promise<void>
  resetSession(): Promise<void>
  rewindFiles(userMessageId: string): Promise<RewindFilesResult>
  getSessionId(): Promise<string>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  getAccountInfo(): Promise<AccountInfo>
  getSlashCommands(): Promise<SlashCommandInfo[]>
  listDirectory(relativePath: string): Promise<ListDirEntry[]>
  listAgents(): Promise<AgentInfo[]>
  findLineNumber(filePath: string, text: string): Promise<number | null>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
}

interface AppAPI {
  selectFolder(): Promise<string | null>
  getRecentFolders(): Promise<RecentFolder[]>
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>
  openFolder(folderPath: string): Promise<boolean>
  checkClaude(): Promise<boolean>
  installClaude(): Promise<void>
  onSetupEvent(callback: (event: SetupEvent) => void): () => void

  // Plugins
  listPlugins(): Promise<PluginInfo[]>
  readPlugin(key: string): Promise<PluginDetail | null>
  readPluginFile(pluginKey: string, relativePath: string): Promise<string | null>
  deletePlugin(key: string, scope: ResourceScope): Promise<void>
  listMarketplacePlugins(): Promise<MarketplacePlugin[]>
  installPlugin(key: string, scope: ResourceScope): Promise<void>
  updatePlugins(updates: Array<{ key: string; scope: ResourceScope }>): Promise<void>
  updateMarketplace(name: string): Promise<void>

  // Skills
  listSkills(): Promise<SkillInfo[]>
  readSkill(name: string): Promise<SkillDetail | null>
  readSkillFile(skillName: string, relativePath: string): Promise<string | null>
  installSkill(sourcePath: string): Promise<SkillInfo>
  deleteSkill(name: string, scope: ResourceScope): Promise<void>

  // MCP config
  listMcpConfigs(): Promise<McpServerConfig[]>
  saveMcpConfig(name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope): Promise<void>
  deleteMcpConfig(name: string, scope: ResourceScope): Promise<void>
  toggleMcpConfig(name: string, disabled: boolean, scope: ResourceScope): Promise<void>
  probeMcpServers(): Promise<Record<string, McpServerMeta>>
  reconnectMcpServer(serverName: string): Promise<void>
  oauthAuthorize(serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse'): Promise<Record<string, string>>

  // MCP library
  listMcpLibrary(): Promise<McpLibraryEntry[]>
  deleteMcpLibraryEntry(name: string): Promise<void>

  // Session history
  listSessions(): Promise<SessionHistoryEntry[]>
  resumeSession(sessionId: string): Promise<void>
  loadSessionMessages(sessionId: string, limit: number, cursor?: number): Promise<LoadSessionMessagesResult>
  renameSession(sessionId: string, title: string): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    app: AppAPI
  }
}
