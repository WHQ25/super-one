import { ipcMain, type BrowserWindow } from 'electron'
import { ClaudeAgent, type ClaudeAgentConfig } from './claude-agent'
import { AgentIpcChannels, type AgentEvent, type PermissionMode, type ResourceScope, type SendMessageRequest } from '../../shared/agent-types'
import { listSessions, loadSessionMessages, clearSessionMessageCache } from '../session-history'
import { setSessionTitle } from '../session-titles'
import { listMcpConfigs, saveMcpConfig, deleteMcpConfig, toggleMcpConfig } from '../mcp-config-service'
import { probeMcpServers, getCachedMcpMeta } from '../mcp-probe-service'
import { authorizeHttpMcpServer } from '../mcp-oauth'
import { listSkills, readSkillContent, readSkillFile, installSkill, deleteSkill } from '../skills-service'
import { listPlugins, readPluginContent, readPluginFile, deletePlugin, listMarketplacePlugins, installPlugin, updatePlugin, updateMarketplace } from '../plugins-service'
import { backupMcpServers, listLibrary, deleteLibraryEntry } from '../mcp-library-service'

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

    ipcMain.handle(AgentIpcChannels.RESPOND_PLAN_APPROVAL, (_event, requestId: string, approved: boolean, feedback?: string) => {
      this.claude.respondToPlanApproval(requestId, approved, feedback)
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

    // Plugins
    ipcMain.handle(AgentIpcChannels.PLUGINS_LIST, () => {
      return listPlugins(this.claude.getCwd())
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ, (_event, key: string) => {
      return readPluginContent(this.claude.getCwd(), key)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ_FILE, (_event, key: string, relativePath: string) => {
      return readPluginFile(this.claude.getCwd(), key, relativePath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_DELETE, (_event, key: string, scope: ResourceScope) => {
      deletePlugin(key, scope, this.claude.getCwd())
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE, () => {
      return listMarketplacePlugins(this.claude.getCwd())
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_INSTALL, async (_event, key: string, scope: ResourceScope) => {
      await installPlugin(key, scope, this.claude.getCwd())
      try { await this.claude.refreshSession() } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE, async (_event, updates: Array<{ key: string; scope: ResourceScope }>) => {
      const cwd = this.claude.getCwd()
      for (const { key, scope } of updates) {
        updatePlugin(key, scope, cwd)
      }
      try { await this.claude.refreshSession() } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE, async (_event, name: string) => {
      await updateMarketplace(name)
    })

    // Skills
    ipcMain.handle(AgentIpcChannels.SKILLS_LIST, () => {
      return listSkills(this.claude.getCwd())
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_READ, (_event, name: string) => {
      return readSkillContent(this.claude.getCwd(), name)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_READ_FILE, (_event, skillName: string, relativePath: string) => {
      return readSkillFile(this.claude.getCwd(), skillName, relativePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_INSTALL, (_event, sourcePath: string) => {
      return installSkill(sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_DELETE, (_event, name: string, scope: ResourceScope) => {
      deleteSkill(name, scope, this.claude.getCwd())
    })

    // MCP config
    ipcMain.handle(AgentIpcChannels.MCP_LIST_CONFIG, () => {
      return listMcpConfigs(this.claude.getCwd())
    })

    ipcMain.handle(AgentIpcChannels.MCP_SAVE_CONFIG, async (_event, name: string, config: Record<string, unknown>, scope: ResourceScope) => {
      saveMcpConfig(name, config, scope, this.claude.getCwd())
      try {
        await this.claude.reconnectMcpServer(name)
        await this.claude.refreshSession()
      } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, name: string, scope: ResourceScope) => {
      deleteMcpConfig(name, scope, this.claude.getCwd())
      try {
        await this.claude.toggleMcpServer(name, false)
        await this.claude.refreshSession()
      } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.MCP_TOGGLE_CONFIG, async (_event, name: string, disabled: boolean, scope: ResourceScope) => {
      toggleMcpConfig(name, disabled, scope, this.claude.getCwd())
      try {
        await this.claude.toggleMcpServer(name, !disabled)
        await this.claude.refreshSession()
      } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.MCP_PROBE_SERVERS, async () => {
      const configs = listMcpConfigs(this.claude.getCwd())
      const meta = await probeMcpServers(configs)
      // Auto-backup successfully probed servers to library
      try { backupMcpServers(configs, meta) } catch { /* ignore */ }
      return meta
    })

    ipcMain.handle(AgentIpcChannels.MCP_RECONNECT_SERVER, async (_event, serverName: string) => {
      try {
        await this.claude.reconnectMcpServer(serverName)
      } catch {
        // Session may not be active
      }
    })

    ipcMain.handle(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, async (_event, serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') => {
      return authorizeHttpMcpServer(serverUrl, headers, transport)
    })

    // MCP library
    ipcMain.handle(AgentIpcChannels.MCP_LIST_LIBRARY, () => {
      return listLibrary()
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, (_event, name: string) => {
      deleteLibraryEntry(name)
    })

    // Session history
    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST, () => {
      return listSessions(this.claude.getCwd())
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RESUME, async (_event, sessionId: string) => {
      clearSessionMessageCache()
      await this.claude.resumeSession(sessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, (_event, sessionId: string, limit: number, cursor?: number) => {
      return loadSessionMessages(this.claude.getCwd(), sessionId, limit, cursor)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RENAME, (_event, sessionId: string, title: string) => {
      setSessionTitle(sessionId, title)
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
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_READ)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_UPDATE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_READ)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SAVE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_TOGGLE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_PROBE_SERVERS)
    ipcMain.removeHandler(AgentIpcChannels.MCP_RECONNECT_SERVER)
    ipcMain.removeHandler(AgentIpcChannels.MCP_OAUTH_AUTHORIZE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_LIBRARY)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RESUME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_MESSAGES)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RENAME)
  }
}
