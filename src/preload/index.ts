import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels, type CodexPermissionPreset, type CodexReasoningEffort, type CodexReviewTarget, type SandboxMode } from '../shared/agent-types'

const agentAPI = {
  sendMessage: (projectPath: string, request: { content: string; model?: string; images?: { mimeType: string; base64: string; name: string }[]; additionalDirs?: string[] }) =>
    ipcRenderer.invoke(AgentIpcChannels.SEND_MESSAGE, projectPath, request),

  interrupt: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.INTERRUPT, projectPath),

  respondToPermission: (projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, projectPath, requestId, allow, alwaysAllow, reason),

  setPermissionMode: (projectPath: string, mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_PERMISSION_MODE, projectPath, mode),

  setSandboxMode: (projectPath: string, mode: SandboxMode) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SANDBOX_MODE, projectPath, mode),

  answerQuestion: (projectPath: string, requestId: string, answers: Record<string, string>) =>
    ipcRenderer.invoke(AgentIpcChannels.ANSWER_QUESTION, projectPath, requestId, answers),

  dismissQuestion: (projectPath: string, requestId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DISMISS_QUESTION, projectPath, requestId),

  respondToPlanApproval: (projectPath: string, requestId: string, approved: boolean, feedback?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESPOND_PLAN_APPROVAL, projectPath, requestId, approved, feedback),

  resetSession: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESET_SESSION, projectPath),

  parkSession: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PARK_SESSION, projectPath),

  activateSession: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ACTIVATE_SESSION, projectPath, sessionId),

  rewindFiles: (projectPath: string, userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_FILES, projectPath, userMessageId),

  getSessionId: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GET_SESSION_ID, projectPath),

  getMcpServerStatus: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SERVER_STATUS, projectPath),

  listDirectory: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_DIRECTORY, projectPath, relativePath),

  findLineNumber: (projectPath: string, filePath: string, text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FIND_LINE_NUMBER, projectPath, filePath, text),

  readProjectAdditionalDirs: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_PROJECT_ADDITIONAL_DIRS, projectPath) as Promise<string[]>,

  writeProjectAdditionalDirs: (projectPath: string, dirs: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.WRITE_PROJECT_ADDITIONAL_DIRS, projectPath, dirs),

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
  connectClaude: () =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_CLAUDE),

  getStartupData: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_STARTUP_DATA),

  selectFolder: () =>
    ipcRenderer.invoke(AgentIpcChannels.SELECT_FOLDER),

  getRecentFolders: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_RECENT_FOLDERS),

  addRecentFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ADD_RECENT_FOLDER, folderPath),

  removeRecentFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REMOVE_RECENT_FOLDER, folderPath),

  openFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_FOLDER, folderPath),

  openTmpFolder: () =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_TMP_FOLDER) as Promise<string>,

  closeProject: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLOSE_PROJECT, folderPath),

  checkClaude: () =>
    ipcRenderer.invoke(AgentIpcChannels.SETUP_CHECK_CLAUDE),

  installClaude: () =>
    ipcRenderer.invoke(AgentIpcChannels.SETUP_INSTALL_CLAUDE),

  codexRun: (
    projectPath: string,
    prompt: string,
    model?: string,
    reasoningEffort?: CodexReasoningEffort,
    permissionPreset?: CodexPermissionPreset,
    threadId?: string,
    messageId?: string,
    images?: { mimeType: string; base64: string; name: string }[],
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_RUN,
      projectPath,
      prompt,
      model,
      reasoningEffort,
      permissionPreset,
      threadId,
      messageId,
      images,
    ),

  codexListModels: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_LIST_MODELS, projectPath),

  codexReset: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_RESET, projectPath),

  codexInterrupt: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_INTERRUPT, projectPath),

  codexRespondToPermission: (
    projectPath: string,
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_PERMISSION_RESPONSE,
      projectPath,
      requestId,
      allow,
      alwaysAllow,
      reason,
    ),

  codexSteer: (projectPath: string, input: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_STEER, projectPath, input),

  codexReview: (
    projectPath: string,
    target: CodexReviewTarget,
    model?: string,
    reasoningEffort?: CodexReasoningEffort,
    permissionPreset?: CodexPermissionPreset,
    threadId?: string,
    messageId?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_REVIEW,
      projectPath,
      target,
      model,
      reasoningEffort,
      permissionPreset,
      threadId,
      messageId,
    ),

  codexCompact: (
    projectPath: string,
    model?: string,
    permissionPreset?: CodexPermissionPreset,
    threadId?: string,
    messageId?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_COMPACT,
      projectPath,
      model,
      permissionPreset,
      threadId,
      messageId,
    ),

  codexGetAuthStatus: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GET_AUTH_STATUS, projectPath),

  codexSetAuth: (
    projectPath: string,
    request: { mode: 'auto' | 'chatgpt' | 'apiKey'; apiKey?: string }
  ) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SET_AUTH, projectPath, request),

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
  listPlugins: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_LIST, projectPath),
  readPlugin: (projectPath: string, key: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_READ, projectPath, key),
  readPluginFile: (projectPath: string, pluginKey: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_READ_FILE, projectPath, pluginKey, relativePath),
  deletePlugin: (projectPath: string, key: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_DELETE, projectPath, key, scope),
  listMarketplacePlugins: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE, projectPath),
  installPlugin: (projectPath: string, key: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_INSTALL, projectPath, key, scope),

  updatePlugins: (projectPath: string, updates: Array<{ key: string; scope: string }>) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_UPDATE, projectPath, updates),

  updateMarketplace: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE, name),

  // Agents
  listAgents: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.AGENTS_LIST, projectPath),
  readAgentFile: (projectPath: string, name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.AGENTS_READ_FILE, projectPath, name),

  // Skills
  listSkills: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_LIST, projectPath),
  readSkill: (projectPath: string, name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_READ, projectPath, name),
  readSkillFile: (projectPath: string, skillName: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_READ_FILE, projectPath, skillName, relativePath),
  installSkill: (sourcePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_INSTALL, sourcePath),
  deleteSkill: (projectPath: string, name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_DELETE, projectPath, name, scope),

  // Codex Skills
  codexListSkills: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_LIST, projectPath),
  codexReadSkill: (projectPath: string, name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_READ, projectPath, name),
  codexReadSkillFile: (projectPath: string, skillName: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_READ_FILE, projectPath, skillName, relativePath),

  // Codex MCP config
  codexListMcpConfigs: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MCP_LIST_CONFIG, projectPath),

  // MCP config
  listMcpConfigs: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_LIST_CONFIG, projectPath),
  saveMcpConfig: (
    projectPath: string,
    name: string,
    config: {
      type?: 'stdio' | 'http' | 'sse'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    },
    scope: string
  ) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SAVE_CONFIG, projectPath, name, config, scope),
  deleteMcpConfig: (projectPath: string, name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_DELETE_CONFIG, projectPath, name, scope),
  toggleMcpConfig: (projectPath: string, name: string, disabled: boolean, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_TOGGLE_CONFIG, projectPath, name, disabled, scope),
  checkMcpServers: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_CHECK_SERVERS, projectPath),
  oauthAuthorize: (serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, serverUrl, headers, transport),

  // MCP library
  listMcpLibrary: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_LIST_LIBRARY),
  deleteMcpLibraryEntry: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, name),

  // Window state
  getFullscreen: () =>
    ipcRenderer.invoke('get-fullscreen') as Promise<boolean>,
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, isFullscreen: boolean): void => {
      callback(isFullscreen)
    }
    ipcRenderer.on('fullscreen-changed', handler)
    return () => {
      ipcRenderer.removeListener('fullscreen-changed', handler)
    }
  },

  // Git
  getGitInfo: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_INFO, folderPath),
  getGitBranches: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_LIST_BRANCHES, folderPath),
  switchGitBranch: (folderPath: string, branch: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_SWITCH_BRANCH, folderPath, branch),
  createBranch: (folderPath: string, branch: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_CREATE_BRANCH, folderPath, branch),
  getWorktreeInfo: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_WORKTREE_INFO, folderPath),
  activateWorktree: (folderPath: string, baseBranch: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, folderPath, baseBranch),

  // Session history
  listSessions: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST, projectPath),
  listSessionsForFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER, folderPath),
  resumeSession: (projectPath: string, sessionId: string, worktreeCwd?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RESUME, projectPath, sessionId, worktreeCwd),
  loadSessionMessages: (projectPath: string, sessionId: string, limit: number, cursor?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, projectPath, sessionId, limit, cursor),
  renameSession: (sessionId: string, title: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RENAME, sessionId, title),
  createSession: (projectPath: string, claudeSessionId: string, isWorktree?: boolean, gitBranch?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_CREATE, projectPath, claudeSessionId, isWorktree, gitBranch),
  saveSessionState: (claudeSessionId: string, data: { messages: unknown[]; totalCostUsd: number; contextTokens: number; title?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_SAVE_STATE, claudeSessionId, data),
  loadSessionState: (claudeSessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_STATE, claudeSessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_DELETE, sessionId),
  pinSession: (sessionId: string, pinned: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_PIN, sessionId, pinned),
  listPinnedSessions: () =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST_PINNED),
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
