import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels, type BashOutputEvent, type CodexCollaborationMode, type CodexPermissionPreset, type CodexReasoningEffort, type CodexReviewTarget, type RemoteDeviceConfig, type SandboxMode, type SendMessageRequest } from '../shared/agent-types'

const agentAPI = {
  sendMessage: (projectPath: string, request: SendMessageRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.SEND_MESSAGE, projectPath, request),

  dequeueMessage: (projectPath: string, clientMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DEQUEUE_MESSAGE, projectPath, clientMessageId) as Promise<boolean>,

  prewarm: (projectPath: string, hint?: { effort?: SendMessageRequest['effort']; model?: string; additionalDirs?: string[]; sessionId?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.PREWARM, projectPath, hint),

  interrupt: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.INTERRUPT, projectPath),

  respondToPermission: (projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], sessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, projectPath, requestId, allow, alwaysAllow, reason, selectedSuggestions, sessionId) as Promise<boolean>,

  setPermissionMode: (projectPath: string, mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_PERMISSION_MODE, projectPath, mode),

  setSandboxMode: (projectPath: string, mode: SandboxMode) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SANDBOX_MODE, projectPath, mode),

  answerQuestion: (projectPath: string, requestId: string, answers: Record<string, string>, annotations?: Record<string, { preview?: string; notes?: string }>, sessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ANSWER_QUESTION, projectPath, requestId, answers, annotations, sessionId),

  dismissQuestion: (projectPath: string, requestId: string, sessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DISMISS_QUESTION, projectPath, requestId, sessionId),

  respondToPlanApproval: (projectPath: string, requestId: string, approved: boolean, feedback?: string, sessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESPOND_PLAN_APPROVAL, projectPath, requestId, approved, feedback, sessionId),

  createSession: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke(AgentIpcChannels.CREATE_SESSION, projectPath),

  resetSession: (projectPath: string, newSessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESET_SESSION, projectPath, newSessionId),

  truncateAtCheckpoint: (projectPath: string, checkpointId: string): Promise<boolean> =>
    ipcRenderer.invoke(AgentIpcChannels.TRUNCATE_AT_CHECKPOINT, projectPath, checkpointId),

  parkSession: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PARK_SESSION, projectPath),

  activateSession: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ACTIVATE_SESSION, projectPath, sessionId),

  getLiveSnapshots: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_LIVE_SNAPSHOTS),

  rewindFiles: (projectPath: string, userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_FILES, projectPath, userMessageId),

  previewRewind: (projectPath: string, userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_FILES_PREVIEW, projectPath, userMessageId),

  rewindCodeAndChat: (projectPath: string, userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_CODE_AND_CHAT, projectPath, userMessageId),

  rewindConversation: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_CONVERSATION, projectPath),

  getSessionId: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GET_SESSION_ID, projectPath),

  getMcpServerStatus: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SERVER_STATUS, projectPath),

  getContextUsage: (projectPath: string, sessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GET_CONTEXT_USAGE, projectPath, sessionId),

  reloadPlugins: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_RELOAD, projectPath),

  listDirectory: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_DIRECTORY, projectPath, relativePath),

  findLineNumber: (projectPath: string, filePath: string, text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FIND_LINE_NUMBER, projectPath, filePath, text),

  searchFiles: (projectPath: string, query: string, additionalDirs?: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.SEARCH_FILES, projectPath, query, additionalDirs),

  searchMentions: (projectPath: string, query: string, agents: { name: string; model: string }[], additionalDirs?: string[], scopeDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SEARCH_MENTIONS, projectPath, query, agents, additionalDirs, scopeDir),

  disconnectRemoteSession: () =>
    ipcRenderer.invoke(AgentIpcChannels.DISCONNECT_REMOTE_SESSION),

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

  selectFolder: (defaultPath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SELECT_FOLDER, defaultPath),

  getRecentFolders: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_RECENT_FOLDERS),

  getMediaServerPort: () =>
    ipcRenderer.invoke(AgentIpcChannels.MEDIA_SERVER_PORT) as Promise<number>,

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
    sessionId: string,
    projectPath: string,
    prompt: string,
    model?: string,
    reasoningEffort?: CodexReasoningEffort,
    permissionPreset?: CodexPermissionPreset,
    collaborationMode?: CodexCollaborationMode,
    threadId?: string,
    messageId?: string,
    images?: { mimeType: string; base64: string; name: string }[],
    cwd?: string,
    userMessageId?: string,
    userMessageText?: string,
    gitBranch?: string,
    worktreePath?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_RUN,
      sessionId,
      projectPath,
      prompt,
      model,
      reasoningEffort,
      permissionPreset,
      collaborationMode,
      threadId,
      messageId,
      images,
      cwd,
      userMessageId,
      userMessageText,
      gitBranch,
      worktreePath,
    ),

  codexListModels: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_LIST_MODELS, projectPath),

  codexReset: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_RESET, sessionId),

  codexInterrupt: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_INTERRUPT, sessionId),

  codexRespondToPermission: (
    sessionId: string,
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    decision?: 'cancel',
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_PERMISSION_RESPONSE,
      sessionId,
      requestId,
      allow,
      alwaysAllow,
      reason,
      decision,
    ),

  codexAnswerQuestion: (
    sessionId: string,
    requestId: string,
    answers: Record<string, string>,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_ANSWER_QUESTION,
      sessionId,
      requestId,
      answers,
    ),

  codexDismissQuestion: (
    sessionId: string,
    requestId: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_DISMISS_QUESTION,
      sessionId,
      requestId,
    ),

  codexSteer: (sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_STEER, sessionId, input, messageId, userMessageId, userMessageText, gitBranch, worktreePath),

  codexReview: (
    sessionId: string,
    projectPath: string,
    target: CodexReviewTarget,
    model?: string,
    reasoningEffort?: CodexReasoningEffort,
    permissionPreset?: CodexPermissionPreset,
    threadId?: string,
    messageId?: string,
    cwd?: string,
    userMessageId?: string,
    userMessageText?: string,
    gitBranch?: string,
    worktreePath?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_REVIEW,
      sessionId,
      projectPath,
      target,
      model,
      reasoningEffort,
      permissionPreset,
      threadId,
      messageId,
      cwd,
      userMessageId,
      userMessageText,
      gitBranch,
      worktreePath,
    ),

  codexCompact: (
    sessionId: string,
    projectPath: string,
    model?: string,
    permissionPreset?: CodexPermissionPreset,
    threadId?: string,
    messageId?: string,
    cwd?: string,
    userMessageId?: string,
    userMessageText?: string,
    gitBranch?: string,
    worktreePath?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.CODEX_COMPACT,
      sessionId,
      projectPath,
      model,
      permissionPreset,
      threadId,
      messageId,
      cwd,
      userMessageId,
      userMessageText,
      gitBranch,
      worktreePath,
    ),

  codexPlanApproval: (projectPath: string, sessionId: string, messageId: string, status: 'approved' | 'rejected', feedback?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLAN_APPROVAL, projectPath, sessionId, messageId, status, feedback),

  codexCollaborationModeChange: (projectPath: string, sessionId: string, mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_COLLABORATION_MODE_CHANGE, projectPath, sessionId, mode),

  codexGetAuthStatus: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GET_AUTH_STATUS, projectPath),

  codexSetAuth: (
    projectPath: string,
    request: { mode: 'auto' | 'chatgpt' | 'apiKey'; apiKey?: string }
  ) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SET_AUTH, projectPath, request),

  installUpdate: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_INSTALL),

  checkForUpdates: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_CHECK),

  simulateUpdate: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_SIMULATE),

  onUpdateEvent: (callback: (event: unknown) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: unknown): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.UPDATER_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.UPDATER_EVENT, handler)
    }
  },

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
  codexDeleteSkill: (projectPath: string, name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_DELETE, projectPath, name, scope),

  // Codex Plugins
  codexListPlugins: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLUGINS_LIST, projectPath),
  codexReadPlugin: (projectPath: string, key: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLUGINS_READ, projectPath, key),
  codexReadPluginFile: (projectPath: string, pluginKey: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLUGINS_READ_FILE, projectPath, pluginKey, relativePath),
  codexDeletePlugin: (projectPath: string, key: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLUGINS_DELETE, projectPath, key, scope),
  codexListMarketplacePlugins: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLUGINS_LIST_MARKETPLACE, projectPath),
  codexInstallPlugin: (projectPath: string, key: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_PLUGINS_INSTALL, projectPath, key, scope),

  // Codex MCP config
  codexListMcpConfigs: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MCP_LIST_CONFIG, projectPath),
  codexSaveMcpConfig: (
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
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MCP_SAVE_CONFIG, projectPath, name, config, scope),
  codexDeleteMcpConfig: (projectPath: string, name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MCP_DELETE_CONFIG, projectPath, name, scope),
  codexToggleMcpConfig: (projectPath: string, name: string, disabled: boolean, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MCP_TOGGLE_CONFIG, projectPath, name, disabled, scope),

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

  // Providers
  listProviders: () =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_LIST),
  createProvider: (data: { name: string; provider_type?: string; api_key?: string; category?: string; supported_agents?: string; agent_configs?: string; notes?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_CREATE, data),
  updateProvider: (id: string, data: { name?: string; provider_type?: string; api_key?: string; category?: string; supported_agents?: string; agent_configs?: string; notes?: string; sort_order?: number }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_UPDATE, id, data),
  deleteProvider: (id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_DELETE, id),
  activateProvider: (id: string, agentType: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_ACTIVATE, id, agentType),
  deactivateAllProviders: (agentType: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_DEACTIVATE_ALL, agentType),
  testProvider: (data: { api_key: string; base_url: string; extra_env: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_TEST, data) as Promise<{ success: boolean; models: number; error?: string }>,

  // Session Providers (new session layer)
  sessionProviders: {
    list: () =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_LIST),
    listByHarness: (harnessId: 'claude' | 'codex') =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_LIST_BY_HARNESS, harnessId),
    get: (id: string) =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_GET, id),
    getBase: (harnessId: 'claude' | 'codex') =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_GET_BASE, harnessId),
    create: (input: { harnessId: 'claude' | 'codex'; name: string; config: unknown; id?: string }) =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_CREATE, input),
    update: (id: string, patch: { name?: string; config?: unknown }) =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_UPDATE, id, patch),
    delete: (id: string) =>
      ipcRenderer.invoke(AgentIpcChannels.SESSION_PROVIDERS_DELETE, id),
  },

  // File operations
  moveFile: (folderPath: string, srcRelPath: string, destDirRelPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_MOVE, folderPath, srcRelPath, destDirRelPath),
  copyFilesIn: (folderPath: string, destDirRelPath: string, absolutePaths: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_COPY_IN, folderPath, destDirRelPath, absolutePaths),
  moveFilesIn: (folderPath: string, destDirRelPath: string, absolutePaths: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_MOVE_IN, folderPath, destDirRelPath, absolutePaths),
  deleteFile: (folderPath: string, relPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_DELETE, folderPath, relPath),
  renameFile: (folderPath: string, relPath: string, newName: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_RENAME, folderPath, relPath, newName),
  saveFile: (folderPath: string, filePath: string, content: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SAVE_FILE, folderPath, filePath, content),
  showInFolder: (folderPath: string, relPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_SHOW_IN_FOLDER, folderPath, relPath),
  openExternalLink: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_EXTERNAL_LINK, url),
  clipboardRead: () =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_READ) as Promise<string>,
  clipboardWrite: (text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_WRITE, text),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // File watcher
  startFileWatch: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_WATCH_START, folderPath),
  stopFileWatch: () =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_WATCH_STOP),
  onFileChangeEvent: (callback: (event: { folderPath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { folderPath: string }): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.FILE_CHANGE_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.FILE_CHANGE_EVENT, handler)
    }
  },
  onGitHeadChange: (callback: (event: { folderPath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { folderPath: string }): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.GIT_HEAD_CHANGE, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.GIT_HEAD_CHANGE, handler)
    }
  },
  onSessionChanged: (callback: () => void) => {
    const handler = (): void => { callback() }
    ipcRenderer.on(AgentIpcChannels.SESSIONS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.SESSIONS_CHANGED, handler)
    }
  },

  // Bash output watcher
  watchBashOutput: (toolUseId: string, filePath: string, tailLines?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.BASH_OUTPUT_WATCH, toolUseId, filePath, tailLines),
  unwatchBashOutput: (toolUseId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.BASH_OUTPUT_UNWATCH, toolUseId),
  readBashOutputMore: (toolUseId: string, tailLines: number): Promise<string> =>
    ipcRenderer.invoke(AgentIpcChannels.BASH_OUTPUT_READ_MORE, toolUseId, tailLines),
  readBashOutputFile: (filePath: string, tailLines: number): Promise<string> =>
    ipcRenderer.invoke(AgentIpcChannels.BASH_OUTPUT_READ_FILE, filePath, tailLines),
  onBashOutputEvent: (callback: (event: BashOutputEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: BashOutputEvent): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.BASH_OUTPUT_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.BASH_OUTPUT_EVENT, handler)
    }
  },

  // Settings
  getProjectPreferences: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLAUDE_PROJECT_PREFERENCES_GET, projectPath),
  saveProjectPreferences: (projectPath: string, preferences: { outputStyle: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.CLAUDE_PROJECT_PREFERENCES_SAVE, projectPath, preferences),
  setFastMode: (enabled: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_FAST_MODE, enabled),
  getAppSettings: () =>
    ipcRenderer.invoke(AgentIpcChannels.APP_SETTINGS_GET),
  saveAppSettings: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.APP_SETTINGS_SAVE, patch),

  // Logging
  getLogPath: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_LOG_PATH) as Promise<string>,

  platform: process.platform,

  onContentZoom: (callback: (action: 'in' | 'out' | 'reset') => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, action: 'in' | 'out' | 'reset'): void => {
      callback(action)
    }
    ipcRenderer.on(AgentIpcChannels.CONTENT_ZOOM, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.CONTENT_ZOOM, handler)
    }
  },

  // Window state
  getFullscreen: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_FULLSCREEN) as Promise<boolean>,
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, isFullscreen: boolean): void => {
      callback(isFullscreen)
    }
    ipcRenderer.on(AgentIpcChannels.FULLSCREEN_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.FULLSCREEN_CHANGED, handler)
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
  pathExists: (p: string): Promise<boolean> =>
    ipcRenderer.invoke(AgentIpcChannels.PATH_EXISTS, p),
  getWorktreeInfo: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_WORKTREE_INFO, folderPath),
  activateWorktree: (folderPath: string, baseBranch: string | null, carryLocalChanges?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, folderPath, baseBranch, carryLocalChanges),
  getGitStatusFiles: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_STATUS_FILES, folderPath),
  getGitLog: (folderPath: string, query?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_LOG, folderPath, query),
  getGitDiffFile: (folderPath: string, filePath: string, staged: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_DIFF_FILE, folderPath, filePath, staged),
  getGitReadFile: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_READ_FILE, folderPath, filePath),
  getFileTree: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_FILE_TREE, folderPath),
  listDir: (folderPath: string, dirRelPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_LIST_DIR, folderPath, dirRelPath),

  // Session history
  listSessions: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST, projectPath),
  listSessionsForFolder: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER, folderPath),
  listSessionsForFolderPage: (folderPath: string, limit: number, offset: number) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER_PAGE, folderPath, limit, offset),
  resumeSession: (projectPath: string, sessionId: string, worktreeCwd?: string, permissionMode?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RESUME, projectPath, sessionId, worktreeCwd, permissionMode),
  loadSessionMessages: (projectPath: string, sessionId: string, limit: number, cursor?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, projectPath, sessionId, limit, cursor),
  renameSession: (sessionId: string, title: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RENAME, sessionId, title),
  loadSessionState: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_STATE, sessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_DELETE, sessionId),
  deleteSessionsOlderThan: (folderPath: string, cutoffDate: string): Promise<string[]> =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_DELETE_OLDER, folderPath, cutoffDate),
  pinSession: (sessionId: string, pinned: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_PIN, sessionId, pinned),
  hideSession: (sessionId: string, hidden: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_HIDE, sessionId, hidden),
  listPinnedSessions: () =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LIST_PINNED),

  trace: (source: string, type: string, data: unknown, tag?: string) => {
    ipcRenderer.send(AgentIpcChannels.TRACE, source, type, data, tag)
  },

  submitToolIntercept: (callId: string, userInput: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_SUBMIT, callId, userInput),
  cancelToolIntercept: (callId: string, reason?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CANCEL, callId, reason),
  onToolInterceptOpen: (callback: (req: MiniAppToolInterceptOpenRequest) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, req: MiniAppToolInterceptOpenRequest) => callback(req)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN, handler)
  },
  onToolInterceptClearAll: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR_ALL, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR_ALL, handler)
  },

  // Remote control
  getRelayStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_GET_RELAY_STATUS) as Promise<boolean>,
  getRemoteConfig: () =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_GET_CONFIG),
  saveRemoteConfig: (config: RemoteDeviceConfig) =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_SAVE_CONFIG, config),
  onRecentFoldersChanged: (callback: (folders: unknown[]) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, folders: unknown[]): void => {
      callback(folders)
    }
    ipcRenderer.on(AgentIpcChannels.RECENT_FOLDERS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.RECENT_FOLDERS_CHANGED, handler)
    }
  },
  onRemoteCommand: (callback: (command: unknown) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, command: unknown): void => {
      callback(command)
    }
    ipcRenderer.on(AgentIpcChannels.REMOTE_COMMAND, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_COMMAND, handler)
    }
  },
  onClientRegistered: (callback: (info: { deviceName: string }) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, info: { deviceName: string }): void => {
      callback(info)
    }
    ipcRenderer.on(AgentIpcChannels.REMOTE_CLIENT_REGISTERED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_CLIENT_REGISTERED, handler)
    }
  },
  listPairedDevices: () =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_LIST_PAIRED),
  removePairedDevice: (id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_REMOVE_PAIRED, id),
  onDeviceStatusChanged: (callback: (device: { id: string; online: boolean }) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, device: { id: string; online: boolean }): void => {
      callback(device)
    }
    ipcRenderer.on(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, handler)
    }
  },
  startPairing: (): Promise<{ channelId: string; tempKeyHex: string; relayUrl: string }> =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_START_PAIRING),
  confirmPairing: (code: string): Promise<void> =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_CONFIRM_PAIRING, code),
  cancelPairing: (): Promise<void> =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_CANCEL_PAIRING),
  onPairingCodeReceived: (callback: (info: { code: string; deviceName: string }) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, info: { code: string; deviceName: string }): void => {
      callback(info)
    }
    ipcRenderer.on(AgentIpcChannels.REMOTE_PAIRING_CODE_RECEIVED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_PAIRING_CODE_RECEIVED, handler)
    }
  },
  onPairingExpired: (callback: () => void) => {
    const handler = (): void => { callback() }
    ipcRenderer.on(AgentIpcChannels.REMOTE_PAIRING_EXPIRED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_PAIRING_EXPIRED, handler)
    }
  },
  onPairingAlreadyPaired: (callback: (info: { deviceName: string }) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, info: { deviceName: string }): void => { callback(info) }
    ipcRenderer.on(AgentIpcChannels.REMOTE_PAIRING_ALREADY_PAIRED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_PAIRING_ALREADY_PAIRED, handler)
    }
  },
  onRelayStatusChanged: (callback: (connected: boolean) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, connected: boolean): void => { callback(connected) }
    ipcRenderer.on(AgentIpcChannels.REMOTE_RELAY_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_RELAY_STATUS, handler)
    }
  },

  widgetIframeReady: (widgetId: string): Promise<void> =>
    ipcRenderer.invoke(AgentIpcChannels.WIDGET_IFRAME_READY, widgetId),

  // Automations
  listAutomations: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_LIST, projectPath) as Promise<import('../shared/agent-types').Automation[]>,

  createAutomation: (projectPath: string, data: import('../shared/agent-types').CreateAutomationRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_CREATE, projectPath, data) as Promise<import('../shared/agent-types').Automation>,

  updateAutomation: (id: string, data: import('../shared/agent-types').UpdateAutomationRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_UPDATE, id, data) as Promise<import('../shared/agent-types').Automation | undefined>,

  deleteAutomation: (id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_DELETE, id) as Promise<boolean>,

  runAutomationNow: (id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_RUN_NOW, id) as Promise<void>,

  onAutomationEvent: (callback: (event: { automationId: string; status: string; sessionId?: string; error?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { automationId: string; status: string; sessionId?: string; error?: string }) => callback(event)
    ipcRenderer.on(AgentIpcChannels.AUTOMATIONS_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.AUTOMATIONS_EVENT, handler)
    }
  },
}

import type { MiniAppEntry, MiniAppToolCallRequest, MiniAppInstallMeta, MiniAppFsWatchEvent, MiniAppToolInterceptOpenRequest } from '../shared/miniapp-types'

const miniappAPI = {
  list: (projectDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_LIST, projectDir) as Promise<MiniAppEntry[]>,

  open: (appId: string, projectDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_OPEN, appId, projectDir),

  close: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_CLOSE, appId),

  toolResult: (callId: string, result: unknown, error?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_TOOL_RESULT, callId, result, error),

  fsRequest: (appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_REQUEST, appId, op, args),

  gitRequest: (appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GIT_REQUEST, appId, op, args),

  onGitHeadChangeEvent: (callback: (event: { appId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { appId: string }) => callback(event)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_GIT_HEAD_CHANGE, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_GIT_HEAD_CHANGE, handler)
  },

  fsWatch: (appId: string, path: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_WATCH, appId, path) as Promise<number>,

  fsUnwatch: (watchId: number) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_UNWATCH, watchId),

  onFsWatchEvent: (callback: (event: MiniAppFsWatchEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: MiniAppFsWatchEvent) => callback(event)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_FS_WATCH_EVENT, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_FS_WATCH_EVENT, handler)
  },

  iframeReady: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_IFRAME_READY, appId),

  onToolCall: (callback: (call: MiniAppToolCallRequest) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, call: MiniAppToolCallRequest) => callback(call)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_TOOL_CALL, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_TOOL_CALL, handler)
  },

  getPreloadPath: () =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GET_PRELOAD_PATH) as Promise<string>,

  detectDev: (projectDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DETECT_DEV, projectDir) as Promise<MiniAppEntry | null>,

  onDevAppReady: (callback: (projectDir: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, projectDir: string) => callback(projectDir)
    ipcRenderer.on('miniapp:dev-app-ready', handler)
    return () => ipcRenderer.removeListener('miniapp:dev-app-ready', handler)
  },

  preview: (s1appPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_PREVIEW, s1appPath),

  confirmInstall: (tempDir: string, installDir?: string, preapprovedTools?: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_CONFIRM_INSTALL, tempDir, installDir, preapprovedTools),

  cancelInstall: (tempDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_CANCEL_INSTALL, tempDir) as Promise<void>,

  uninstall: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_UNINSTALL, appId) as Promise<void>,

  pack: (appDir: string, outputDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_PACK, appDir, outputDir),

  getInstallMeta: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GET_INSTALL_META, appId) as Promise<MiniAppInstallMeta | null>,

  getPreapproved: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GET_PREAPPROVED, appId) as Promise<string[]>,

  setPreapproved: (appId: string, tools: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_SET_PREAPPROVED, appId, tools) as Promise<void>,
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('agent', agentAPI)
    contextBridge.exposeInMainWorld('app', appAPI)
    contextBridge.exposeInMainWorld('miniapp', miniappAPI)
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
  // @ts-ignore
  window.miniapp = miniappAPI
}
