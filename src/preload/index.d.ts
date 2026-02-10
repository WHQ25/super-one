import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AccountInfo, AgentEvent, AgentInfo, ListDirEntry, McpServerInfo, ModelOption, PermissionMode, RecentFolder, RewindFilesResult, SendMessageRequest, SetupEvent, SlashCommandInfo } from '../shared/agent-types'

interface AgentAPI {
  sendMessage(request: SendMessageRequest): Promise<void>
  interrupt(): Promise<void>
  getAvailableModels(): Promise<ModelOption[]>
  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  answerQuestion(requestId: string, answers: Record<string, string>): Promise<void>
  dismissQuestion(requestId: string): Promise<void>
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
}

declare global {
  interface Window {
    electron: ElectronAPI
    agent: AgentAPI
    app: AppAPI
  }
}
