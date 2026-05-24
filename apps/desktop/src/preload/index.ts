import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels, type AgentPrewarmHint, type BashOutputEvent, type CodexCollaborationMode, type CodexPermissionPreset, type CodexProviderTestProgress, type CodexReasoningEffort, type CodexReviewTarget, type RemoteDeviceConfig, type SandboxMode, type SendMessageRequest, type ContentBlock, type ChatMessageContext, type WorktreeActivateRequest, type WorktreeHandoffResult, type GitDirtyStatus, type SessionForkRequest, type SessionForkResult, type HookSavePayload, type TerminalEvent, type TerminalListItem, type TerminalSnapshot } from '@superone/shared/agent-types'
import type { McpbInstallRequest } from '@superone/shared/mcpb-types'

try {
  const ROLE_PREFIX = '--superone-role='
  const role = process.argv.find((a) => a.startsWith(ROLE_PREFIX))?.slice(ROLE_PREFIX.length)
  const title = role === 'main' ? 'SuperOne Main Window' : role === 'mini' ? 'SuperOne Mini Window' : null
  if (title) process.title = title
} catch { /* process.title not writable in some sandboxed contexts */ }

type UserMessageExtras = {
  contexts?: ChatMessageContext[]
  userSelections?: string[]
  userMessageContent?: ContentBlock[]
}

const agentAPI = {
  sendMessage: (projectPath: string, request: SendMessageRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.SEND_MESSAGE, projectPath, request),

  dequeueMessage: (projectPath: string, clientMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DEQUEUE_MESSAGE, projectPath, clientMessageId) as Promise<boolean>,

  prewarm: (projectPath: string, hint?: AgentPrewarmHint) =>
    ipcRenderer.invoke(AgentIpcChannels.PREWARM, projectPath, hint),

  interrupt: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.INTERRUPT, sessionId) as Promise<boolean>,

  respondToPermission: (sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, sessionId, requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers) as Promise<boolean>,

  setPermissionMode: (projectPath: string, mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_PERMISSION_MODE, projectPath, mode),

  setSandboxMode: (projectPath: string, mode: SandboxMode) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SANDBOX_MODE, projectPath, mode),

  setSessionSettings: (projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null }) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SESSION_SETTINGS, projectPath, settings),

  setSessionApiProvider: (sessionId: string, apiProviderId: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SESSION_API_PROVIDER, sessionId, apiProviderId) as Promise<void>,

  broadcastSessionSetting: (sessionId: string, patch: import('@superone/shared/agent-types').SessionSettingsPatch) =>
    ipcRenderer.invoke(AgentIpcChannels.BROADCAST_SESSION_SETTING, sessionId, patch) as Promise<void>,

  answerQuestion: (sessionId: string, requestId: string, answers: Record<string, string>, annotations?: Record<string, { preview?: string; notes?: string }>) =>
    ipcRenderer.invoke(AgentIpcChannels.ANSWER_QUESTION, sessionId, requestId, answers, annotations),

  dismissQuestion: (sessionId: string, requestId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DISMISS_QUESTION, sessionId, requestId),

  respondToPlanApproval: (sessionId: string, requestId: string, approved: boolean, feedback?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESPOND_PLAN_APPROVAL, sessionId, requestId, approved, feedback),

  createSession: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke(AgentIpcChannels.CREATE_SESSION, projectPath),

  resetSession: (sessionId: string, newSessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.RESET_SESSION, sessionId, newSessionId),

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

  listDirectoryForAddDir: (projectPath: string, rawInput: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR, projectPath, rawInput),

  validateAddDir: (projectPath: string, candidate: string) =>
    ipcRenderer.invoke(AgentIpcChannels.VALIDATE_ADD_DIR, projectPath, candidate),

  findLineNumber: (projectPath: string, filePath: string, text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FIND_LINE_NUMBER, projectPath, filePath, text),

  searchFiles: (projectPath: string, query: string, additionalDirs?: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.SEARCH_FILES, projectPath, query, additionalDirs),

  searchMentions: (projectPath: string, query: string, agents: { name: string; model: string }[], additionalDirs?: string[], scopeDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SEARCH_MENTIONS, projectPath, query, agents, additionalDirs, scopeDir),

  disconnectRemoteSession: (sessionId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DISCONNECT_REMOTE_SESSION, sessionId),

  readProjectAdditionalDirs: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_PROJECT_ADDITIONAL_DIRS, projectPath) as Promise<{ user: string[]; projectShared: string[]; projectLocal: string[] }>,

  addProjectAdditionalDir: (projectPath: string, dir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ADD_PROJECT_ADDITIONAL_DIR, projectPath, dir),

  removeProjectAdditionalDir: (projectPath: string, dir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REMOVE_PROJECT_ADDITIONAL_DIR, projectPath, dir),

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

const terminalAPI = {
  create: (opts: { projectPath: string; sessionId?: string; title?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke(AgentIpcChannels.TERMINAL_CREATE, opts) as Promise<TerminalListItem>,

  list: (cwd?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.TERMINAL_LIST, cwd) as Promise<TerminalListItem[]>,

  snapshot: (terminalId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.TERMINAL_SNAPSHOT, terminalId) as Promise<TerminalSnapshot | null>,

  write: (terminalId: string, data: string) =>
    ipcRenderer.invoke(AgentIpcChannels.TERMINAL_WRITE, terminalId, data) as Promise<void>,

  resize: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(AgentIpcChannels.TERMINAL_RESIZE, terminalId, cols, rows) as Promise<void>,

  kill: (terminalId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.TERMINAL_KILL, terminalId) as Promise<void>,

  onTerminalEvent: (callback: (event: TerminalEvent) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: TerminalEvent): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.TERMINAL_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.TERMINAL_EVENT, handler)
    }
  },
}

const appAPI = {
  connectClaude: () =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_CLAUDE),

  connectCodex: () =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_CODEX),

  getStartupData: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_STARTUP_DATA),

  probeSandbox: () =>
    ipcRenderer.invoke(AgentIpcChannels.SANDBOX_PROBE) as Promise<import('@superone/shared/agent-types').SandboxProbeResult>,

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

  getProjectId: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GET_PROJECT_ID, folderPath) as Promise<string | null>,

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
    extras?: UserMessageExtras,
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
      extras,
    ),

  codexListModels: (projectPath: string, apiProviderId?: string | null, force?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_LIST_MODELS, projectPath, apiProviderId ?? null, force ?? false),

  codexSteer: (sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string, extras?: UserMessageExtras) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_STEER, sessionId, input, messageId, userMessageId, userMessageText, gitBranch, worktreePath, extras),

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
    extras?: UserMessageExtras,
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
      extras,
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
    extras?: UserMessageExtras,
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
      extras,
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

  getGithubStars: (repoSlug: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_GITHUB_STARS, repoSlug),

  cacheRemoteImage: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CACHE_IMAGE, url),

  addMarketplace: (source: string, scope: string, projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_ADD_MARKETPLACE, source, scope, projectPath),
  removeMarketplace: (name: string, scope: string, projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_REMOVE_MARKETPLACE, name, scope, projectPath),
  readMarketplacePlugin: (marketplace: string, name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_READ_MARKETPLACE, marketplace, name),
  readMarketplacePluginFile: (marketplace: string, name: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_READ_MARKETPLACE_FILE, marketplace, name, relativePath),

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
  toggleSkill: (name: string, disabled: boolean): Promise<string[]> =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_TOGGLE, name, disabled),

  // Codex Skills
  codexListSkills: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_LIST, projectPath),
  codexReadSkill: (projectPath: string, name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_READ, projectPath, name),
  codexReadSkillFile: (projectPath: string, skillName: string, relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_READ_FILE, projectPath, skillName, relativePath),
  codexDeleteSkill: (projectPath: string, name: string, scope: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_DELETE, projectPath, name, scope),

  // Codex Hooks (read-only)
  codexListHooks: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_HOOKS_LIST, projectPath),

  // Codex Goal
  codexGetGoal: (projectPath: string, threadId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GOAL_GET, projectPath, threadId),
  codexSetGoal: (projectPath: string, threadId: string, objective: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GOAL_SET, projectPath, threadId, objective),
  codexClearGoal: (projectPath: string, threadId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GOAL_CLEAR, projectPath, threadId),

  // Codex Marketplace
  codexMarketplaceAdd: (projectPath: string, request: { source: string; refName?: string; sparsePaths?: string[] }) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MARKETPLACE_ADD, projectPath, request),
  codexMarketplaceRemove: (projectPath: string, marketplaceName: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MARKETPLACE_REMOVE, projectPath, marketplaceName),
  codexMarketplaceUpgrade: (projectPath: string, marketplaceName?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MARKETPLACE_UPGRADE, projectPath, marketplaceName),

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
  getMcpMetaCache: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_META_CACHE),
  oauthAuthorize: (serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, serverUrl, headers, transport),

  // MCP library
  listMcpLibrary: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_LIST_LIBRARY),
  deleteMcpLibraryEntry: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, name),

  // MCP bundles (.mcpb)
  previewMcpb: (filePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCPB_PREVIEW, filePath),
  installMcpb: (request: McpbInstallRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.MCPB_INSTALL, request),
  uninstallMcpb: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCPB_UNINSTALL, name),
  listInstalledMcpb: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCPB_LIST),
  revealMcpb: (name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCPB_REVEAL, name),

  // Hooks config
  listHooks: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.HOOKS_LIST, projectPath),
  saveHook: (projectPath: string, payload: HookSavePayload, replaceId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.HOOKS_SAVE, projectPath, payload, replaceId),
  deleteHook: (projectPath: string, id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.HOOKS_DELETE, projectPath, id),

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
  testProvider: (data: { api_key: string; base_url: string; extra_env: string; provider_id?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_TEST, data) as Promise<{ success: boolean; models: number; error?: string }>,
  testCodexProvider: (data: { api_key: string; base_url: string; extra_env: string; name?: string; model?: string; provider_id?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_TEST_CODEX, data) as Promise<{ success: boolean; models: number; error?: string }>,
  onTestCodexProgress: (callback: (progress: CodexProviderTestProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: CodexProviderTestProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(AgentIpcChannels.PROVIDERS_TEST_CODEX_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.PROVIDERS_TEST_CODEX_PROGRESS, handler)
    }
  },

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
  readFileAsDataUri: (absPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_FILE_AS_DATA_URI, absPath),
  saveFileAs: (sourcePath: string, defaultName: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SAVE_FILE_AS, sourcePath, defaultName),
  showInFolder: (folderPath: string, relPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_SHOW_IN_FOLDER, folderPath, relPath),
  openExternalLink: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_EXTERNAL_LINK, url),
  clipboardRead: () =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_READ) as Promise<string>,
  clipboardWrite: (text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_WRITE, text),
  clipboardWriteImage: (absPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_WRITE_IMAGE, absPath),
  revealFile: (absPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REVEAL_FILE, absPath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  startDrag: (paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }) =>
    ipcRenderer.send(AgentIpcChannels.START_DRAG, paths, iconOpts),
  pathStat: (path: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PATH_STAT, path) as Promise<{ isFile: boolean; isDirectory: boolean } | null>,

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
  pickAppIconFile: () =>
    ipcRenderer.invoke(AgentIpcChannels.APP_ICON_PICK_FILE),
  setAppIcon: (pngDataUri: string) =>
    ipcRenderer.invoke(AgentIpcChannels.APP_ICON_SET, pngDataUri),
  resetAppIcon: () =>
    ipcRenderer.invoke(AgentIpcChannels.APP_ICON_RESET),
  onAppSettingsChange: (callback: (settings: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, settings: unknown): void => {
      callback(settings)
    }
    ipcRenderer.on(AgentIpcChannels.APP_SETTINGS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.APP_SETTINGS_CHANGED, handler)
    }
  },
  getSystemLocale: () =>
    ipcRenderer.invoke(AgentIpcChannels.APP_SYSTEM_LOCALE) as Promise<string>,
  onLocaleChanged: (callback: (locale: 'en' | 'zh') => void) => {
    const handler = (_e: Electron.IpcRendererEvent, locale: 'en' | 'zh'): void => {
      callback(locale)
    }
    ipcRenderer.on(AgentIpcChannels.APP_LOCALE_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.APP_LOCALE_CHANGED, handler)
    }
  },

  // Logging
  getLogPath: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_LOG_PATH) as Promise<string>,

  // Usage statistics
  queryUsage: (range?: { from?: string; to?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.USAGE_QUERY, range ?? {}) as Promise<{
      rows: Array<{
        day: string
        harness: 'claude' | 'codex'
        model: string
        input_tokens: number
        output_tokens: number
        cache_read_tokens: number
        cache_creation_tokens: number
      }>
    }>,
  queryUsageCounts: (range?: { from?: string; to?: string; harness?: 'claude' | 'codex' }) =>
    ipcRenderer.invoke(AgentIpcChannels.USAGE_COUNTS_QUERY, range ?? {}) as Promise<{
      sessions: number
      messages: number
    }>,
  getUsageBackfillStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.USAGE_BACKFILL_STATUS) as Promise<'done' | 'pending'>,
  onUsageBackfillDone: (callback: (summary: { scanned: number; claudeRecorded: number; codexRecorded: number; durationMs: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, summary: { scanned: number; claudeRecorded: number; codexRecorded: number; durationMs: number }): void => {
      callback(summary)
    }
    ipcRenderer.on(AgentIpcChannels.USAGE_BACKFILL_DONE, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.USAGE_BACKFILL_DONE, handler)
    }
  },

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

  onCloseTabShortcut: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(AgentIpcChannels.CLOSE_TAB_SHORTCUT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.CLOSE_TAB_SHORTCUT, handler)
    }
  },

  closeWindow: () => ipcRenderer.send(AgentIpcChannels.CLOSE_WINDOW),

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
  setMinWindowSize: (width: number, height: number) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_MIN_WINDOW_SIZE, width, height) as Promise<void>,
  openSessionWindow: (projectPath: string, sessionId: string, title?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_SESSION_WINDOW, projectPath, sessionId, title) as Promise<void>,
  setWindowAlwaysOnTop: (value: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_WINDOW_ALWAYS_ON_TOP, value) as Promise<boolean>,
  getTheme: () => ipcRenderer.invoke(AgentIpcChannels.GET_THEME) as Promise<boolean>,
  setTheme: (dark: boolean) => ipcRenderer.invoke(AgentIpcChannels.SET_THEME, dark) as Promise<void>,
  onThemeChange: (callback: (dark: boolean) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, dark: boolean): void => callback(dark)
    ipcRenderer.on(AgentIpcChannels.THEME_CHANGED, handler)
    return () => { ipcRenderer.removeListener(AgentIpcChannels.THEME_CHANGED, handler) }
  },

  // Git
  getGitInfo: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_INFO, folderPath),
  getGitIsRepo: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_IS_REPO, folderPath),
  gitInit: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_INIT, folderPath),
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
  getCheckedOutBranches: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_CHECKED_OUT_BRANCHES, folderPath) as Promise<string[]>,
  activateWorktree: (folderPath: string, request: WorktreeActivateRequest | null) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, folderPath, request),
  switchToExistingWorktree: (folderPath: string, wtPath: string, gitBranch: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_SWITCH_WORKTREE, folderPath, wtPath, gitBranch) as Promise<{ ok: true } | { ok: false; error: string }>,
  handoffToLocal: (worktreePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_HANDOFF_TO_LOCAL, worktreePath) as Promise<WorktreeHandoffResult>,
  getHandoffPreview: (worktreePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_HANDOFF_PREVIEW, worktreePath) as Promise<GitDirtyStatus | null>,
  forkSession: (request: SessionForkRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.SESSIONS_FORK, request) as Promise<SessionForkResult>,
  getGitStatusFiles: (folderPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_STATUS_FILES, folderPath),
  getGitLog: (folderPath: string, query?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_LOG, folderPath, query),
  getGitDiffFile: (folderPath: string, filePath: string, staged: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_DIFF_FILE, folderPath, filePath, staged),
  readProjectFile: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_PROJECT_FILE, folderPath, filePath),
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
  onToolInterceptClear: (callback: (projectDir: string, callIds: string[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, projectDir: string, callIds: string[]) => callback(projectDir, callIds)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR, handler)
  },

  // Remote control
  getRelayStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_GET_RELAY_STATUS) as Promise<boolean>,
  getLanStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_GET_LAN_STATUS) as Promise<boolean>,
  getHostname: () =>
    ipcRenderer.invoke(AgentIpcChannels.REMOTE_GET_HOSTNAME) as Promise<string>,
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
  onDeviceStatusChanged: (callback: (device: import('@superone/shared/agent-types').RemoteDeviceStatus) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, device: import('@superone/shared/agent-types').RemoteDeviceStatus): void => {
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
  onLanStatusChanged: (callback: (active: boolean) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, active: boolean): void => { callback(active) }
    ipcRenderer.on(AgentIpcChannels.REMOTE_LAN_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_LAN_STATUS, handler)
    }
  },

  widgetIframeReady: (widgetId: string): Promise<void> =>
    ipcRenderer.invoke(AgentIpcChannels.WIDGET_IFRAME_READY, widgetId),

  // Automations
  listAutomations: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_LIST, projectPath) as Promise<import('@superone/shared/agent-types').Automation[]>,

  createAutomation: (projectPath: string, data: import('@superone/shared/agent-types').CreateAutomationRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_CREATE, projectPath, data) as Promise<import('@superone/shared/agent-types').Automation>,

  updateAutomation: (id: string, data: import('@superone/shared/agent-types').UpdateAutomationRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.AUTOMATIONS_UPDATE, id, data) as Promise<import('@superone/shared/agent-types').Automation | undefined>,

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

import type { MiniAppEntry, MiniAppToolCallRequest, MiniAppInstallMeta, MiniAppFsWatchEvent, MiniAppToolInterceptOpenRequest, DevRegistryEntry, DevRegistryView } from '@superone/shared/miniapp-types'

const miniappAPI = {
  list: (projectDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_LIST, projectDir) as Promise<MiniAppEntry[]>,

  open: (appId: string, projectDir: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_OPEN, appId, projectDir, sessionId),

  close: (appId: string, projectDir: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_CLOSE, appId, projectDir, sessionId),

  authorize: (appIds: string[], projectDir: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_AUTHORIZE, appIds, projectDir, sessionId),

  unauthorize: (appIds: string[], projectDir: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_UNAUTHORIZE, appIds, projectDir, sessionId),

  toolResult: (callId: string, result: unknown, error?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_TOOL_RESULT, callId, result, error),

  fsRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_REQUEST, projectDir, appId, op, args),

  gitRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GIT_REQUEST, projectDir, appId, op, args),

  dbRequest: (appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DB_REQUEST, appId, op, args),

  kvRequest: (appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_KV_REQUEST, appId, op, args),

  onGitHeadChangeEvent: (callback: (event: { projectDir: string; appId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { projectDir: string; appId: string }) => callback(event)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_GIT_HEAD_CHANGE, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_GIT_HEAD_CHANGE, handler)
  },

  fsWatch: (projectDir: string, appId: string, path: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_WATCH, projectDir, appId, path) as Promise<number>,

  fsUnwatch: (watchId: number) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_UNWATCH, watchId),

  onFsWatchEvent: (callback: (event: MiniAppFsWatchEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: MiniAppFsWatchEvent) => callback(event)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_FS_WATCH_EVENT, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_FS_WATCH_EVENT, handler)
  },

  iframeReady: (appId: string, projectDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_IFRAME_READY, appId, projectDir),

  onToolCall: (callback: (call: MiniAppToolCallRequest) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, call: MiniAppToolCallRequest) => callback(call)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_TOOL_CALL, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_TOOL_CALL, handler)
  },

  getPreloadPath: () =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GET_PRELOAD_PATH) as Promise<string>,

  detectDev: (projectDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DETECT_DEV, projectDir) as Promise<MiniAppEntry[]>,

  onDevAppReady: (callback: (projectDir: string, appId: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, projectDir: string, appId: string) =>
      callback(projectDir, appId)
    ipcRenderer.on('miniapp:dev-app-ready', handler)
    return () => ipcRenderer.removeListener('miniapp:dev-app-ready', handler)
  },

  onLazyOpenRequest: (callback: (event: { appId: string; projectDir: string; sessionId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { appId: string; projectDir: string; sessionId: string }) =>
      callback(event)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_LAZY_OPEN_REQUEST, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_LAZY_OPEN_REQUEST, handler)
  },

  onPeerEvent: (callback: (event: { sessionId: string; appId: string; event: string; payload: unknown }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { sessionId: string; appId: string; event: string; payload: unknown }) =>
      callback(event)
    ipcRenderer.on('miniapp-peer-event', handler)
    return () => ipcRenderer.removeListener('miniapp-peer-event', handler)
  },

  peerEmit: (appId: string, event: string, payload: unknown) =>
    ipcRenderer.send(AgentIpcChannels.MINIAPP_PEER_EMIT, appId, event, payload),

  workerStart: (projectDir: string, appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_WORKER_START, projectDir, appId) as Promise<{ running: boolean; since?: number }>,
  workerStop: (projectDir: string, appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_WORKER_STOP, projectDir, appId) as Promise<{ running: boolean }>,
  workerStatus: (projectDir: string, appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_WORKER_STATUS, projectDir, appId) as Promise<{ running: boolean; since?: number }>,
  workerSend: (projectDir: string, appId: string, payload: unknown) =>
    ipcRenderer.send(AgentIpcChannels.MINIAPP_WORKER_SEND, { projectDir, appId, type: 'miniapp-worker-msg', data: { payload } }),
  onWorkerEvent: (handler: (data: { appId: string; projectDir: string; payload: unknown }) => void) => {
    const listener = (_e: unknown, data: { appId: string; projectDir: string; payload: unknown }) => handler(data)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_WORKER_EVENT, listener)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_WORKER_EVENT, listener)
  },
  workerList: () =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_WORKER_LIST) as Promise<Array<{ appId: string; projectDir: string; name: string; since: number; statusText?: string }>>,
  onWorkerState: (handler: (workers: Array<{ appId: string; projectDir: string; name: string; since: number; statusText?: string }>) => void) => {
    const listener = (_e: unknown, data: { workers: Array<{ appId: string; projectDir: string; name: string; since: number; statusText?: string }> }) => handler(data.workers)
    ipcRenderer.on(AgentIpcChannels.MINIAPP_WORKER_STATE, listener)
    return () => ipcRenderer.removeListener(AgentIpcChannels.MINIAPP_WORKER_STATE, listener)
  },

  preview: (s1appPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_PREVIEW, s1appPath),

  confirmInstall: (tempDir: string, installDir?: string, preapprovedTools?: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_CONFIRM_INSTALL, tempDir, installDir, preapprovedTools),

  cancelInstall: (tempDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_CANCEL_INSTALL, tempDir) as Promise<void>,

  uninstall: (appId: string, installDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_UNINSTALL, appId, installDir) as Promise<void>,

  pack: (appDir: string, outputDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_PACK, appDir, outputDir),

  getInstallMeta: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GET_INSTALL_META, appId) as Promise<MiniAppInstallMeta | null>,

  getPreapproved: (appId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GET_PREAPPROVED, appId) as Promise<string[]>,

  setPreapproved: (appId: string, tools: string[]) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_SET_PREAPPROVED, appId, tools) as Promise<void>,

  devRegistry: {
    list: () =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_LIST) as Promise<DevRegistryView[]>,
    add: () =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_ADD) as Promise<DevRegistryEntry | null>,
    remove: (appId: string, cascade?: boolean) =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_REMOVE, appId, cascade) as Promise<void>,
    install: (appId: string, scope: 'user' | 'project', projectDir?: string, force?: boolean) =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_INSTALL, appId, scope, projectDir, force) as Promise<{ installDir: string }>,
    uninstall: (appId: string, scope: 'user' | 'project', projectDir?: string) =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_UNINSTALL, appId, scope, projectDir) as Promise<void>,
    setEnabled: (appId: string, scope: 'user' | 'project', enabled: boolean, projectDir?: string) =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_SET_ENABLED, appId, scope, enabled, projectDir) as Promise<void>,
    revealSource: (appId: string) =>
      ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DEV_REGISTRY_REVEAL_SOURCE, appId) as Promise<void>,
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('agent', agentAPI)
    contextBridge.exposeInMainWorld('terminal', terminalAPI)
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
  window.terminal = terminalAPI
  // @ts-ignore
  window.app = appAPI
  // @ts-ignore
  window.miniapp = miniappAPI
}
