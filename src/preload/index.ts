import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels } from '../shared/agent-types'

const agentAPI = {
  sendMessage: (request: { content: string; model?: string; images?: { mimeType: string; base64: string; name: string }[] }) =>
    ipcRenderer.invoke(AgentIpcChannels.SEND_MESSAGE, request),

  interrupt: () =>
    ipcRenderer.invoke(AgentIpcChannels.INTERRUPT),

  getAvailableModels: () =>
    ipcRenderer.invoke(AgentIpcChannels.AVAILABLE_MODELS),

  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, requestId, allow, alwaysAllow),

  setPermissionMode: (mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_PERMISSION_MODE, mode),

  answerQuestion: (requestId: string, answers: Record<string, string>) =>
    ipcRenderer.invoke(AgentIpcChannels.ANSWER_QUESTION, requestId, answers),

  dismissQuestion: (requestId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DISMISS_QUESTION, requestId),

  respondToPlanApproval: (requestId: string, approved: boolean, feedback?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESPOND_PLAN_APPROVAL, requestId, approved, feedback),

  resetSession: () =>
    ipcRenderer.invoke(AgentIpcChannels.RESET_SESSION),

  rewindFiles: (userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_FILES, userMessageId),

  getSessionId: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_SESSION_ID),

  getMcpServerStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SERVER_STATUS),

  getAccountInfo: () =>
    ipcRenderer.invoke(AgentIpcChannels.ACCOUNT_INFO),

  getSlashCommands: () =>
    ipcRenderer.invoke(AgentIpcChannels.SLASH_COMMANDS),

  listDirectory: (relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_DIRECTORY, relativePath),

  listAgents: () =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_AGENTS),

  findLineNumber: (filePath: string, text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FIND_LINE_NUMBER, filePath, text),

  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: unknown): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.EVENT, handler)
    }
  },
}

const appAPI = {
  selectFolder: () =>
    ipcRenderer.invoke(AgentIpcChannels.SELECT_FOLDER),

  getRecentFolders: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_RECENT_FOLDERS),

  removeRecentFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REMOVE_RECENT_FOLDER, folderPath),

  openFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_FOLDER, folderPath),

  checkClaude: () =>
    ipcRenderer.invoke(AgentIpcChannels.SETUP_CHECK_CLAUDE),

  installClaude: () =>
    ipcRenderer.invoke(AgentIpcChannels.SETUP_INSTALL_CLAUDE),

  onSetupEvent: (callback: (event: unknown) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: unknown): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.SETUP_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.SETUP_EVENT, handler)
    }
  },

  // Plugins
  listPlugins: () =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_LIST),
  readPlugin: (key: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_READ, key),
  readPluginFile: (pluginKey: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_READ_FILE, pluginKey, relativePath),
  deletePlugin: (key: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_DELETE, key, scope),
  listMarketplacePlugins: () =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE),
  installPlugin: (key: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_INSTALL, key, scope),

  updatePlugins: (updates: Array<{ key: string; scope: string }>) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_UPDATE, updates),

  updateMarketplace: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE, name),

  // Skills
  listSkills: () =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_LIST),
  readSkill: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_READ, name),
  readSkillFile: (skillName: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_READ_FILE, skillName, relativePath),
  installSkill: (sourcePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_INSTALL, sourcePath),
  deleteSkill: (name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_DELETE, name, scope),

  // MCP config
  listMcpConfigs: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_LIST_CONFIG),
  saveMcpConfig: (name: string, config: { command: string; args: string[]; env: Record<string, string> }, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SAVE_CONFIG, name, config, scope),
  deleteMcpConfig: (name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_DELETE_CONFIG, name, scope),
  toggleMcpConfig: (name: string, disabled: boolean, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_TOGGLE_CONFIG, name, disabled, scope),
  probeMcpServers: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_PROBE_SERVERS),
  reconnectMcpServer: (serverName: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_RECONNECT_SERVER, serverName),
  oauthAuthorize: (serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, serverUrl, headers, transport),

  // MCP library
  listMcpLibrary: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_LIST_LIBRARY),
  deleteMcpLibraryEntry: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, name),

  // Session history
  listSessions: () =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST),
  resumeSession: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RESUME, sessionId),
  loadSessionMessages: (sessionId: string, limit: number, cursor?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, sessionId, limit, cursor),
  renameSession: (sessionId: string, title: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RENAME, sessionId, title),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('agent', agentAPI)
    contextBridge.exposeInMainWorld('app', appAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.agent = agentAPI
  // @ts-ignore
  window.app = appAPI
}
