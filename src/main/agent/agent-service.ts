import { ipcMain, type BrowserWindow } from 'electron'
import { ClaudeAgent, type ClaudeAgentConfig } from './claude-agent'
import { AgentIpcChannels, type AgentEvent, type PermissionMode, type SendMessageRequest } from '../../shared/agent-types'

export class AgentService {
  private claude = new ClaudeAgent()
  private mainWindow: BrowserWindow | null = null

  setup(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    ipcMain.handle(AgentIpcChannels.SEND_MESSAGE, async (_event, request: SendMessageRequest) => {
      if (!this.claude.isReady()) throw new Error('Agent not initialized')
      await this.claude.sendMessage(request)
    })

    ipcMain.handle(AgentIpcChannels.INTERRUPT, async () => {
      await this.claude.interrupt()
    })

    ipcMain.handle(AgentIpcChannels.AVAILABLE_MODELS, async () => {
      return this.claude.getAvailableModels()
    })

    ipcMain.handle(AgentIpcChannels.PERMISSION_RESPONSE, (_event, requestId: string, allow: boolean, alwaysAllow?: boolean) => {
      this.claude.respondToPermission(requestId, allow, alwaysAllow)
    })

    ipcMain.handle(AgentIpcChannels.SET_PERMISSION_MODE, async (_event, mode: PermissionMode) => {
      await this.claude.setPermissionMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.ANSWER_QUESTION, (_event, requestId: string, answers: Record<string, string>) => {
      this.claude.respondToQuestion(requestId, answers)
    })

    ipcMain.handle(AgentIpcChannels.DISMISS_QUESTION, (_event, requestId: string) => {
      this.claude.dismissQuestion(requestId)
    })

    ipcMain.handle(AgentIpcChannels.RESET_SESSION, async () => {
      await this.claude.resetSession()
    })

    ipcMain.handle(AgentIpcChannels.REWIND_FILES, async (_event, userMessageId: string) => {
      return this.claude.rewindFiles(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.GET_SESSION_ID, () => {
      return this.claude.getSessionId()
    })

    ipcMain.handle(AgentIpcChannels.MCP_SERVER_STATUS, async () => {
      return this.claude.getMcpServerStatus()
    })

    ipcMain.handle(AgentIpcChannels.ACCOUNT_INFO, async () => {
      return this.claude.getAccountInfo()
    })

    ipcMain.handle(AgentIpcChannels.SLASH_COMMANDS, async () => {
      return this.claude.getSlashCommands()
    })

    ipcMain.handle(AgentIpcChannels.LIST_DIRECTORY, async (_event, relativePath: string) => {
      return this.claude.listDirectory(relativePath)
    })

    ipcMain.handle(AgentIpcChannels.LIST_AGENTS, async () => {
      return this.claude.getAgents()
    })

    ipcMain.handle(AgentIpcChannels.FIND_LINE_NUMBER, async (_event, filePath: string, text: string) => {
      return this.claude.findLineNumber(filePath, text)
    })
  }

  async initialize(config: ClaudeAgentConfig): Promise<void> {
    await this.claude.initialize(config, (event: AgentEvent) => {
      this.mainWindow?.webContents.send(AgentIpcChannels.EVENT, event)
    })
  }

  async openFolder(cwd: string): Promise<void> {
    await this.claude.dispose()
    await this.claude.initialize({ cwd }, (event: AgentEvent) => {
      this.mainWindow?.webContents.send(AgentIpcChannels.EVENT, event)
    })
  }

  async dispose(): Promise<void> {
    await this.claude.dispose()

    ipcMain.removeHandler(AgentIpcChannels.SEND_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.INTERRUPT)
    ipcMain.removeHandler(AgentIpcChannels.AVAILABLE_MODELS)
    ipcMain.removeHandler(AgentIpcChannels.PERMISSION_RESPONSE)
    ipcMain.removeHandler(AgentIpcChannels.SET_PERMISSION_MODE)
    ipcMain.removeHandler(AgentIpcChannels.ANSWER_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.DISMISS_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.RESET_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_FILES)
    ipcMain.removeHandler(AgentIpcChannels.GET_SESSION_ID)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SERVER_STATUS)
    ipcMain.removeHandler(AgentIpcChannels.ACCOUNT_INFO)
    ipcMain.removeHandler(AgentIpcChannels.SLASH_COMMANDS)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY)
    ipcMain.removeHandler(AgentIpcChannels.LIST_AGENTS)
    ipcMain.removeHandler(AgentIpcChannels.FIND_LINE_NUMBER)
  }
}
