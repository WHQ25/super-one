import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels, type BashOutputEvent, type CodexPermissionPreset, type CodexReasoningEffort, type CodexReviewTarget, type SandboxMode } from '../shared/agent-types'

const agentAPI = {
  sendMessage: (projectPath: string, request: { content: string; model?: string; images?: { mimeType: string; base64: string; name: string }[]; additionalDirs?: string[] }) =>
    ipcRenderer.invoke(AgentIpcChannels.SEND_MESSAGE, projectPath, request),

  interrupt: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.INTERRUPT, projectPath),

  respondToPermission: (projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, projectPath, requestId, allow, alwaysAllow, reason, selectedSuggestions),

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

  previewRewind: (projectPath: string, userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_FILES_PREVIEW, projectPath, userMessageId),

  rewindCodeAndChat: (projectPath: string, userMessageId: string, resumePointId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_CODE_AND_CHAT, projectPath, userMessageId, resumePointId),

  rewindConversation: (projectPath: string, userMessageId: string, resumePointId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_CONVERSATION, projectPath, userMessageId, resumePointId),

  getSessionId: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GET_SESSION_ID, projectPath),

  getMcpServerStatus: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SERVER_STATUS, projectPath),

  listDirectory: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_DIRECTORY, projectPath, relativePath),

  findLineNumber: (projectPath: string, filePath: string, text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FIND_LINE_NUMBER, projectPath, filePath, text),

  searchFiles: (projectPath: string, query: string, additionalDirs?: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.SEARCH_FILES, projectPath, query, additionalDirs),

  searchMentions: (projectPath: string, query: string, agents: { name: string; model: string }[], additionalDirs?: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.SEARCH_MENTIONS, projectPath, query, agents, additionalDirs),

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

  codexSteer: (projectPath: string, input: string, messageId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_STEER, projectPath, input, messageId),

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
  showInFolder: (folderPath: string, relPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_SHOW_IN_FOLDER, folderPath, relPath),
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
  watchBashOutput: (toolUseId: string, filePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.BASH_OUTPUT_WATCH, toolUseId, filePath),
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

  // Logging
  getLogPath: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_LOG_PATH) as Promise<string>,

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
  pathExists: (p: string): Promise<boolean> =>
    ipcRenderer.invoke(AgentIpcChannels.PATH_EXISTS, p),
  getWorktreeInfo: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_WORKTREE_INFO, folderPath),
  activateWorktree: (folderPath: string, baseBranch: string | null, carryLocalChanges?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, folderPath, baseBranch, carryLocalChanges),
  getGitStatusFiles: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_STATUS_FILES, folderPath),
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
  resumeSession: (projectPath: string, sessionId: string, worktreeCwd?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RESUME, projectPath, sessionId, worktreeCwd),
  loadSessionMessages: (projectPath: string, sessionId: string, limit: number, cursor?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, projectPath, sessionId, limit, cursor),
  renameSession: (sessionId: string, title: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_RENAME, sessionId, title),
  createSession: (projectPath: string, claudeSessionId: string, isWorktree?: boolean, gitBranch?: string, worktreePath?: string, title?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_CREATE, projectPath, claudeSessionId, isWorktree, gitBranch, worktreePath, title),
  saveSessionState: (claudeSessionId: string, data: { messages: unknown[]; totalCostUsd: number; contextTokens: number; title?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_SAVE_STATE, claudeSessionId, data),
  loadSessionState: (claudeSessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_LOAD_STATE, claudeSessionId),
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
    ipcRenderer.send('app:trace', source, type, data, tag)
  },

  // Remote control
  getRemoteConfig: () =>
    ipcRenderer.invoke('remote:get-config'),
  saveRemoteConfig: (config: { masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean }) =>
    ipcRenderer.invoke('remote:save-config', config),
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
  startPairing: (): Promise<{ channelId: string; tempKeyHex: string }> =>
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
