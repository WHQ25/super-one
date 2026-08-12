import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels, type AgentEvent, type NativeContextMenuItemSpec, type AgentPrewarmHint, type BashOutputEvent, type CodexCollaborationMode, type CodexGoalStatus, type CodexPermissionPreset, type CodexReasoningEffort, type CodexReviewTarget, type CodexExternalAgentItem, type ProviderEndpointTestResponse, type DiscoverModelsResult, type RemoteDeviceConfig, type SandboxMode, type SendMessageRequest, type ContentBlock, type ChatMessageContext, type WorktreeActivateRequest, type WorktreeHandoffResult, type WorktreeAssignResult, type GitDirtyStatus, type SessionForkRequest, type SessionForkResult, type HookSavePayload, type TerminalEvent, type TerminalListItem, type TerminalSnapshot, type HarnessId, type BrowserCertError, type BrowserOpenTabRequest, type UpsertMediaProviderRequest, type ThemeMode } from '@superone/shared/agent-types'
import type { McpbInstallRequest } from '@superone/shared/mcpb-types'
import type { ConsumerBinding, ConsumerId, Credential, EndpointOverride, Platform, ServiceEndpoint } from '@superone/shared/platform-registry'
import type { DraftListEntry, DraftUpsertRequest, ProjectSnapshot } from '@superone/shared/environment'
import { forEachAgentEventPayload } from './agent-event-payload'

// Do not try to name this renderer via `process.title` here — it cannot work.
// Under `sandbox: true` preload's `process` is an Electron shim, so the assignment
// is a silent no-op; and even unsandboxed, the LaunchServices call libuv makes
// (the part Activity Monitor actually reads) is denied inside the renderer's
// seatbelt sandbox. Verified: renderer PIDs report LSDisplayName = NULL.
// Per-renderer attribution belongs in an in-app task manager built on
// `app.getAppMetrics()` + `webContents.getOSProcessId()`. See main/process-titles.ts.

if (process.argv.includes('--superone-liquid-glass')) {
  const stamp = (): void => document.documentElement.classList.add('liquid-glass')
  if (document.documentElement) stamp()
  else document.addEventListener('DOMContentLoaded', stamp, { once: true })
}

type UserMessageExtras = {
  contexts?: ChatMessageContext[]
  userSelections?: string[]
  userMessageContent?: ContentBlock[]
  apiProviderId?: string | null
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

  stopTask: (sessionId: string, taskId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.STOP_TASK, sessionId, taskId) as Promise<boolean>,

  respondToPermission: (sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, sessionId, requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers) as Promise<boolean>,

  setPermissionMode: (projectPath: string, mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_PERMISSION_MODE, projectPath, mode),

  setSandboxMode: (projectPath: string, mode: SandboxMode) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SANDBOX_MODE, projectPath, mode),

  setSessionSettings: (projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null; mode?: string | null }) =>
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

  /** Grok ACP manual `/recap` — host RPC, not a prompt turn. */
  requestSessionRecap: (sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REQUEST_SESSION_RECAP, sessionId) as Promise<boolean>,

  truncateAtCheckpoint: (projectPath: string, checkpointId: string): Promise<boolean> =>
    ipcRenderer.invoke(AgentIpcChannels.TRUNCATE_AT_CHECKPOINT, projectPath, checkpointId),

  parkSession: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PARK_SESSION, projectPath),

  activateSession: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ACTIVATE_SESSION, projectPath, sessionId),

  setSessionForeground: (sessionId: string, foreground: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_SESSION_FOREGROUND, sessionId, foreground),

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

  authenticateMcpServer: (projectPath: string, serverName: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SERVER_AUTHENTICATE, projectPath, serverName),

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

  onAgentEvent: (callback: (event: AgentEvent) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, payload: AgentEvent | AgentEvent[]): void => {
      forEachAgentEventPayload(payload, callback)
    }
    ipcRenderer.on(AgentIpcChannels.EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.EVENT, handler)
    }
  },
}

/** Multi-environment / remote node — product path is Main EnvironmentHost. */
const environmentAPI = {
  list: () => ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_LIST),
  getLocalId: () =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_GET_LOCAL_ID) as Promise<string>,
  workspaceListDir: (
    project: { environmentId: string; projectId: string },
    relativePath: string,
  ) => ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_WORKSPACE_LIST_DIR, project, relativePath),
  workspaceReadFile: (
    project: { environmentId: string; projectId: string },
    relativePath: string,
  ) => ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_WORKSPACE_READ_FILE, project, relativePath),
  workspaceTailWatchStart: (
    project: { environmentId: string; projectId: string },
    relativePath: string,
    offset?: number,
    absolutePath?: string,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_WORKSPACE_TAIL_WATCH_START,
      project,
      relativePath,
      offset,
      absolutePath,
    ),
  workspaceTailWatchPoll: (
    watchId: string,
    project?: { environmentId: string; projectId: string },
  ) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_WORKSPACE_TAIL_WATCH_POLL, watchId, project),
  workspaceTailWatchStop: (
    watchId: string,
    project: { environmentId: string; projectId: string },
  ) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_WORKSPACE_TAIL_WATCH_STOP, watchId, project),
  pairRemote: (input: { baseUrl: string; pairingToken: string; label: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PAIR_REMOTE, input),
  connectWithFailover: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_CONNECT_FAILOVER, connectionId),
  /** Dev-only: status of local remote-node lab (`bun run dev:cli:lab`). */
  localLabStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_LOCAL_LAB_STATUS) as Promise<{
      available: boolean
      baseUrl: string
      label: string
      nodeHome: string
      reachable: boolean
      environmentId?: string
      nodePublicKeyFingerprint?: string
      error?: string
      startHint: string
    }>,
  /** Dev-only: one-click pair/connect to local lab. */
  pairLocalLab: () =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PAIR_LOCAL_LAB) as Promise<{
      connectionId: string
      alreadyPaired: boolean
      persisted: boolean
      baseUrl: string
      label: string
    }>,

  // Environment management (Settings → Environments)
  listItems: () => ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_LIST_ITEMS),
  addOverSsh: (input: {
    destination: string
    remoteExec?: string
    /** Default registry (`@super-one/cli`); `upload` for local dist / debug. */
    installSource?: 'registry' | 'upload'
    packageVersion?: string
    remotePort?: number
    remoteNodeHome?: string
    sshPort?: number
    identityFile?: string
    label?: string
  }) => ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_ADD_OVER_SSH, input),
  /** Install this desktop's CLI version on a paired node, restart it, reconnect. */
  upgradeNode: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_UPGRADE_NODE, connectionId) as Promise<{
      version: string
      warnings: string[]
    }>,
  listSshConfigHosts: () =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_LIST_SSH_CONFIG_HOSTS) as Promise<
      Array<{
        alias: string
        hostName?: string
        user?: string
        port?: number
        identityFile?: string
        display: string
      }>
    >,
  listHarnesses: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_HARNESS_LIST, connectionId),
  enableHarness: (
    connectionId: string,
    input: {
      harnessId: string
      artifactPath?: string
      command?: string
      serverUrl?: string
      args?: string[]
    },
  ) => ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_HARNESS_ENABLE, connectionId, input),
  disableHarness: (connectionId: string, harnessId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_HARNESS_DISABLE, connectionId, harnessId),
  probeHarness: (connectionId: string, harnessId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_HARNESS_PROBE, connectionId, harnessId),
  listProjects: (connectionId: string, options?: { refresh?: boolean }) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_LIST_PROJECTS,
      connectionId,
      options,
    ) as Promise<ProjectSnapshot[]>,
  openProject: (
    connectionId: string,
    projectPath: string,
    opts?: { createIfMissing?: boolean },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_OPEN_PROJECT,
      connectionId,
      projectPath,
      opts,
    ) as Promise<ProjectSnapshot>,
  removeProject: (connectionId: string, input: { projectId?: string; path?: string }) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_REMOVE_PROJECT,
      connectionId,
      input,
    ) as Promise<{ projectId?: string; path: string; name?: string; lastActiveAt?: number }>,
  /** Drafts live in the environment that owns the project — never mirrored. */
  listDrafts: (connectionId: string, projectPath?: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_LIST_DRAFTS,
      connectionId,
      projectPath,
    ) as Promise<DraftListEntry[]>,
  upsertDraft: (connectionId: string, draft: DraftUpsertRequest) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_UPSERT_DRAFT,
      connectionId,
      draft,
    ) as Promise<DraftListEntry>,
  deleteDraft: (connectionId: string, draftId: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_DELETE_DRAFT,
      connectionId,
      draftId,
    ) as Promise<void>,
  listSessions: (
    connectionId: string,
    projectId: string,
    options: { limit: number; offset: number },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_LIST_SESSIONS,
      connectionId,
      projectId,
      options,
    ) as Promise<
      Array<{
        sessionId: string
        title: string
        lastActiveAt: string
        provider?: string
        messageCount: number
        isPinned?: boolean
        isHidden?: boolean
        worktreePath?: string | null
        isWorktree?: boolean
        parentSessionId?: string
        gitBranch?: string
        isAutomation?: boolean
        automationId?: string
        acpAgentId?: string
        providerSessionId?: string
      }>
    >,
  createSession: (
    connectionId: string,
    input: { projectId: string; title?: string; providerId?: string; harnessId?: string },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_CREATE_SESSION,
      connectionId,
      input,
    ) as Promise<{
      sessionId: string
      title: string
      lastActiveAt: string
      provider?: string
      messageCount: number
    }>,
  getSession: (connectionId: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_GET_SESSION, connectionId, sessionId),
  /** Node AI provider store (credentials masked). */
  listRemoteCredentials: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_CREDENTIALS, connectionId),
  createRemoteCredential: (connectionId: string, input: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_CREATE_CREDENTIAL, connectionId, input),
  updateRemoteCredential: (connectionId: string, input: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_UPDATE_CREDENTIAL, connectionId, input),
  deleteRemoteCredential: (connectionId: string, id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_DELETE_CREDENTIAL, connectionId, id),
  listRemoteBindings: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_BINDINGS, connectionId),
  setRemoteBinding: (connectionId: string, binding: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_SET_BINDING, connectionId, binding),
  clearRemoteBinding: (connectionId: string, consumer: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_CLEAR_BINDING, connectionId, consumer),
  listRemoteCustomPlatforms: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_CUSTOM_PLATFORMS, connectionId),
  upsertRemoteCustomPlatform: (connectionId: string, def: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_UPSERT_CUSTOM_PLATFORM, connectionId, def),
  deleteRemoteCustomPlatform: (connectionId: string, id: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_DELETE_CUSTOM_PLATFORM, connectionId, id),
  /** Main decrypts local secrets and imports onto the node. */
  pushLocalProvidersToRemote: (connectionId: string, opts?: { replaceAll?: boolean }) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_PUSH_LOCAL, connectionId, opts) as Promise<{
      credentials: number
      bindings: number
    }>,
  pullRemoteProvidersToLocal: (connectionId: string, opts?: { replaceAll?: boolean }) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_PROVIDER_PULL_REMOTE, connectionId, opts) as Promise<{
      credentials: number
      bindings: number
    }>,
  listRemoteModels: (
    connectionId: string,
    harness: string,
    apiProviderId?: string | null,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_MODELS,
      connectionId,
      harness,
      apiProviderId ?? null,
    ),
  sendSessionMessage: (
    connectionId: string,
    input: {
      sessionId: string
      text: string
      clientMessageId?: string
      projectPath?: string
      providerId?: string
      cwdHostPath?: string | null
      model?: string | null
      effort?: string | null
      permissionMode?: string | null
      additionalDirectories?: string[]
      enabledSkills?: string[]
      disabledSkills?: string[]
      images?: Array<{ name?: string; mimeType: string; base64: string }>
      apiProviderId?: string | null
      /** Codex turn kind for session.send options.turnKind */
      turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
      collaborationMode?: string | Record<string, unknown> | null
      reviewTarget?: unknown
    },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SEND_SESSION_MESSAGE,
      connectionId,
      input,
    ),
  listSessionEvents: (connectionId: string, afterSequence?: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_LIST_SESSION_EVENTS,
      connectionId,
      afterSequence ?? '0',
    ),
  /**
   * Paged denser message catalog from the node (tool summaries / metadata).
   * Chat-store remote hydrate prefers this over text-only recovery.
   */
  listSessionMessages: (
    connectionId: string,
    input: { sessionId: string; cursor?: string | number | null; limit?: number },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_LIST_SESSION_MESSAGES,
      connectionId,
      input,
    ),
  interruptSession: (connectionId: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_INTERRUPT_SESSION, connectionId, sessionId),
  renameSession: (connectionId: string, sessionId: string, title: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_RENAME_SESSION,
      connectionId,
      sessionId,
      title,
    ),
  removeSession: (connectionId: string, sessionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_REMOVE_SESSION, connectionId, sessionId),
  setSessionUiFlags: (
    connectionId: string,
    sessionId: string,
    flags: { isPinned?: boolean; isHidden?: boolean },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SET_SESSION_UI_FLAGS,
      connectionId,
      sessionId,
      flags,
    ),
  forkSession: (
    connectionId: string,
    input: { sessionId: string; mode?: 'local' | 'worktree'; forkFromMessageId?: string },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_FORK_SESSION,
      connectionId,
      input,
    ) as Promise<{ ok: true; sessionId: string; worktreePath?: string } | { ok: false; error: string }>,
  respondSessionPermission: (
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      decision: 'allow' | 'deny' | 'allow_always'
      formAnswers?: Record<string, unknown>
      cancel?: boolean
      continueDrain?: {
        projectPath?: string
        providerId?: string
        timeoutMs?: number
      }
    },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_PERMISSION,
      connectionId,
      input,
    ),
  respondSessionQuestion: (
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      answers: unknown
      continueDrain?: {
        projectPath?: string
        providerId?: string
        timeoutMs?: number
      }
    },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_QUESTION,
      connectionId,
      input,
    ),
  respondSessionPlan: (
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      decision: 'approve' | 'reject'
      options?: Record<string, unknown>
      continueDrain?: {
        projectPath?: string
        providerId?: string
        timeoutMs?: number
      }
    },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_PLAN,
      connectionId,
      input,
    ),
  resumeRemoteSessionEvents: (
    connectionId: string,
    input: {
      sessionId: string
      projectPath?: string
      providerId?: string
      settleAfterInteractionId?: string
      timeoutMs?: number
    },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_RESUME_REMOTE_SESSION_EVENTS,
      connectionId,
      input,
    ),
  browsePath: (connectionId: string, absolutePath: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_BROWSE_PATH,
      connectionId,
      absolutePath,
    ) as Promise<{
      path: string
      entries: Array<{ name: string; path: string; type: 'directory' }>
    }>,
  cloneRepository: (
    connectionId: string,
    input: { remoteUrl: string; parentPath: string; directoryName?: string },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_CLONE_REPOSITORY,
      connectionId,
      input,
    ) as Promise<{ projectId: string; path: string; name: string; lastActiveAt?: number }>,
  connect: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_CONNECT, connectionId),
  disconnect: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_DISCONNECT, connectionId),
  forget: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_FORGET, connectionId),
  retryNow: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_RETRY_NOW, connectionId) as Promise<
      'started' | 'already_connected' | 'blocked' | 'disposed'
    >,
  repairPairing: (input: { connectionId: string; baseUrl: string; pairingToken: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_REPAIR_PAIRING, input),
  /** Re-pair over the stored SSH endpoint; the desktop mints the token itself. */
  repairPairingOverSsh: (connectionId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ENVIRONMENT_REPAIR_PAIRING_SSH, connectionId),

  /**
   * Node harness.resources aggregate (models + skills/commands/agents/prompts).
   * Prefer this over desktop CONNECT_* caches for remote projects.
   */
  getRemoteHarnessResources: (
    connectionId: string,
    input: {
      projectId: string
      harnessId?: string
      apiProviderId?: string | null
    },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_HARNESS_RESOURCES,
      connectionId,
      input,
    ),

  /** Node session_providers CRUD (multi-profile). */
  listRemoteSessionProviders: (connectionId: string, harnessId?: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_LIST,
      connectionId,
      harnessId,
    ),
  getRemoteSessionProvider: (connectionId: string, id: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_GET,
      connectionId,
      id,
    ),
  getRemoteSessionProviderBase: (connectionId: string, harnessId: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_GET_BASE,
      connectionId,
      harnessId,
    ),
  createRemoteSessionProvider: (
    connectionId: string,
    input: { harnessId: string; name: string; config?: unknown; id?: string },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_CREATE,
      connectionId,
      input,
    ),
  updateRemoteSessionProvider: (
    connectionId: string,
    id: string,
    patch: { name?: string; config?: unknown },
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_UPDATE,
      connectionId,
      id,
      patch,
    ),
  deleteRemoteSessionProvider: (connectionId: string, id: string) =>
    ipcRenderer.invoke(
      AgentIpcChannels.ENVIRONMENT_SESSION_PROVIDERS_DELETE,
      connectionId,
      id,
    ),

  onStatusEvent: (callback: (snapshot: unknown) => void) => {
    const handler = (_e: unknown, snapshot: unknown): void => callback(snapshot)
    ipcRenderer.on(AgentIpcChannels.ENVIRONMENT_STATUS_EVENT, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.ENVIRONMENT_STATUS_EVENT, handler)
  },
  onInstallProgress: (callback: (progress: unknown) => void) => {
    const handler = (_e: unknown, progress: unknown): void => callback(progress)
    ipcRenderer.on(AgentIpcChannels.ENVIRONMENT_INSTALL_PROGRESS, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.ENVIRONMENT_INSTALL_PROGRESS, handler)
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
  connectClaude: (force?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_CLAUDE, force),

  connectCodex: () =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_CODEX),

  connectOpenCode: (force?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_OPENCODE, force),

  connectCursor: (force?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.CONNECT_CURSOR, force),

  setCursorApiKey: (apiKey: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_CURSOR_API_KEY, apiKey),

  getCursorAuthStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_CURSOR_AUTH_STATUS) as Promise<{
      configured: boolean
      apiKeyName: string | null
      userEmail: string | null
    }>,

  updateCursorBaseConfig: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_UPDATE_BASE_CONFIG, patch),

  getCursorBaseConfig: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_CURSOR_BASE_CONFIG),

  cursorListAgents: (opts?: { runtime?: 'local' | 'cloud'; cwd?: string; limit?: number; cursor?: string; includeArchived?: boolean }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_LIST_AGENTS, opts),

  cursorListRuns: (agentId: string, opts?: { runtime?: 'local' | 'cloud'; cwd?: string; limit?: number; cursor?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_LIST_RUNS, agentId, opts),

  cursorArchiveAgent: (agentId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_ARCHIVE_AGENT, agentId),

  cursorUnarchiveAgent: (agentId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_UNARCHIVE_AGENT, agentId),

  cursorDeleteAgent: (agentId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_DELETE_AGENT, agentId),

  cursorListArtifacts: (agentId: string, opts?: { cwd?: string; model?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_LIST_ARTIFACTS, agentId, opts),

  cursorDownloadArtifact: (agentId: string, path: string, opts?: { cwd?: string; model?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_DOWNLOAD_ARTIFACT, agentId, path, opts),

  cursorListRepositories: () =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_LIST_REPOSITORIES),
  cursorGetAgent: (agentId: string, opts?: { cwd?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_GET_AGENT, agentId, opts),
  cursorListMessages: (agentId: string, opts?: { cwd?: string; limit?: number; offset?: number }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_LIST_MESSAGES, agentId, opts),
  cursorGetRun: (runId: string, opts?: { agentId?: string; cwd?: string; runtime?: 'local' | 'cloud' }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_GET_RUN, runId, opts),
  cursorCancelRun: (runId: string, opts?: { agentId?: string; cwd?: string; runtime?: 'local' | 'cloud' }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_CANCEL_RUN, runId, opts),
  cursorForceRecover: (sessionId: string, message?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_FORCE_RECOVER, sessionId, message),

  cursorSdkLogin: () =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_SDK_LOGIN) as Promise<{
      ok: true
      email: string | null
      apiKeyExpiresAtMs: number
    }>,

  cursorSdkLogout: () =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_SDK_LOGOUT) as Promise<{ ok: true }>,

  cursorSdkAuthStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_SDK_AUTH_STATUS) as Promise<
      | { status: 'logged-out' }
      | { status: 'logged-in'; backendUrl: string; email?: string; apiKeyExpiresAtMs?: number }
    >,

  cursorGetUsage: (agentId: string, opts?: { runId?: string }) =>
    ipcRenderer.invoke(AgentIpcChannels.CURSOR_GET_USAGE, agentId, opts),

  getStartupData: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_STARTUP_DATA),

  getAppMetrics: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_APP_METRICS) as Promise<import('@superone/shared/agent-types').AppMetricsSnapshot>,

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

  // Local harness installation catalog (Settings → Harnesses)
  listHarnesses: () => ipcRenderer.invoke(AgentIpcChannels.HARNESS_LIST),
  enableHarness: (input: {
    harnessId: string
    artifactPath?: string
    command?: string
    serverUrl?: string
    args?: string[]
    forcePin?: boolean
  }) => ipcRenderer.invoke(AgentIpcChannels.HARNESS_ENABLE, input),
  disableHarness: (harnessId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.HARNESS_DISABLE, harnessId),
  probeHarness: (harnessId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.HARNESS_PROBE, harnessId),
  ensureHarness: (harnessId: 'claude' | 'codex') =>
    ipcRenderer.invoke(AgentIpcChannels.HARNESS_ENSURE, harnessId),
  scanHarnessClis: () =>
    ipcRenderer.invoke(AgentIpcChannels.HARNESS_SCAN_CLI) as Promise<{
      hits: Array<{
        harnessId: 'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok'
        command: string | null
        detected: boolean
        version?: string
      }>
      defaultSelected: Array<'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok'>
      integrationLabels: Record<
        'claude' | 'codex' | 'opencode' | 'cursor' | 'acp-grok',
        { label: string }
      >
    }>,
  alignEnabledHarnesses: () =>
    ipcRenderer.invoke(AgentIpcChannels.HARNESS_ALIGN_ENABLED) as Promise<{
      aligned: Array<{ id: 'claude' | 'codex'; runtimeVersion?: string }>
      failed: Array<{ id: 'claude' | 'codex'; error: string }>
    }>,
  needsHarnessAlign: () =>
    ipcRenderer.invoke(AgentIpcChannels.HARNESS_NEEDS_ALIGN) as Promise<boolean>,
  onHarnessInstallProgress: (
    callback: (event: {
      harnessId: string
      received: number
      total: number
      phase: 'download' | 'done' | 'error'
      message?: string
    }) => void,
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      event: {
        harnessId: string
        received: number
        total: number
        phase: 'download' | 'done' | 'error'
        message?: string
      },
    ): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.HARNESS_INSTALL_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.HARNESS_INSTALL_PROGRESS, handler)
    }
  },

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

  codexGetRateLimits: (projectPath: string, apiProviderId?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GET_RATE_LIMITS, projectPath, apiProviderId),

  codexGetAccountUsage: (projectPath: string, apiProviderId?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GET_ACCOUNT_USAGE, projectPath, apiProviderId),

  codexConsumeRateLimitReset: (projectPath: string, apiProviderId?: string | null, creditId?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_CONSUME_RATE_LIMIT_RESET, projectPath, apiProviderId, creditId),

  codexMcpServerOauthLogin: (projectPath: string, serverName: string, apiProviderId?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_MCP_OAUTH_LOGIN, projectPath, serverName, apiProviderId),

  codexDetectExternalAgentConfig: (projectPath: string, apiProviderId?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_EXTERNAL_AGENT_DETECT, projectPath, apiProviderId),

  codexImportExternalAgentConfig: (projectPath: string, items: CodexExternalAgentItem[], apiProviderId?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_EXTERNAL_AGENT_IMPORT, projectPath, items, apiProviderId),

  claudeGetRateLimits: (force?: boolean) => ipcRenderer.invoke(AgentIpcChannels.CLAUDE_GET_RATE_LIMITS, force),

  providerGetRateLimits: (apiProviderId: string, force?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDER_GET_RATE_LIMITS, apiProviderId, force),

  acpGetRateLimits: (projectPath: string, agentId: string, force?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.ACP_GET_RATE_LIMITS, projectPath, agentId, force),

  codexSetAuth: (
    projectPath: string,
    request: { mode: 'auto' | 'chatgpt' | 'apiKey'; apiKey?: string }
  ) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SET_AUTH, projectPath, request),

  installUpdate: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_INSTALL),

  checkForUpdates: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_CHECK),

  downloadUpdate: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_DOWNLOAD),

  retryUpdateHarness: () =>
    ipcRenderer.invoke(AgentIpcChannels.UPDATER_RETRY_HARNESS),

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

  searchGithubRepos: (owner: string) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_GITHUB_SEARCH_REPOS, owner) as Promise<
      Array<{
        owner: string
        name: string
        fullName: string
        description: string | null
        private: boolean
      }>
    >,

  listMyGithubRepos: (page?: number, perPage?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.PLUGINS_GITHUB_LIST_MY_REPOS, page, perPage) as Promise<{
      repos: Array<{
        owner: string
        name: string
        fullName: string
        description: string | null
        private: boolean
      }>
      hasMore: boolean
      unavailable: boolean
    }>,

  cacheRemoteImage: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CACHE_IMAGE, url),

  resolveFavicon: (url: string, isDark: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.RESOLVE_FAVICON, url, isDark),

  cacheFavicon: (pageUrl: string, faviconUrl: string, isDark: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.CACHE_FAVICON, pageUrl, faviconUrl, isDark),

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
  listSlashResources: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SLASH_RESOURCES_LIST, projectPath) as Promise<{
      skills: Array<{ name: string; description: string; argumentHint: string; isSkill: boolean }>
      commands: Array<{ name: string; description: string; argumentHint: string; isSkill: boolean }>
    }>,
  readSkill: (projectPath: string, name: string, sourcePath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_READ, projectPath, name, sourcePath),
  readSkillFile: (projectPath: string, skillName: string, relativePath: string, sourcePath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_READ_FILE, projectPath, skillName, relativePath, sourcePath),
  installSkill: (sourcePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_INSTALL, sourcePath),
  deleteSkill: (projectPath: string, sourcePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_DELETE, projectPath, sourcePath),
  toggleSkill: (name: string, disabled: boolean): Promise<string[]> =>
    ipcRenderer.invoke(AgentIpcChannels.SKILLS_TOGGLE, name, disabled),

  // Codex Skills
  codexListSkills: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_LIST, projectPath),
  codexReadSkill: (projectPath: string, name: string, sourcePath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_READ, projectPath, name, sourcePath),
  codexReadSkillFile: (projectPath: string, skillName: string, relativePath: string, sourcePath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_READ_FILE, projectPath, skillName, relativePath, sourcePath),
  codexDeleteSkill: (projectPath: string, sourcePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_SKILLS_DELETE, projectPath, sourcePath),

  // Codex Hooks (read-only)
  codexListHooks: (projectPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_HOOKS_LIST, projectPath),

  // Codex Goal
  codexGetGoal: (sessionId: string, threadId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GOAL_GET, sessionId, threadId),
  codexSetGoal: (sessionId: string, threadId: string, objective: string, status?: CodexGoalStatus) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GOAL_SET, sessionId, threadId, objective, status),
  codexClearGoal: (sessionId: string, threadId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CODEX_GOAL_CLEAR, sessionId, threadId),

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
  checkMcpServers: (projectPath: string, harness?: HarnessId) =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_CHECK_SERVERS, projectPath, harness),
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

  // Unified AI provider platform (registry + credentials + bindings)
  listPlatforms: (): Promise<Platform[]> => ipcRenderer.invoke(AgentIpcChannels.PLATFORMS_LIST),
  createCustomPlatform: (def: Platform): Promise<Platform> =>
    ipcRenderer.invoke(AgentIpcChannels.PLATFORMS_CREATE_CUSTOM, def),
  updateCustomPlatform: (def: Platform): Promise<Platform> =>
    ipcRenderer.invoke(AgentIpcChannels.PLATFORMS_UPDATE_CUSTOM, def),
  deleteCustomPlatform: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(AgentIpcChannels.PLATFORMS_DELETE_CUSTOM, id),
  listCredentials: (): Promise<Credential[]> => ipcRenderer.invoke(AgentIpcChannels.CREDENTIALS_LIST),
  createCredential: (input: {
    platformId: string
    planId: string
    name: string
    secret?: string
    secretEnv?: string
    overrides?: Record<string, EndpointOverride>
    endpoints?: ServiceEndpoint[]
    notes?: string
  }): Promise<Credential> => ipcRenderer.invoke(AgentIpcChannels.CREDENTIALS_CREATE, input),
  updateCredential: (
    id: string,
    patch: {
      name?: string
      secret?: string
      secretEnv?: string
      overrides?: Record<string, EndpointOverride>
      endpoints?: ServiceEndpoint[] | null
      notes?: string
      sortOrder?: number
    },
  ): Promise<Credential | undefined> => ipcRenderer.invoke(AgentIpcChannels.CREDENTIALS_UPDATE, id, patch),
  deleteCredential: (id: string): Promise<boolean> => ipcRenderer.invoke(AgentIpcChannels.CREDENTIALS_DELETE, id),
  listBindings: (): Promise<ConsumerBinding[]> => ipcRenderer.invoke(AgentIpcChannels.BINDINGS_GET),
  setBinding: (binding: ConsumerBinding): Promise<void> =>
    ipcRenderer.invoke(AgentIpcChannels.BINDINGS_SET, binding),
  clearBinding: (consumer: ConsumerId): Promise<void> =>
    ipcRenderer.invoke(AgentIpcChannels.BINDINGS_CLEAR, consumer),
  testProviderEndpoint: (data: { apiKey: string; credentialId?: string; endpoints: ServiceEndpoint[] }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_TEST_ENDPOINT, data) as Promise<ProviderEndpointTestResponse>,
  discoverProviderModels: (data: { apiKey: string; credentialId?: string; endpoint: ServiceEndpoint }) =>
    ipcRenderer.invoke(AgentIpcChannels.PROVIDERS_DISCOVER_MODELS, data) as Promise<DiscoverModelsResult>,
  listAcpAgents: () =>
    ipcRenderer.invoke(AgentIpcChannels.ACP_LIST_AGENTS) as Promise<import('@superone/shared/agent-types').AcpResources>,
  refreshAcpModels: (agentId?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.ACP_REFRESH_MODELS, agentId) as Promise<import('@superone/shared/agent-types').AcpResources>,

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
  getMediaProviders: () =>
    ipcRenderer.invoke(AgentIpcChannels.MEDIA_GEN_PROVIDERS),
  getModelCatalog: () =>
    ipcRenderer.invoke(AgentIpcChannels.MODEL_CATALOG_GET),
  refreshModelCatalog: () =>
    ipcRenderer.invoke(AgentIpcChannels.MODEL_CATALOG_REFRESH),
  listWorkflowAgents: (transcriptDir: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_WORKFLOW_AGENTS, transcriptDir),
  readWorkflowOutput: (filePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_WORKFLOW_OUTPUT, filePath),
  readWorkflowScript: (filePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_WORKFLOW_SCRIPT, filePath),
  discoverGrokWorkflows: (projectPath?: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.DISCOVER_GROK_WORKFLOWS, projectPath) as Promise<Array<{
      name: string
      description: string
      whenToUse?: string
      source: 'project' | 'user'
      path: string
      args: Array<{ name: string; description?: string; required?: boolean }>
      exampleJson?: string
    }>>,
  saveFileAs: (sourcePath: string, defaultName: string, defaultDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SAVE_FILE_AS, sourcePath, defaultName, defaultDir),
  showInFolder: (folderPath: string, relPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.FILE_SHOW_IN_FOLDER, folderPath, relPath),
  showContextMenu: (items: NativeContextMenuItemSpec[]) =>
    ipcRenderer.invoke(AgentIpcChannels.SHOW_CONTEXT_MENU, items) as Promise<string | null>,
  openExternalLink: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_EXTERNAL_LINK, url),
  clipboardRead: () =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_READ) as Promise<string>,
  clipboardWrite: (text: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_WRITE, text),
  clipboardWriteImage: (absPath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.CLIPBOARD_WRITE_IMAGE, absPath),
  fetchBrowserImage: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_FETCH_IMAGE, url),
  saveBrowserImage: (base64: string, mimeType: string, suggestedName: string, defaultDir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_SAVE_IMAGE, base64, mimeType, suggestedName, defaultDir),
  copyBrowserImageAt: (webContentsId: number, x: number, y: number) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_COPY_IMAGE_AT, webContentsId, x, y),
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
  onCodexSkillsChanged: (callback: (event: { projectPath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { projectPath: string }): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.CODEX_SKILLS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.CODEX_SKILLS_CHANGED, handler)
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
  readSubagentTranscript: (outputFile: string, dir?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.READ_SUBAGENT_TRANSCRIPT, outputFile, dir),
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
  openComputerUsePermissions: (
    request: boolean | 'guided' | 'accessibility' | 'screenRecording' = true,
  ) => ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_OPEN_PERMISSIONS, request),
  recheckComputerUsePermissions: () =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_RECHECK_PERMISSIONS),
  closeComputerUsePermissionFloat: () =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_CLOSE_PERMISSION_FLOAT),
  resizeComputerUsePermissionFloat: (width: number, height: number) =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_RESIZE_PERMISSION_FLOAT, width, height),
  continueComputerUsePermissionStep: () =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_CONTINUE_PERMISSION_STEP),
  onComputerUsePermissionStatus: (
    callback: (status: {
      accessibility?: string
      screenRecording?: string
      helperName?: string
      helperBundleId?: string
      helperPath?: string
      screenRecordingNeedsRelaunch?: boolean
      pane?: 'accessibility' | 'screenRecording'
      flow?: 'guided' | 'single'
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: {
        accessibility?: string
        screenRecording?: string
        helperName?: string
        helperBundleId?: string
        helperPath?: string
        screenRecordingNeedsRelaunch?: boolean
        pane?: 'accessibility' | 'screenRecording'
        flow?: 'guided' | 'single'
      },
    ): void => {
      callback(status)
    }
    ipcRenderer.on(AgentIpcChannels.COMPUTER_USE_PERMISSION_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.COMPUTER_USE_PERMISSION_STATUS, handler)
    }
  },
  listComputerUseRunningApps: () =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_LIST_RUNNING_APPS) as Promise<
      Array<{ app: string; bundleId: string; pid: number; frontmost: boolean }>
    >,
  listComputerUseInstalledApps: () =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_LIST_INSTALLED_APPS) as Promise<
      Array<{ app: string; bundleId: string; aliases: string[] }>
    >,
  grantComputerUseSessionApps: (
    sessionId: string,
    apps: Array<{ app: string; bundleId: string }>,
  ) =>
    ipcRenderer.invoke(
      AgentIpcChannels.COMPUTER_USE_GRANT_SESSION_APPS,
      sessionId,
      apps,
    ) as Promise<boolean>,
  resolveComputerUseAppIcon: (bundleId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.COMPUTER_USE_RESOLVE_APP_ICON, bundleId) as Promise<
      string | null
    >,
  recordBrowserHistory: (url: string, title: string, titleOnly?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_HISTORY_RECORD, url, title, titleOnly),
  suggestBrowserHistory: (query: string, limit?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_HISTORY_SUGGEST, query, limit),
  deleteBrowserHistory: (url: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_HISTORY_DELETE, url),
  browserCertProceed: (url: string) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_CERT_PROCEED, url),
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
        harness: 'claude' | 'codex' | 'grok'
        model: string
        input_tokens: number
        output_tokens: number
        cache_read_tokens: number
        cache_creation_tokens: number
      }>
    }>,
  queryUsageCounts: (range?: { from?: string; to?: string; harness?: 'claude' | 'codex' | 'grok' | 'cursor' | 'opencode' }) =>
    ipcRenderer.invoke(AgentIpcChannels.USAGE_COUNTS_QUERY, range ?? {}) as Promise<{
      sessions: number
      messages: number
    }>,
  queryHarnessSessionRanks: (days?: number) =>
    ipcRenderer.invoke(AgentIpcChannels.USAGE_HARNESS_SESSION_RANKS, days ?? 7) as Promise<
      Array<{
        key: string
        provider: 'claude' | 'codex' | 'acp' | 'opencode'
        acpAgentId: string | null
        sessionCount: number
      }>
    >,
  getUsageBackfillStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.USAGE_BACKFILL_STATUS) as Promise<'done' | 'pending'>,
  onUsageBackfillDone: (callback: (summary: { scanned: number; claudeRecorded: number; codexRecorded: number; grokRecorded: number; durationMs: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, summary: { scanned: number; claudeRecorded: number; codexRecorded: number; grokRecorded: number; durationMs: number }): void => {
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

  onBrowserAnnotateShortcut: (callback: (webContentsId: number) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, webContentsId: number): void => {
      callback(webContentsId)
    }
    ipcRenderer.on(AgentIpcChannels.BROWSER_ANNOTATE_SHORTCUT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.BROWSER_ANNOTATE_SHORTCUT, handler)
    }
  },

  onBrowserBookmarkShortcut: (callback: (webContentsId: number) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, webContentsId: number): void => {
      callback(webContentsId)
    }
    ipcRenderer.on(AgentIpcChannels.BROWSER_BOOKMARK_SHORTCUT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.BROWSER_BOOKMARK_SHORTCUT, handler)
    }
  },

  onBrowserNewTabShortcut: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(AgentIpcChannels.BROWSER_NEW_TAB_SHORTCUT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.BROWSER_NEW_TAB_SHORTCUT, handler)
    }
  },

  onBrowserOpenTab: (callback: (payload: BrowserOpenTabRequest) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, payload: BrowserOpenTabRequest): void => {
      callback(payload)
    }
    ipcRenderer.on(AgentIpcChannels.BROWSER_OPEN_TAB, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.BROWSER_OPEN_TAB, handler)
    }
  },

  onBrowserCertError: (callback: (payload: BrowserCertError) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, payload: BrowserCertError): void => {
      callback(payload)
    }
    ipcRenderer.on(AgentIpcChannels.BROWSER_CERT_ERROR, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.BROWSER_CERT_ERROR, handler)
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
  openSessionWindow: (projectPath: string, sessionId: string, title?: string, position?: { x: number; y: number }) =>
    ipcRenderer.invoke(AgentIpcChannels.OPEN_SESSION_WINDOW, projectPath, sessionId, title, position) as Promise<void>,
  startDragPreview: (title: string) =>
    ipcRenderer.invoke(AgentIpcChannels.DRAG_PREVIEW_START, title) as Promise<void>,
  endDragPreview: () =>
    ipcRenderer.invoke(AgentIpcChannels.DRAG_PREVIEW_END) as Promise<void>,
  onDragPreviewUpdate: (callback: (data: { title: string; dark: boolean }) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, data: { title: string; dark: boolean }): void => {
      callback(data)
    }
    ipcRenderer.on(AgentIpcChannels.DRAG_PREVIEW_UPDATE, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.DRAG_PREVIEW_UPDATE, handler)
    }
  },
  onDragPreviewZone: (callback: (zone: 'inside' | 'outside') => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, zone: 'inside' | 'outside'): void => {
      callback(zone)
    }
    ipcRenderer.on(AgentIpcChannels.DRAG_PREVIEW_ZONE, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.DRAG_PREVIEW_ZONE, handler)
    }
  },
  setWindowAlwaysOnTop: (value: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_WINDOW_ALWAYS_ON_TOP, value) as Promise<boolean>,
  getTheme: () => ipcRenderer.invoke(AgentIpcChannels.GET_THEME) as Promise<{ mode: ThemeMode; dark: boolean }>,
  setTheme: (mode: ThemeMode) => ipcRenderer.invoke(AgentIpcChannels.SET_THEME, mode) as Promise<void>,
  onThemeChange: (callback: (state: { mode: ThemeMode; dark: boolean }) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, state: { mode: ThemeMode; dark: boolean }): void => callback(state)
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
  handoffToLocal: (worktreePath: string, folderPath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_HANDOFF_TO_LOCAL, worktreePath, folderPath) as Promise<WorktreeHandoffResult>,
  getHandoffPreview: (worktreePath: string, folderPath?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_HANDOFF_PREVIEW, worktreePath, folderPath) as Promise<GitDirtyStatus | null>,
  assignBranch: (folderPath: string, worktreePath: string, name: string) =>
    ipcRenderer.invoke(AgentIpcChannels.GIT_ASSIGN_BRANCH, folderPath, worktreePath, name) as Promise<WorktreeAssignResult>,
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
  setUnsavedEditorBuffer: (filePath: string, content: string | null) =>
    ipcRenderer.invoke(AgentIpcChannels.ACP_SET_UNSAVED_BUFFER, filePath, content),
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
  onUploadProgress: (callback: (progress: import('@superone/shared/agent-types').MobileUploadProgress) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, progress: import('@superone/shared/agent-types').MobileUploadProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(AgentIpcChannels.REMOTE_UPLOAD_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.REMOTE_UPLOAD_PROGRESS, handler)
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

  saveWidgetTemplate: (projectPath: string | null, input: import('@superone/shared/agent-types').SaveWidgetTemplateRequest) =>
    ipcRenderer.invoke(AgentIpcChannels.WIDGET_SAVE_TEMPLATE, projectPath, input) as Promise<import('@superone/shared/agent-types').SavedWidgetTemplate>,

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

  onAutomationEvent: (callback: (event: { automationId: string; status: string; sessionId?: string; error?: string; projectPath?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { automationId: string; status: string; sessionId?: string; error?: string; projectPath?: string }) => callback(event)
    ipcRenderer.on(AgentIpcChannels.AUTOMATIONS_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.AUTOMATIONS_EVENT, handler)
    }
  },

  onAutomationsChanged: (callback: (event: { projectPath?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { projectPath?: string }) => callback(event ?? {})
    ipcRenderer.on(AgentIpcChannels.AUTOMATIONS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.AUTOMATIONS_CHANGED, handler)
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

  startDrag: (
    projectDir: string,
    appId: string,
    paths: string[],
    iconOpts?: { png: ArrayBuffer; scaleFactor?: number },
  ) => ipcRenderer.send(AgentIpcChannels.MINIAPP_START_DRAG, projectDir, appId, paths, iconOpts),

  gitRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GIT_REQUEST, projectDir, appId, op, args),

  dbRequest: (projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DB_REQUEST, projectDir, scope, appId, op, args),

  kvRequest: (projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_KV_REQUEST, projectDir, scope, appId, op, args),

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

const browserHostAPI = {
  onAutomationCall: (
    callback: (req: { callId: string; sessionId: string; op: string; input: unknown }) => void,
  ) => {
    const handler = (_e: Electron.IpcRendererEvent, req: { callId: string; sessionId: string; op: string; input: unknown }) =>
      callback(req)
    ipcRenderer.on(AgentIpcChannels.BROWSER_AUTOMATION_CALL, handler)
    return () => ipcRenderer.removeListener(AgentIpcChannels.BROWSER_AUTOMATION_CALL, handler)
  },
  sendAutomationResult: (callId: string, ok: boolean, result?: unknown, error?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.BROWSER_AUTOMATION_RESULT, callId, ok, result, error),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('agent', agentAPI)
    contextBridge.exposeInMainWorld('terminal', terminalAPI)
    contextBridge.exposeInMainWorld('app', appAPI)
    contextBridge.exposeInMainWorld('environment', environmentAPI)
    contextBridge.exposeInMainWorld('miniapp', miniappAPI)
    contextBridge.exposeInMainWorld('browserHost', browserHostAPI)
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
  window.environment = environmentAPI
  // @ts-ignore
  window.miniapp = miniappAPI
  // @ts-ignore
  window.browserHost = browserHostAPI
}
