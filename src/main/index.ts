import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, powerMonitor, protocol, screen, session, shell } from 'electron'
import { join, dirname, basename, resolve, extname, relative, isAbsolute, sep } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, readdir, rename, cp, rm, access, stat, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { resolveRealPath, isPathWithinAllowed, sanitizeGitRef, getReadableAssetRoots } from './path-security'
import { execFileSync, spawn } from 'child_process'
import { gitRun } from './git-run'
import { activateWorktree, getCheckedOutBranches, getWorktreeInfo, gitErrorMessage } from './git/worktree-ops'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { startMediaServer, getMediaServerPort } from './media-server'
import { getAppBasePath, cacheAppEntry, getAppInstallDir, generateCSP, readManifest, validatePath, discoverApps, setAllowedDirectories, clearAllowedDirectories, handleFsRequest, handleGitRequest, discoverProjectApps, startWatch, stopWatch, onFsWatchEvent, onGitHeadChangeEvent, getAllowedDirs, resolveSafePathMulti, setAllowedMedia, clearAllowedMedia, isMediaAllowed, appIdFromUrl } from './miniapp/miniapp-service'
import { generateBridgeScript, generatePopoverBridgeScript, generateToolInterceptBridgeScript, generateToolResultBridgeScript } from './miniapp/miniapp-bridge'
import { previewApp, confirmInstall, cancelInstall, uninstallApp, packApp, getInstallMeta, getPreapproved, getPreapprovedByPath, setPreapproved, setPreapprovedByPath } from './miniapp/miniapp-packager'
import { previewMcpbBundle, installMcpbBundle, uninstallMcpbBundle, listInstalledMcpb, revealMcpbBundle } from './mcpb/mcpb-installer'
import { initSuperoneMcpServer, registerAppTools, unregisterAppTools, resolveToolCall, rejectToolCall, notifyAppReady as notifyMiniAppReady, registerInChatApp, loadPreapprovedTools, updatePreapprovedTools, registerAppTemplates, unregisterAppTemplates, submitToolIntercept, cancelToolIntercept, clearAllPendingCalls as clearAllPendingMiniAppCalls } from './mcp/superone-mcp-server'
import { startMcpHttpServer, stopMcpHttpServer } from './mcp/superone-mcp-http'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { resolveSdkClaudeBinary } from './agent/claude-binary'
import { fixPath } from './agent/resolve-cli'
import { AgentService } from './agent/agent-service'
import { SessionManagerImpl } from './session/session-manager'
import { DeviceRegistry } from './remote/device-registry'
import { MobileBroadcaster } from './remote/mobile-broadcaster'
import { PresenceCoordinator } from './remote/presence-coordinator'
import { loadSessionStateBySid, saveSessionStateBySid, updateProviderSessionId } from './session/session-repo'
import { buildProviderEnv } from './agent/provider-env'
import type { SessionProvider } from './session/types'
import {
  AgentIpcChannels,
  type CodexCollaborationMode,
  type CodexPermissionPreset,
  type CodexReasoningEffort,
  type CodexReviewTarget,
  type CodexRunResult,
  type AgentEvent,
  type CodexThreadItem,
  type CodexUsageInfo,
  type CodexSetAuthRequest,
  type ImageAttachment,
  type ClaudeResources,
  type CodexResources,
  type StartupData,
  type FileTreeEntry,
  type GitFileStatus,
  type FileOpResult,
} from '../shared/agent-types'
import { initUpdater, installUpdate, checkForUpdates, simulateUpdate, simulateNotAvailable, getUpdaterState, getUpdateMenuState, setOnMenuChange, disposeUpdater } from './updater'
import { startWatching, stopWatching } from './file-watcher'
import { notifyWidgetReady, clearAllGates } from './generative-ui/widget-gate'
import { setBashOutputWindow, watchBashOutput, unwatchBashOutput, unwatchAll as unwatchAllBashOutputs, readBashOutputTail, getWatchedFilePath } from './bash-output-watcher'
import { parseGitStatusOutput, parseGitStatusFiles } from './git-status-utils'
import { mapModelInfo } from './agent/claude-models'
import { getRecentFolders, addRecentFolder, removeRecentFolder } from './recent-folders'
import { getDb, closeDb, getCachedHarnessResources, setCachedHarnessResources, upsertPairedDevice, listPairedDevices, deletePairedDevice, isPairedDevice, getActiveProviderRaw } from './database'
import { backfillFromHistory, getBackfillStatus, queryCounts, queryUsage } from './usage-stats-service'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents, discoverCodexUserPrompts } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'
import { CodexPluginsService } from './codex/codex-plugins-service'
import { deleteCodexMcpConfig, saveCodexMcpConfig, toggleCodexMcpConfig } from './codex-config-service'
import { setCodexServiceFactory } from './session/backends/codex-backend'
import { AutomationService } from './automation-service'
import { listAutomationsForProject, createAutomation as dbCreateAutomation, updateAutomation as dbUpdateAutomation, deleteAutomation as dbDeleteAutomation } from './db-automations'
import { trace, closeTraceDb } from './agent/event-trace'
import { RemoteControlService } from './remote-control-service'
import { readProjectPreferences, saveProjectPreferences } from './claude-preferences-service'
import { readAppSettings, saveAppSettings } from './app-settings-service'
import { applyLocale, getSystemLocale, getCurrentLocale, initMainI18n } from './i18n'
import type { RemoteCommand, PairedDevice, CreateAutomationRequest, RemoteDeviceConfig, UpdateAutomationRequest, ChatMessageContext, ContentBlock, WorktreeActivateRequest } from '../shared/agent-types'
import { buildRemoteActiveProvider } from '../shared/provider-utils'
import type { RemoteControlCallbacks } from './remote-control-service'


protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'superone-app', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, standard: true } },
  { scheme: 'superone-fs', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, standard: true } },
])

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

if (is.dev) {
  app.setPath('userData', join(process.cwd(), '.dev-data'))
} else if (process.env.SUPERONE_INSTANCE) {
  app.setPath('userData', join(app.getPath('userData'), `instance-${process.env.SUPERONE_INSTANCE}`))
}

const agentService = new AgentService()
const codexService = new CodexExperimentService()
const codexPluginsService = new CodexPluginsService(codexService)
setCodexServiceFactory(() => codexService)
const automationService = new AutomationService()
function resolveBaseProviderConfig(provider: SessionProvider): unknown {
  if (!provider.isBase) return provider.config
  const activeApiProvider = getActiveProviderRaw(provider.harnessId)
  if (!activeApiProvider) return provider.config
  const env = buildProviderEnv(activeApiProvider, provider.harnessId)
  const { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ...extraEnv } = env
  return {
    apiKey: ANTHROPIC_API_KEY,
    baseUrl: ANTHROPIC_BASE_URL,
    extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
  }
}

const sessionManager = new SessionManagerImpl({
  resolveProviderConfig: resolveBaseProviderConfig,
  onSessionStateChange: (snapshot) => {
    try {
      saveSessionStateBySid({
        sid: snapshot.sid,
        projectPath: snapshot.projectPath,
        providerId: snapshot.providerId,
        messages: snapshot.messages,
        totalCostUsd: snapshot.totalCostUsd,
        contextTokens: snapshot.contextTokens,
        title: snapshot.title ?? undefined,
        isWorktree: snapshot.isWorktree,
        worktreePath: snapshot.worktreePath,
        gitBranch: snapshot.gitBranch,
      })
    } catch (err) {
      log.warn('[sessionManager] saveSessionStateBySid failed:', err)
    }
  },
  onProviderSessionIdChange: (sid, providerSessionId) => {
    try {
      updateProviderSessionId(sid, providerSessionId)
    } catch (err) {
      log.warn('[sessionManager] updateProviderSessionId failed:', err)
    }
  },
  loadSession: (sessionId) => {
    const loaded = loadSessionStateBySid(sessionId)
    if (!loaded) return null
    return {
      projectPath: loaded.record.projectPath,
      providerId: loaded.record.providerId,
      providerSessionId: loaded.record.providerSessionId,
      messages: loaded.messages,
      totalCostUsd: loaded.record.totalCostUsd,
      contextTokens: loaded.record.contextTokens,
      worktreePath: loaded.record.worktreePath,
      gitBranch: loaded.record.gitBranch,
    }
  },
  getActiveProvider: (harnessId) => buildRemoteActiveProvider(getActiveProviderRaw(harnessId), harnessId),
  onBeforeInterrupt: () => {
    clearAllGates()
    clearAllPendingMiniAppCalls()
  },
})
sessionManager.onAny((_sid, event) => {
  if (event.type === 'permission_request') {
    const alive = !!mainWindow && !mainWindow.isDestroyed()
    log.info('[onAny] permission_request sid=%s sessionId=%s projectPath=%s windowAlive=%s requestId=%s',
      _sid, event.sessionId ?? '(none)', event.projectPath ?? '(none)', alive, event.request.requestId)
  }
  agentService.notifyEventSubscribers(event)
  safeSend(AgentIpcChannels.EVENT, event)
})
const deviceRegistry = new DeviceRegistry(sessionManager)
const remoteCallbacks: RemoteControlCallbacks = {
  onCommand: async (command, respond, source) => {
    await agentService.handleRemoteCommand(command, respond, source)
    safeSend(AgentIpcChannels.REMOTE_COMMAND, command)
    if (command.type === 'add_project') {
      const folders = getRecentFolders()
      safeSend(AgentIpcChannels.RECENT_FOLDERS_CHANGED, folders)
    }
  },
  onClientRegistered: ({ deviceName, deviceId, transport, firstConnect }) => {
    upsertPairedDevice(deviceId, deviceName)
    safeSend(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: deviceId, online: true, name: deviceName, transport, firstConnect })
  },
  onClientDisconnected: ({ deviceId }) => {
    safeSend(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: deviceId, online: false })
    deviceRegistry.handleDeviceDisconnected(deviceId)
  },
  onPairingCodeReceived: ({ code, deviceName }) => {
    safeSend(AgentIpcChannels.REMOTE_PAIRING_CODE_RECEIVED, { code, deviceName })
  },
  onPairingExpired: () => {
    safeSend(AgentIpcChannels.REMOTE_PAIRING_EXPIRED)
  },
  onPairingConfirmed: ({ mobileDeviceId, deviceName }) => {
    upsertPairedDevice(mobileDeviceId, deviceName)
    safeSend(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: mobileDeviceId, online: false })
  },
  onPairingAlreadyPaired: ({ deviceName }) => {
    safeSend(AgentIpcChannels.REMOTE_PAIRING_ALREADY_PAIRED, { deviceName })
  },
  onRelayStatusChanged: (connected) => {
    safeSend(AgentIpcChannels.REMOTE_RELAY_STATUS, connected)
  },
  isPairedDevice: (deviceId) => isPairedDevice(deviceId),
}
declare const __CF_RELAY_URL__: string
const remoteControlService = new RemoteControlService(__CF_RELAY_URL__, remoteCallbacks)
let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('Main window not created yet')
  return mainWindow
}

function safeSend(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

new PresenceCoordinator(sessionManager, {
  broadcastToRenderer: (event) => safeSend(AgentIpcChannels.EVENT, event),
  sendToMobile: (event, targetDeviceIds) => remoteControlService.sendEventToMobile(event, targetDeviceIds),
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      webviewTag: true,
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.control || input.meta) {
      if (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0') {
        _e.preventDefault()
        const action = input.key === '-' ? 'out' : input.key === '0' ? 'reset' : 'in'
        mainWindow?.webContents.send(AgentIpcChannels.CONTENT_ZOOM, action)
        return
      }
    }
    if (!is.dev) {
      if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        _e.preventDefault()
        return
      }
      if (input.key === 'F5') {
        _e.preventDefault()
      }
    }
  })

  // Update agentService's window reference for event forwarding
  agentService.setMainWindow(mainWindow)
  agentService.setSessionManager(sessionManager)
  automationService.setMainWindow(mainWindow)
  automationService.setAgentService(agentService)
  automationService.start()
  setBashOutputWindow(mainWindow)

  mainWindow.on('closed', () => {
    unwatchAllBashOutputs()
  })

  // Fullscreen state (window-specific, re-binds per window)
  mainWindow.on('enter-full-screen', () => {
    safeSend(AgentIpcChannels.FULLSCREEN_CHANGED, true)
  })
  mainWindow.on('leave-full-screen', () => {
    safeSend(AgentIpcChannels.FULLSCREEN_CHANGED, false)
  })

  if (is.dev && !process.env.SUPERONE_E2E) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Register all IPC handlers once at app startup. */
function setAppFsPermissions(appId: string, manifest: { permissions?: { fs?: Array<{ scope: string; path?: string; access?: string; reason: string }> } }, projectDir: string, installDir: string): void {
  const fsEntries = manifest.permissions?.fs ?? []
  if (fsEntries.length === 0) return
  const dirs = fsEntries.flatMap((entry) => {
    switch (entry.scope) {
      case 'project': return [{ path: join(projectDir, entry.path!), access: entry.access as 'read' | 'readwrite' } as const]
      case 'user': return [{ path: join(homedir(), entry.path!), access: entry.access as 'read' | 'readwrite' } as const]
      case 'app': return [{ path: join(installDir, 'data'), access: 'readwrite' as const }]
      default: return []
    }
  })
  setAllowedDirectories(appId, dirs)
}

function setAppMediaPermissions(appId: string, manifest: { permissions?: { media?: Array<{ kind: import('../shared/miniapp-types').MiniAppMediaKind; reason: string }> } }): void {
  const entries = manifest.permissions?.media ?? []
  setAllowedMedia(appId, entries.map((e) => e.kind))
}


function getOrCreateCodexSession(sessionId: string, projectPath: string, cwd?: string, gitBranch?: string | null) {
  const existing = sessionManager.getSession(sessionId)
  if (existing) {
    if (existing.snapshot.harnessId !== 'codex') {
      throw new Error(`Session ${sessionId} is not a codex session (harness=${existing.snapshot.harnessId})`)
    }
    sessionManager.setActiveSession(projectPath, existing.snapshot.id)
    return existing
  }
  const fresh = sessionManager.createSession({
    projectPath,
    id: sessionId,
    providerId: 'codex-base',
    cwd,
    gitBranch: gitBranch ?? null,
  })
  return fresh
}

function getCodexSession(sessionId: string): ReturnType<typeof sessionManager.getSession> {
  const existing = sessionManager.getSession(sessionId)
  if (!existing || existing.snapshot.harnessId !== 'codex') return null
  return existing
}

async function runCodexTurnViaSessionManager(
  session: ReturnType<typeof sessionManager.getSession> & object,
  assistantMessageId: string,
  request: Parameters<typeof session.send>[0],
): Promise<CodexRunResult> {
  let captured: CodexRunResult | null = null
  let turnError: Error | null = null
  const unsub = session.on((ev) => {
    if (!('messageId' in ev) || (ev as { messageId?: string }).messageId !== assistantMessageId) return
    if (ev.type === 'message_complete') {
      const meta = (ev.metadata as Record<string, unknown> | undefined)?.codex as Record<string, unknown> | undefined
      captured = {
        threadId: (meta?.threadId as string | null | undefined) ?? null,
        finalResponse: (meta?.finalResponse as string | undefined) ?? '',
        usage: (meta?.usage as CodexUsageInfo | null | undefined) ?? null,
        items: (meta?.items as CodexThreadItem[] | undefined) ?? [],
      }
    } else if (ev.type === 'message_error') {
      turnError = new Error(ev.error || 'Codex run failed')
    } else if (ev.type === 'message_interrupted') {
      turnError = new Error('Codex run interrupted')
    }
  })
  try {
    await session.send(request)
    if (turnError) throw turnError
    return captured ?? { threadId: null, finalResponse: '', usage: null, items: [] }
  } finally {
    unsub()
  }
}

function registerIpcHandlers(): void {
  // Setup agent IPC handlers (does NOT auto-initialize)
  agentService.setCodexListModels((projectPath) => codexService.listModels(projectPath))
  agentService.setCodexGetAuthStatus((projectPath) => codexService.getAuthStatus(projectPath))
  agentService.setup()

  ipcMain.on(AgentIpcChannels.TRACE, (_e, source: string, type: string, data: unknown, tag?: string) => {
    trace(source, type, data, tag)
  })

  // App-level IPC handlers
  ipcMain.handle(AgentIpcChannels.SELECT_FOLDER, async (_e, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory', 'createDirectory'],
      ...(defaultPath ? { defaultPath } : {}),
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(AgentIpcChannels.GET_RECENT_FOLDERS, () => {
    return getRecentFolders()
  })

  ipcMain.handle(AgentIpcChannels.ADD_RECENT_FOLDER, (_event, folderPath: string) => {
    if (!existsSync(folderPath)) return false
    addRecentFolder(folderPath)
    return true
  })

  ipcMain.handle(AgentIpcChannels.REMOVE_RECENT_FOLDER, (_event, folderPath: string) => {
    removeRecentFolder(folderPath)
    return getRecentFolders()
  })

  ipcMain.handle(AgentIpcChannels.OPEN_FOLDER, async (_event, folderPath: string) => {
    if (!existsSync(folderPath)) return false
    if (!existsSync(join(folderPath, '.git'))) {
      try {
        execFileSync('git', ['init'], { cwd: folderPath })
      } catch (err) {
        log.warn('[OPEN_FOLDER] git init failed for %s: %s', folderPath, err instanceof Error ? err.message : String(err))
      }
    }
    addRecentFolder(folderPath)
    await agentService.openFolder(folderPath)
    codexService.prewarmAppServerConnection(folderPath)
    return true
  })

  ipcMain.handle(AgentIpcChannels.OPEN_TMP_FOLDER, async () => {
    const tmpPath = join(app.getPath('userData'), 'tmp')
    if (!existsSync(tmpPath)) mkdirSync(tmpPath, { recursive: true })
    await agentService.openFolder(tmpPath) // Additive
    codexService.prewarmAppServerConnection(tmpPath)
    return tmpPath
  })

  ipcMain.handle(AgentIpcChannels.CLOSE_PROJECT, async (_event, folderPath: string) => {
    await agentService.closeProject(folderPath)
    codexService.closeProject(folderPath)
    gitStatusSnapshotCache.delete(folderPath)
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_RUN,
    async (
      _event,
      sessionId: string,
      projectPath: string,
      prompt: string,
      model?: string,
      reasoningEffort?: CodexReasoningEffort,
      permissionPreset?: CodexPermissionPreset,
      collaborationMode?: CodexCollaborationMode,
      threadId?: string,
      messageId?: string,
      images?: ImageAttachment[],
      cwd?: string,
      userMessageId?: string,
      userMessageText?: string,
      gitBranch?: string,
      worktreePath?: string,
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] },
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const persistedUserMessageId = userMessageId ?? `user_${Date.now()}`
      const session = getOrCreateCodexSession(sessionId, projectPath, cwd, gitBranch)
      return runCodexTurnViaSessionManager(session, assistantMessageId, {
        content: userMessageText ?? prompt,
        model,
        images,
        clientMessageId: persistedUserMessageId,
        assistantMessageId,
        gitBranch,
        worktreePath,
        ...(extras?.userMessageContent ? { userMessageContent: extras.userMessageContent } : {}),
        ...(extras?.contexts ? { contexts: extras.contexts } : {}),
        ...(extras?.userSelections ? { userSelections: extras.userSelections } : {}),
        codex: {
          mode: 'run',
          prompt,
          reasoningEffort,
          permissionPreset,
          collaborationMode,
          threadId,
          cwd,
        },
      })
    },
  )

  ipcMain.handle(AgentIpcChannels.CODEX_LIST_MODELS, async (_event, projectPath: string) => {
    const models = await codexService.listModels(projectPath)
    const current = getCachedHarnessResources('codex')
    setCachedHarnessResources('codex', { models, prompts: current?.prompts ?? [] })
    log.debug('[CODEX_LIST_MODELS] project=%s models=%s', projectPath, JSON.stringify(models))
    return models
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_AUTH_STATUS, (_event, projectPath: string) => {
    return codexService.getAuthStatus(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_SET_AUTH, (_event, projectPath: string, request: CodexSetAuthRequest) => {
    return codexService.setAuth(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_LIST, (_event, projectPath: string) => {
    return codexPluginsService.listPlugins(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_READ, (_event, projectPath: string, key: string) => {
    return codexPluginsService.readPlugin(projectPath, key)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_READ_FILE, (_event, projectPath: string, key: string, relativePath: string) => {
    return codexPluginsService.readPluginFile(projectPath, key, relativePath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_DELETE, async (_event, projectPath: string, key: string) => {
    await codexPluginsService.uninstallPlugin(projectPath, key)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_LIST_MARKETPLACE, (_event, projectPath: string) => {
    return codexPluginsService.listMarketplacePlugins(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_INSTALL, async (_event, projectPath: string, key: string) => {
    await codexPluginsService.installPlugin(projectPath, key)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_SAVE_CONFIG, (_event, projectPath: string, name: string, config: Record<string, unknown>, scope: 'user' | 'project') => {
    saveCodexMcpConfig(name, config, scope, projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_DELETE_CONFIG, (_event, projectPath: string, name: string, scope: 'user' | 'project') => {
    deleteCodexMcpConfig(name, scope, projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_TOGGLE_CONFIG, (_event, projectPath: string, name: string, disabled: boolean, scope: 'user' | 'project') => {
    toggleCodexMcpConfig(name, disabled, scope, projectPath)
  })

  ipcMain.handle(AgentIpcChannels.MCPB_PREVIEW, (_event, filePath: string) => {
    return previewMcpbBundle(filePath)
  })

  ipcMain.handle(AgentIpcChannels.MCPB_INSTALL, (_event, request: Parameters<typeof installMcpbBundle>[0]) => {
    return installMcpbBundle(request)
  })

  ipcMain.handle(AgentIpcChannels.MCPB_UNINSTALL, (_event, name: string) => {
    return uninstallMcpbBundle(name)
  })

  ipcMain.handle(AgentIpcChannels.MCPB_LIST, () => {
    return listInstalledMcpb()
  })

  ipcMain.handle(AgentIpcChannels.MCPB_REVEAL, (_event, name: string) => {
    return revealMcpbBundle(name)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLAN_APPROVAL, (_event, _projectPath: string, sessionId: string, messageId: string, status: 'approved' | 'rejected', feedback?: string) => {
    return getCodexSession(sessionId)?.dispatchBackendCommand({
      kind: 'codex.plan_approval',
      messageId,
      status,
      ...(feedback ? { feedback } : {}),
    })
  })

  ipcMain.handle(AgentIpcChannels.CODEX_COLLABORATION_MODE_CHANGE, (_event, _projectPath: string, sessionId: string, mode: string) => {
    return getCodexSession(sessionId)?.dispatchBackendCommand({ kind: 'codex.collaboration_mode_change', mode })
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_STEER,
    (_event, sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string) => {
      const existing = getCodexSession(sessionId)
      if (!existing) throw new Error(`CODEX_STEER: no codex session found for sid=${sessionId}`)
      return existing.dispatchBackendCommand({
        kind: 'codex.steer',
        input,
        newAssistantMessageId: messageId ?? `codex_${Date.now()}`,
        newUserMessageId: userMessageId ?? `user_${Date.now()}`,
        newUserText: userMessageText ?? input,
      })
    },
  )

  ipcMain.handle(
    AgentIpcChannels.CODEX_REVIEW,
    async (
      _event,
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] },
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const session = getOrCreateCodexSession(sessionId, projectPath, cwd, gitBranch)
      return runCodexTurnViaSessionManager(session, assistantMessageId, {
        content: userMessageText ?? '/review',
        model,
        clientMessageId: userMessageId ?? `user_${Date.now()}`,
        assistantMessageId,
        gitBranch,
        worktreePath,
        ...(extras?.userMessageContent ? { userMessageContent: extras.userMessageContent } : {}),
        ...(extras?.contexts ? { contexts: extras.contexts } : {}),
        ...(extras?.userSelections ? { userSelections: extras.userSelections } : {}),
        codex: {
          mode: 'review',
          reviewTarget: target,
          reasoningEffort,
          permissionPreset,
          threadId,
          cwd,
        },
      })
    },
  )

  ipcMain.handle(
    AgentIpcChannels.CODEX_COMPACT,
    async (
      _event,
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[] },
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const session = getOrCreateCodexSession(sessionId, projectPath, cwd, gitBranch)
      return runCodexTurnViaSessionManager(session, assistantMessageId, {
        content: userMessageText ?? '/compact',
        model,
        clientMessageId: userMessageId ?? `user_${Date.now()}`,
        assistantMessageId,
        gitBranch,
        worktreePath,
        ...(extras?.userMessageContent ? { userMessageContent: extras.userMessageContent } : {}),
        ...(extras?.contexts ? { contexts: extras.contexts } : {}),
        ...(extras?.userSelections ? { userSelections: extras.userSelections } : {}),
        codex: {
          mode: 'compact',
          permissionPreset,
          threadId,
          cwd,
        },
      })
    },
  )

  ipcMain.handle(AgentIpcChannels.GIT_INFO, async (_event, folderPath: string) => {
    try {
      let branch: string
      try {
        branch = await gitRun(folderPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      } catch {
        const ref = await gitRun(folderPath, ['symbolic-ref', 'HEAD'])
        branch = ref.replace('refs/heads/', '')
      }
      const status = await gitRun(folderPath, ['status', '--porcelain'])
      const files = status ? status.split('\n').filter(Boolean).length : 0
      let insertions = 0
      let deletions = 0
      if (files > 0) {
        try {
          const shortstat = await gitRun(folderPath, ['diff', 'HEAD', '--shortstat'])
          const insMatch = shortstat.match(/(\d+) insertion/)
          const delMatch = shortstat.match(/(\d+) deletion/)
          if (insMatch) insertions = parseInt(insMatch[1])
          if (delMatch) deletions = parseInt(delMatch[1])
        } catch {
          /* no HEAD yet or no tracked changes */
        }
      }
      return {
        branch,
        ...(files > 0 ? { dirty: { files, insertions, deletions } } : {}),
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_LIST_BRANCHES, async (_event, folderPath: string) => {
    try {
      const raw = await gitRun(folderPath, ['branch', '--format=%(refname:short)'])
      return raw.split('\n').filter(Boolean)
    } catch {
      return []
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_LOG, async (_event, folderPath: string, query?: string) => {
    try {
      const normalizedQuery = query?.trim().toLowerCase()
      const args = normalizedQuery
        ? ['log', '--format=%H%x00%P%x00%s%x00%an%x00%ai']
        : ['log', '--format=%H%x00%P%x00%s%x00%an%x00%ai', '-50']
      const raw = await gitRun(folderPath, args)
      if (!raw) return []
      const entries = raw.split('\n').filter(Boolean).map((line) => {
        const [sha, parents, message, author, date] = line.split('\0')
        return { sha, parents: parents ? parents.split(' ') : [], message, author, date }
      })
      if (!normalizedQuery) return entries
      return entries
        .filter((entry) =>
          entry.sha.toLowerCase().includes(normalizedQuery)
          || entry.message.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 50)
    } catch {
      return []
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_SWITCH_BRANCH, async (_event, folderPath: string, branch: string) => {
    try {
      await gitRun(folderPath, ['checkout', sanitizeGitRef(branch)])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_CREATE_BRANCH, async (_event, folderPath: string, branch: string) => {
    const safeRef = sanitizeGitRef(branch)
    try {
      await gitRun(folderPath, ['rev-parse', '--verify', 'HEAD'])
    } catch {
      return { ok: false, error: 'Cannot create a new branch before the first commit. Commit once, then create the branch.' }
    }
    try {
      await gitRun(folderPath, ['checkout', '-b', safeRef])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.PATH_EXISTS, async (_event, p: string) => {
    const { existsSync } = await import('node:fs')
    return existsSync(p)
  })

  ipcMain.handle(AgentIpcChannels.GIT_WORKTREE_INFO, async (_event, folderPath: string) => {
    return getWorktreeInfo(folderPath)
  })

  ipcMain.handle(AgentIpcChannels.GIT_SWITCH_WORKTREE, async (_event, folderPath: string, wtPath: string, gitBranch: string | null) => {
    try {
      if (!existsSync(wtPath)) return { ok: false as const, error: 'Worktree path not found' }
      await agentService.switchCwd(folderPath, wtPath, gitBranch)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_CHECKED_OUT_BRANCHES, async (_event, folderPath: string) => {
    return getCheckedOutBranches(folderPath)
  })

  ipcMain.handle(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, async (_event, folderPath: string, request: WorktreeActivateRequest | null) => {
    try {
      if (request === null) {
        await agentService.switchCwd(folderPath, folderPath, null)
        return { ok: true as const, path: folderPath }
      }
      const result = await activateWorktree(folderPath, request)
      await agentService.switchCwd(folderPath, result.path, result.recordedBranch)
      return { ok: true as const, path: result.path }
    } catch (err) {
      return { ok: false as const, error: gitErrorMessage(err) }
    }
  })

  const EXT_LANG: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.md': 'markdown',
    '.sh': 'bash', '.sql': 'sql', '.swift': 'swift', '.kt': 'kotlin',
    '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.php': 'php',
  }

  ipcMain.handle(AgentIpcChannels.GIT_STATUS_FILES, async (_event, folderPath: string) => {
    try {
      const raw = await gitRun(folderPath, ['status', '--porcelain=v1'])
      if (!raw) return []
      return parseGitStatusFiles(raw)
    } catch {
      return []
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_DIFF_FILE, async (_event, folderPath: string, filePath: string, staged: boolean) => {
    try {
      const args = staged
        ? ['diff', '--cached', '--', filePath]
        : ['diff', '--', filePath]
      const diff = await gitRun(folderPath, args)
      return { path: filePath, diff }
    } catch {
      return { path: filePath, diff: '' }
    }
  })

  const BINARY_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
  const PDF_EXTS = new Set(['.pdf'])
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov'])
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg'])

  ipcMain.handle(AgentIpcChannels.GIT_READ_FILE, async (_event, folderPath: string, filePath: string) => {
    try {
      const ext = extname(filePath).toLowerCase()
      if (BINARY_IMAGE_EXTS.has(ext)) return { path: filePath, content: '', language: 'image' }
      if (PDF_EXTS.has(ext)) return { path: filePath, content: '', language: 'pdf' }
      if (VIDEO_EXTS.has(ext)) return { path: filePath, content: '', language: 'video' }
      if (AUDIO_EXTS.has(ext)) return { path: filePath, content: '', language: 'audio' }
      const fullPath = resolveRealPath(isAbsolute(filePath) ? filePath : join(folderPath, filePath))
      if (!isAbsolute(filePath) && !isPathWithinAllowed(fullPath, [folderPath])) {
        return { path: filePath, content: '', language: 'text' }
      }
      const content = await readFile(fullPath, 'utf-8')
      if (ext === '.svg') return { path: filePath, content, language: 'svg' }
      const language = EXT_LANG[ext] ?? 'text'
      return { path: filePath, content, language }
    } catch {
      return { path: filePath, content: '', language: 'text' }
    }
  })

  ipcMain.handle(AgentIpcChannels.SAVE_FILE, async (_event, folderPath: string, filePath: string, content: string) => {
    try {
      const fullPath = validatePathInProject(folderPath, isAbsolute(filePath) ? filePath : join(folderPath, filePath))
      await writeFile(fullPath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  const SKIP_DIRS = new Set(['.git'])

  const GIT_STATUS_PRIORITY: Record<string, number> = { D: 4, M: 3, A: 2, '?': 1 }

  function worstGitStatus(children: FileTreeEntry[]): GitFileStatus | null {
    let worst: GitFileStatus | null = null
    let worstPri = 0
    for (const child of children) {
      const s = child.gitStatus
      if (!s) continue
      const pri = GIT_STATUS_PRIORITY[s] ?? 0
      if (pri > worstPri) { worst = s; worstPri = pri }
    }
    return worst
  }

  ipcMain.handle(AgentIpcChannels.GIT_FILE_TREE, async (_event, folderPath: string) => {
    try {
      let statusMap = new Map<string, GitFileStatus>()
      let ignoredDirs = new Set<string>()
      try {
        const raw = await gitRun(folderPath, ['status', '--porcelain=v1', '--ignored'])
        if (raw) {
          const parsed = parseGitStatusOutput(raw)
          statusMap = parsed.statusMap
          ignoredDirs = parsed.ignoredDirs
        }
      } catch { /* not a git repo or no commits */ }

      async function walk(dir: string, parentIgnored = false): Promise<FileTreeEntry[]> {
        const entries = await readdir(dir, { withFileTypes: true })
        const result: FileTreeEntry[] = []

        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })

        for (const entry of sorted) {
          if (SKIP_DIRS.has(entry.name)) continue
          if (entry.name === '.DS_Store') continue

          const fullPath = join(dir, entry.name)
          const relPath = relative(folderPath, fullPath)
          const isIgnored = parentIgnored || ignoredDirs.has(relPath) || statusMap.get(relPath) === '!'

          if (entry.isDirectory()) {
            const children = await walk(fullPath, isIgnored)
            result.push({
              name: entry.name,
              path: relPath,
              isDirectory: true,
              children,
              gitStatus: isIgnored ? '!' : worstGitStatus(children),
            })
          } else {
            result.push({
              name: entry.name,
              path: relPath,
              isDirectory: false,
              gitStatus: isIgnored ? '!' : (statusMap.get(relPath) ?? null),
            })
          }
        }
        return result
      }

      return await walk(folderPath)
    } catch {
      return []
    }
  })

  const GIT_STATUS_CACHE_TTL_MS = 1500
  const gitStatusSnapshotCache = new Map<string, { at: number; statusMap: Map<string, GitFileStatus>; ignoredDirs: Set<string> }>()
  const gitStatusInFlight = new Map<string, Promise<{ statusMap: Map<string, GitFileStatus>; ignoredDirs: Set<string> }>>()

  async function getGitStatusMap(folderPath: string) {
    const now = Date.now()
    const cached = gitStatusSnapshotCache.get(folderPath)
    if (cached && now - cached.at < GIT_STATUS_CACHE_TTL_MS) {
      return { statusMap: cached.statusMap, ignoredDirs: cached.ignoredDirs }
    }
    const inFlight = gitStatusInFlight.get(folderPath)
    if (inFlight) return inFlight

    const promise = (async () => {
      let statusMap = new Map<string, GitFileStatus>()
      let ignoredDirs = new Set<string>()
      try {
        const raw = await gitRun(folderPath, ['status', '--porcelain=v1', '--ignored'])
        if (raw) {
          const parsed = parseGitStatusOutput(raw)
          statusMap = parsed.statusMap
          ignoredDirs = parsed.ignoredDirs
        }
      } catch { /* not a git repo or no commits */ }
      gitStatusSnapshotCache.set(folderPath, { at: Date.now(), statusMap, ignoredDirs })
      return { statusMap, ignoredDirs }
    })()

    gitStatusInFlight.set(folderPath, promise)
    try {
      return await promise
    } finally {
      if (gitStatusInFlight.get(folderPath) === promise) {
        gitStatusInFlight.delete(folderPath)
      }
    }
  }

  function dirGitStatus(statusMap: Map<string, GitFileStatus>, dirRelPath: string): GitFileStatus | null {
    const prefix = dirRelPath + '/'
    let worst: GitFileStatus | null = null
    let worstPri = 0
    for (const [path, status] of statusMap) {
      if (path.startsWith(prefix) && status !== '!') {
        const pri = GIT_STATUS_PRIORITY[status] ?? 0
        if (pri > worstPri) { worst = status; worstPri = pri }
      }
    }
    return worst
  }

  ipcMain.handle(AgentIpcChannels.GIT_LIST_DIR, async (_event, folderPath: string, dirRelPath: string) => {
    try {
      const { statusMap, ignoredDirs } = await getGitStatusMap(folderPath)
      const targetDir = dirRelPath ? join(folderPath, dirRelPath) : folderPath
      const entries = await readdir(targetDir, { withFileTypes: true })

      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      const result: FileTreeEntry[] = []
      for (const entry of sorted) {
        if (SKIP_DIRS.has(entry.name) || entry.name === '.DS_Store') continue
        const relPath = dirRelPath ? dirRelPath + '/' + entry.name : entry.name
        const isIgnored = ignoredDirs.has(relPath) || statusMap.get(relPath) === '!'

        if (entry.isDirectory()) {
          result.push({
            name: entry.name,
            path: relPath,
            isDirectory: true,
            children: undefined,
            gitStatus: isIgnored ? '!' : dirGitStatus(statusMap, relPath),
          })
        } else {
          result.push({
            name: entry.name,
            path: relPath,
            isDirectory: false,
            gitStatus: isIgnored ? '!' : (statusMap.get(relPath) ?? null),
          })
        }
      }
      return result
    } catch (err) {
      log.error('[GIT_LIST_DIR] error:', err)
      return []
    }
  })

  function validatePathInProject(folderPath: string, relPath: string): string {
    const normalizedFolder = resolve(folderPath)
    const absPath = resolve(folderPath, relPath)
    if (!absPath.startsWith(normalizedFolder + sep) && absPath !== normalizedFolder) {
      throw new Error('Path escapes project directory')
    }
    return absPath
  }

  ipcMain.handle(AgentIpcChannels.FILE_MOVE, async (_event, folderPath: string, srcRelPath: string, destDirRelPath: string): Promise<FileOpResult> => {
    try {
      const srcAbs = validatePathInProject(folderPath, srcRelPath)
      const destDirAbs = validatePathInProject(folderPath, destDirRelPath)
      const destAbs = join(destDirAbs, basename(srcAbs))
      try {
        await access(destAbs)
        return { ok: false, error: `Target already exists: ${basename(srcAbs)}` }
      } catch { /* target doesn't exist, good */ }
      await rename(srcAbs, destAbs)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.FILE_COPY_IN, async (_event, folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult> => {
    try {
      const destDirAbs = validatePathInProject(folderPath, destDirRelPath)
      for (const srcPath of absolutePaths) {
        const name = basename(srcPath)
        const destAbs = join(destDirAbs, name)
        try {
          await access(destAbs)
          return { ok: false, error: `Target already exists: ${name}` }
        } catch { /* doesn't exist, good */ }
        await cp(srcPath, destAbs, { recursive: true })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.FILE_MOVE_IN, async (_event, folderPath: string, destDirRelPath: string, absolutePaths: string[]): Promise<FileOpResult> => {
    try {
      const destDirAbs = validatePathInProject(folderPath, destDirRelPath)
      for (const srcPath of absolutePaths) {
        const name = basename(srcPath)
        const destAbs = join(destDirAbs, name)
        try {
          await access(destAbs)
          return { ok: false, error: `Target already exists: ${name}` }
        } catch { /* doesn't exist, good */ }
        await cp(srcPath, destAbs, { recursive: true })
        await rm(srcPath, { recursive: true })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.FILE_DELETE, async (_event, folderPath: string, relPath: string): Promise<FileOpResult> => {
    try {
      const absPath = validatePathInProject(folderPath, relPath)
      await shell.trashItem(absPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.FILE_RENAME, async (_event, folderPath: string, relPath: string, newName: string): Promise<FileOpResult> => {
    try {
      if (newName.includes('/') || newName.includes('\\')) {
        return { ok: false, error: 'Name cannot contain path separators' }
      }
      const oldAbs = validatePathInProject(folderPath, relPath)
      const newAbs = join(dirname(oldAbs), newName)
      if (!newAbs.startsWith(resolve(folderPath) + sep)) {
        return { ok: false, error: 'Renamed path escapes project directory' }
      }
      try {
        await access(newAbs)
        const [oldStat, newStat] = await Promise.all([stat(oldAbs), stat(newAbs)])
        if (oldStat.ino !== newStat.ino) {
          return { ok: false, error: `Target already exists: ${newName}` }
        }
      } catch { /* target doesn't exist, good */ }
      await rename(oldAbs, newAbs)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.FILE_SHOW_IN_FOLDER, async (_event, folderPath: string, relPath: string) => {
    const absPath = validatePathInProject(folderPath, relPath)
    if (relPath === '') {
      await shell.openPath(absPath)
    } else {
      shell.showItemInFolder(absPath)
    }
  })

  ipcMain.on(AgentIpcChannels.START_DRAG, async (event, paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }) => {
    if (!Array.isArray(paths) || paths.length === 0) return
    try {
      let icon: Electron.NativeImage
      if (iconOpts?.png) {
        const { nativeImage } = await import('electron')
        const buf = Buffer.from(iconOpts.png)
        icon = nativeImage.createFromBuffer(buf, { scaleFactor: iconOpts.scaleFactor ?? 1 })
      } else {
        icon = await app.getFileIcon(paths[0], { size: 'small' })
      }
      event.sender.startDrag({ files: paths, file: paths[0], icon })
    } catch (err) {
      log.warn('[start-drag] failed:', err)
    }
  })

  ipcMain.handle(AgentIpcChannels.PATH_STAT, async (_event, p: string): Promise<{ isFile: boolean; isDirectory: boolean } | null> => {
    try {
      const s = await stat(p)
      return { isFile: s.isFile(), isDirectory: s.isDirectory() }
    } catch {
      return null
    }
  })

  const READABLE_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
  const READABLE_IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  const MAX_READABLE_IMAGE_BYTES = 10 * 1024 * 1024

  ipcMain.handle(AgentIpcChannels.READ_FILE_AS_DATA_URI, async (_event, absPath: string) => {
    try {
      if (typeof absPath !== 'string' || !isAbsolute(absPath)) {
        return { ok: false, error: 'Path must be absolute' }
      }
      const ext = extname(absPath).toLowerCase()
      if (!READABLE_IMAGE_EXTS.has(ext)) {
        return { ok: false, error: `Unsupported file extension: ${ext}` }
      }
      const info = await stat(absPath)
      if (!info.isFile()) {
        return { ok: false, error: 'Not a regular file' }
      }
      if (info.size > MAX_READABLE_IMAGE_BYTES) {
        return { ok: false, error: `File too large (${info.size} bytes)` }
      }
      const buf = await readFile(absPath)
      const mime = READABLE_IMAGE_MIME[ext] ?? 'application/octet-stream'
      return { ok: true, dataUri: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.SAVE_FILE_AS, async (_event, sourcePath: string, defaultName: string) => {
    try {
      if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) {
        return { ok: false, error: 'Source path must be absolute' }
      }
      await access(sourcePath)
      const ext = extname(sourcePath).toLowerCase().replace(/^\./, '') || 'png'
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        defaultPath: defaultName || basename(sourcePath),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true }
      }
      await cp(sourcePath, result.filePath)
      return { ok: true, savedPath: result.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.OPEN_EXTERNAL_LINK, (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`Blocked: only http/https URLs are allowed, got: ${url}`)
    }
    return shell.openExternal(url)
  })

  ipcMain.handle(AgentIpcChannels.CLIPBOARD_READ, () => {
    return clipboard.readText()
  })

  ipcMain.handle(AgentIpcChannels.CLIPBOARD_WRITE, (_event, text: string) => {
    clipboard.writeText(text)
  })

  const testInstall = process.env.TEST_INSTALL_CLAUDE === '1'

  ipcMain.handle(AgentIpcChannels.SETUP_CHECK_CLAUDE, () => {
    return true
  })

  ipcMain.handle(AgentIpcChannels.SETUP_INSTALL_CLAUDE, () => {
    const win = getMainWindow()
    const isWin = process.platform === 'win32'
    const testCmd = "printf '\\e[31mRed\\e[0m \\e[32mGreen\\e[0m \\e[33mYellow\\e[0m \\e[34mBlue\\e[0m \\e[35mPurple\\e[0m \\e[36mCyan\\e[0m \\e[1;32mBold Green\\e[0m\\n\\e[90mDim\\e[0m \\e[91mBright Red\\e[0m \\e[92mBright Green\\e[0m \\e[93mBright Yellow\\e[0m\\n'"
    const installCmd = isWin
      ? 'irm https://claude.ai/install.ps1 | iex'
      : (testInstall ? testCmd : 'curl -fsSL https://claude.ai/install.sh | bash')

    const colorEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
      CLICOLOR_FORCE: '1',
    }
    const child = isWin
      ? spawn('powershell', ['-NoProfile', '-Command', installCmd], { env: colorEnv })
      : spawn('bash', ['-c', installCmd], { env: colorEnv })

    child.stdout.on('data', (data: Buffer) => {
      !win.isDestroyed() && win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_output',
        data: data.toString(),
      })
    })

    child.stderr.on('data', (data: Buffer) => {
      !win.isDestroyed() && win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_output',
        data: data.toString(),
      })
    })

    child.on('close', (code) => {
      fixPath()
      !win.isDestroyed() && win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_complete',
        code: code ?? 1,
      })
    })

    child.on('error', (err) => {
      !win.isDestroyed() && win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_error',
        error: err.message,
      })
    })
  })

  ipcMain.handle(AgentIpcChannels.UPDATER_INSTALL, () => {
    installUpdate()
  })

  ipcMain.handle(AgentIpcChannels.UPDATER_CHECK, () => {
    checkForUpdates()
  })

  ipcMain.handle(AgentIpcChannels.UPDATER_SIMULATE, () => {
    simulateUpdate()
  })

  ipcMain.handle(AgentIpcChannels.FILE_WATCH_START, (_e, folderPath: string) => {
    startWatching(getMainWindow(), folderPath, () => {
      gitStatusSnapshotCache.delete(folderPath)
    })
  })

  ipcMain.handle(AgentIpcChannels.FILE_WATCH_STOP, () => {
    stopWatching()
  })

  ipcMain.handle(AgentIpcChannels.BASH_OUTPUT_WATCH, (_e, toolUseId: string, filePath: string, tailLines?: number) => {
    watchBashOutput(toolUseId, filePath, tailLines)
  })

  ipcMain.handle(AgentIpcChannels.BASH_OUTPUT_UNWATCH, (_e, toolUseId: string) => {
    unwatchBashOutput(toolUseId)
  })

  ipcMain.handle(AgentIpcChannels.BASH_OUTPUT_READ_MORE, (_e, toolUseId: string, tailLines: number) => {
    const filePath = getWatchedFilePath(toolUseId)
    if (!filePath) return ''
    return readBashOutputTail(filePath, tailLines)
  })

  ipcMain.handle(AgentIpcChannels.BASH_OUTPUT_READ_FILE, (_e, filePath: string, tailLines: number) => {
    return readBashOutputTail(filePath, tailLines)
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_PROJECT_PREFERENCES_GET, (_e, projectPath: string) => {
    return readProjectPreferences(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_PROJECT_PREFERENCES_SAVE, (_e, projectPath: string, preferences) => {
    const result = saveProjectPreferences(projectPath, preferences)
    agentService.markAllNeedsRebuild()
    return result
  })

  ipcMain.handle(AgentIpcChannels.APP_SETTINGS_GET, () => readAppSettings())
  ipcMain.handle(AgentIpcChannels.APP_SETTINGS_SAVE, async (_e, patch) => {
    const result = saveAppSettings(patch)
    if (result.locale) {
      await applyLocale(result.locale)
    }
    return result
  })
  ipcMain.handle(AgentIpcChannels.APP_SYSTEM_LOCALE, () => getSystemLocale())

  ipcMain.handle(AgentIpcChannels.SET_FAST_MODE, (_e, enabled: boolean) => {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    let data: Record<string, unknown> = {}
    try {
      if (existsSync(settingsPath)) data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch { /* start fresh */ }
    data.fastMode = enabled
    mkdirSync(join(homedir(), '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(data, null, 2))
    log.info('[settings] fastMode set to %s', enabled)
  })

  ipcMain.handle(AgentIpcChannels.GET_LOG_PATH, () => {
    return log.transports.file.getFile().path
  })

  ipcMain.handle(AgentIpcChannels.USAGE_QUERY, (_e, range: { from?: string; to?: string } | undefined) => {
    return queryUsage(range ?? {})
  })
  ipcMain.handle(AgentIpcChannels.USAGE_COUNTS_QUERY, (_e, range: { from?: string; to?: string; harness?: 'claude' | 'codex' } | undefined) => {
    return queryCounts(range ?? {})
  })
  ipcMain.handle(AgentIpcChannels.USAGE_BACKFILL_STATUS, () => {
    return getBackfillStatus()
  })

  const remoteConfigPath = join(app.getPath('userData'), 'remote-config.json')
  function readRemoteConfig(): RemoteDeviceConfig | null {
    try {
      const raw = JSON.parse(readFileSync(remoteConfigPath, 'utf-8'))
      return { preventSleep: false, relayUrl: '', ...raw }
    } catch {
      return null
    }
  }
  ipcMain.handle(AgentIpcChannels.REMOTE_GET_RELAY_STATUS, () => remoteControlService.isRelayConnected())
  ipcMain.handle(AgentIpcChannels.REMOTE_GET_CONFIG, readRemoteConfig)
  ipcMain.handle(AgentIpcChannels.REMOTE_SAVE_CONFIG, (_, config: RemoteDeviceConfig) => {
    writeFileSync(remoteConfigPath, JSON.stringify(config))
    remoteControlService.start(config)
  })
  ipcMain.handle(AgentIpcChannels.REMOTE_LIST_PAIRED, (): PairedDevice[] => {
    const online = remoteControlService.getOnlineDevices()
    return listPairedDevices().map((row) => ({
      id: row.id,
      name: row.name,
      pairedAt: row.paired_at,
      lastSeenAt: row.last_seen_at,
      online: online.has(row.id),
      transport: online.get(row.id)?.transport,
    }))
  })
  ipcMain.handle(AgentIpcChannels.REMOTE_REMOVE_PAIRED, (_, id: string) => {
    deletePairedDevice(id)
  })
  ipcMain.handle(AgentIpcChannels.REMOTE_START_PAIRING, async () => {
    const config = readRemoteConfig()
    if (!config) throw new Error('Remote control not configured')
    return remoteControlService.startPairing()
  })
  ipcMain.handle(AgentIpcChannels.REMOTE_CONFIRM_PAIRING, async (_, code: string) => {
    const config = readRemoteConfig()
    if (!config) throw new Error('Remote control not configured')
    await remoteControlService.confirmPairing(code, config.masterSecret)
  })
  ipcMain.handle(AgentIpcChannels.REMOTE_CANCEL_PAIRING, async () => {
    await remoteControlService.cancelPairing()
  })

  agentService.setRemoteControlService(remoteControlService)
  agentService.setDeviceRegistry(deviceRegistry)
  const mobileBroadcaster = new MobileBroadcaster(sessionManager, remoteControlService)
  agentService.addEventSubscriber((event) => {
    void mobileBroadcaster.broadcast(event)
  })

  const savedRemoteConfig = readRemoteConfig()
  if (savedRemoteConfig) remoteControlService.start(savedRemoteConfig)

  powerMonitor.on('resume', () => {
    log.info('[RemoteControl] System resumed, restarting channel')
    remoteControlService.resume()
  })

  ipcMain.handle(AgentIpcChannels.GET_FULLSCREEN, () => getMainWindow().isFullScreen())

  ipcMain.handle(AgentIpcChannels.SET_MIN_WINDOW_SIZE, (_e, width: number, height: number) => {
    const win = getMainWindow()
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    win.setMinimumSize(w, h)
    if (win.isFullScreen() || win.isMaximized()) return
    const [curW, curH] = win.getSize()
    if (curW >= w && curH >= h) return
    const newW = Math.max(curW, w)
    const newH = Math.max(curH, h)
    const work = screen.getDisplayMatching(win.getBounds()).workArea
    let [x, y] = win.getPosition()
    if (x + newW > work.x + work.width) x = Math.max(work.x, work.x + work.width - newW)
    if (y + newH > work.y + work.height) y = Math.max(work.y, work.y + work.height - newH)
    win.setBounds({ x, y, width: newW, height: newH }, true)
  })

  ipcMain.handle(AgentIpcChannels.GET_STARTUP_DATA, (): StartupData => {
    const claude = getCachedHarnessResources('claude')
    const codex = getCachedHarnessResources('codex')
    log.info(
      '[GET_STARTUP_DATA] cached: claude=%s codex=%s',
      claude ? `${claude.models?.length ?? 0} models` : 'null',
      codex ? `${codex.models?.length ?? 0} models` : 'null',
    )
    return { cached: { claude, codex } }
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CLAUDE, async (): Promise<ClaudeResources> => {
    log.info('[CONNECT_CLAUDE] cwd:', app.getPath('userData'))
    log.info('[CONNECT_CLAUDE] platform=%s arch=%s', process.platform, process.arch)
    const q = query({
      prompt: 'hi',
      options: { cwd: app.getPath('userData'), pathToClaudeCodeExecutable: resolveSdkClaudeBinary(), maxTurns: 0, permissionMode: 'default', persistSession: false },
    })
    try {
      log.info('[CONNECT_CLAUDE] Fetching models, account, commands...')
      const [modelInfos, accountInfo, commands, initResult] = await Promise.all([
        q.supportedModels(),
        q.accountInfo(),
        q.supportedCommands(),
        q.initializationResult(),
      ])
      log.info('[CONNECT_CLAUDE] Fetch complete, closing query...')
      q.close()

      const skills = discoverUserSkills()
      const userCommands = discoverUserCommands()
      const agents = discoverUserAgents()

      log.info('[CONNECT_CLAUDE] Models:', JSON.stringify(modelInfos, null, 2))
      log.info('[CONNECT_CLAUDE] Account:', JSON.stringify(accountInfo, null, 2))
      log.info('[CONNECT_CLAUDE] Commands:', JSON.stringify(commands, null, 2))
      log.info('[CONNECT_CLAUDE] OutputStyle=%s AvailableStyles=%j', initResult.output_style, initResult.available_output_styles)
      log.info('[CONNECT_CLAUDE] User Skills:', JSON.stringify(skills, null, 2))
      log.info('[CONNECT_CLAUDE] User Commands:', JSON.stringify(userCommands, null, 2))

      const models = modelInfos.map(mapModelInfo)
      const account = {
        email: accountInfo.email,
        organization: accountInfo.organization,
        subscriptionType: accountInfo.subscriptionType,
        apiKeySource: accountInfo.apiKeySource,
        apiProvider: accountInfo.apiProvider,
      }
      const slashCommands = commands.map((c) => ({
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
        isSkill: false,
      }))

      const outputStyles = initResult.available_output_styles ?? []

      const resources: ClaudeResources = {
        models,
        account,
        slashCommands,
        skills,
        commands: userCommands,
        agents,
        outputStyles,
      }
      setCachedHarnessResources('claude', resources)

      return resources
    } catch (error) {
      log.error('[CONNECT_CLAUDE] failed: %s', error instanceof Error ? error.message : String(error))
      const debugLogPath = String(log.transports.file.getFile().path)
      throw new Error(`CONNECT_CLAUDE failed. Debug log: ${debugLogPath}`)
    } finally {
      try {
        q.close()
      } catch {}
    }
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CODEX, async (): Promise<CodexResources> => {
    log.info('[CONNECT_CODEX] Fetching codex resources...')
    try {
      const models = await codexService.listModels(app.getPath('userData'))
      const prompts = discoverCodexUserPrompts()
      const resources: CodexResources = { models, prompts }
      setCachedHarnessResources('codex', resources)
      log.info('[CONNECT_CODEX] Fetch complete: %d models, %d prompts', models.length, prompts.length)
      return resources
    } catch (error) {
      log.error('[CONNECT_CODEX] failed: %s', error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  ipcMain.handle(AgentIpcChannels.WIDGET_IFRAME_READY, (_e, widgetId: string) => {
    notifyWidgetReady(widgetId)
  })

  initSuperoneMcpServer(() => mainWindow)
  startMcpHttpServer(() => mainWindow).catch((err) => log.error('[mcp-http] failed to start:', err))

  ipcMain.handle(AgentIpcChannels.MINIAPP_LIST, async (_e, projectDir?: string) => {
    const apps = await discoverApps()
    if (projectDir) {
      const projectApps = await discoverProjectApps(projectDir)
      const existingIds = new Set(apps.map((a) => a.id))
      for (const app of projectApps) {
        if (!existingIds.has(app.id)) apps.push(app)
      }
    }
    for (const app of apps) {
      cacheAppEntry(app)
      setAppMediaPermissions(app.id, app.manifest)
      if (app.manifest.type === 'in-chat') {
        registerInChatApp(app.manifest)
        if (projectDir) setAppFsPermissions(app.id, app.manifest, projectDir, app.installDir)
      }
    }
    return apps
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_OPEN, async (_e, appId: string, projectDir: string) => {
    const basePath = getAppBasePath(appId)
    const installDir = getAppInstallDir(appId)
    const manifest = await readManifest(basePath)
    if (!manifest) throw new Error(`App not found: ${appId}`)
    setAppFsPermissions(appId, manifest, projectDir, installDir)
    setAppMediaPermissions(appId, manifest)
    const toolSlug = manifest.toolSlug ?? appId
    registerAppTools(appId, toolSlug, manifest.tools ?? [])
    registerAppTemplates(appId, manifest.templates)
    loadPreapprovedTools(appId, toolSlug, basePath)
    if (manifest.tools?.length) agentService.markAllNeedsRebuild()
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_CLOSE, async (_e, appId: string) => {
    unregisterAppTools(appId)
    unregisterAppTemplates(appId)
    clearAllowedDirectories(appId)
    clearAllowedMedia(appId)
    agentService.markAllNeedsRebuild()
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_RESULT, (_e, callId: string, result: unknown, error?: string) => {
    if (error) {
      rejectToolCall(callId, error)
    } else {
      resolveToolCall(callId, result)
    }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_SUBMIT, (_e, callId: string, userInput: Record<string, unknown>) => {
    submitToolIntercept(callId, userInput ?? {})
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CANCEL, (_e, callId: string, reason?: string) => {
    cancelToolIntercept(callId, reason)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_FS_REQUEST, async (_e, appId: string, op: string, args: Record<string, unknown>) => {
    return handleFsRequest(appId, op as any, args)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_FS_WATCH, (_e, appId: string, path: string) => {
    return startWatch(appId, path)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_FS_UNWATCH, (_e, watchId: number) => {
    stopWatch(watchId)
  })

  onFsWatchEvent((event) => {
    mainWindow?.webContents.send(AgentIpcChannels.MINIAPP_FS_WATCH_EVENT, event)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_GIT_REQUEST, async (_e, appId: string, op: string, args: Record<string, unknown>) => {
    return handleGitRequest(appId, op as any, args)
  })

  onGitHeadChangeEvent((event) => {
    mainWindow?.webContents.send(AgentIpcChannels.MINIAPP_GIT_HEAD_CHANGE, event)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_IFRAME_READY, (_e, appId: string) => {
    notifyMiniAppReady(appId)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_GET_PRELOAD_PATH, () => {
    return join(__dirname, '../preload/miniapp-preload.js')
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DETECT_DEV, async (_e, projectDir: string) => {
    const projectApps = await discoverProjectApps(projectDir)
    for (const app of projectApps) cacheAppEntry(app)
    return projectApps
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_PREVIEW, async (_e, s1appPath: string) => {
    return previewApp(s1appPath)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_CONFIRM_INSTALL, async (_e, tempDir: string, installDir?: string, preapprovedTools?: string[]) => {
    return confirmInstall(tempDir, installDir, preapprovedTools)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_CANCEL_INSTALL, async (_e, tempDir: string) => {
    return cancelInstall(tempDir)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_UNINSTALL, async (_e, appId: string) => {
    return uninstallApp(appId)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_PACK, async (_e, appDir: string, outputDir: string) => {
    return packApp(appDir, outputDir)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_GET_INSTALL_META, async (_e, appId: string) => {
    return getInstallMeta(appId)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_GET_PREAPPROVED, async (_e, appId: string) => {
    const basePath = getAppBasePath(appId)
    return getPreapprovedByPath(basePath)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_SET_PREAPPROVED, async (_e, appId: string, tools: string[]) => {
    const basePath = getAppBasePath(appId)
    await setPreapprovedByPath(basePath, tools)
    updatePreapprovedTools(appId, tools)
  })

  // Automations
  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_LIST, (_e, projectPath: string) => {
    return listAutomationsForProject(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_CREATE, (_e, projectPath: string, data: CreateAutomationRequest) => {
    return dbCreateAutomation(projectPath, data)
  })

  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_UPDATE, (_e, id: string, data: UpdateAutomationRequest) => {
    return dbUpdateAutomation(id, data)
  })

  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_DELETE, (_e, id: string) => {
    return dbDeleteAutomation(id)
  })

  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_RUN_NOW, async (_e, id: string) => {
    return automationService.runNow(id)
  })
}

app.whenReady().then(async () => {
  log.info(
    '[startup] appVersion=%s electron=%s platform=%s arch=%s logPath=%s',
    app.getVersion(),
    process.versions.electron,
    process.platform,
    process.arch,
    log.transports.file.getFile().path,
  )
  await initMainI18n()

  if (getBackfillStatus() !== 'done') {
    setImmediate(() => {
      try {
        const summary = backfillFromHistory()
        log.info('[usage-stats] backfill done: %s', JSON.stringify(summary))
        for (const win of BrowserWindow.getAllWindows()) {
          try { win.webContents.send(AgentIpcChannels.USAGE_BACKFILL_DONE, summary) } catch { /* window may have closed */ }
        }
      } catch (err) {
        log.error('[usage-stats] backfill failed: %s', err instanceof Error ? err.message : String(err))
      }
    })
  }
  const LOCAL_FILE_MIME: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
    pdf: 'application/pdf',
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
  }

  protocol.handle('local-file', async (request) => {
    try {
      const origin = request.headers.get('origin') || ''
      if (origin.startsWith('superone-app://')) {
        return new Response('Forbidden', { status: 403 })
      }
      const rawPath = decodeURIComponent(new URL(request.url).pathname)
      const filePath = rawPath.replace(/^\/([A-Za-z]:)/, '$1')
      const resolved = resolveRealPath(filePath)
      const folders = getRecentFolders()
      const allowedRoots = getReadableAssetRoots(folders.map((f) => f.path))
      if (!isPathWithinAllowed(resolved, allowedRoots)) {
        log.warn('[local-file] blocked path outside project folders:', resolved)
        return new Response('Forbidden', { status: 403 })
      }
      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const contentType = LOCAL_FILE_MIME[ext] ?? 'application/octet-stream'
      const data = await readFile(resolved)
      const total = data.byteLength
      const range = request.headers.get('Range')
      log.debug(`[local-file] ${resolved} range=${range} size=${total}`)

      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/)
        const start = match ? parseInt(match[1]) : 0
        const end = match?.[2] ? parseInt(match[2]) : total - 1
        return new Response(data.subarray(start, end + 1), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
          },
        })
      }

      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch (err) {
      log.error('[local-file] failed:', err)
      return new Response('Not found', { status: 404 })
    }
  })
  const MINIAPP_MIME: Record<string, string> = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    mjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  }

  protocol.handle('superone-app', async (request) => {
    try {
      const url = new URL(request.url)
      const appId = url.hostname
      const filePath = decodeURIComponent(url.pathname || '/index.html')

      const origin = request.headers.get('origin') || ''
      if (origin.startsWith('superone-app://') && origin !== `superone-app://${appId}`) {
        return new Response('Cross-app access forbidden', { status: 403 })
      }

      const basePath = getAppBasePath(appId)
      const resolved = validatePath(basePath, filePath === '/' ? '/index.html' : filePath)
      if (!resolved) {
        log.warn('[superone-app] path traversal blocked: %s %s', appId, filePath)
        return new Response('Forbidden', { status: 403 })
      }

      const data = await readFile(resolved)
      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const contentType = MINIAPP_MIME[ext] ?? 'application/octet-stream'

      if (ext === 'html' || ext === 'htm') {
        const html = data.toString('utf-8')
        const popoverName = url.searchParams.get('_popover')
        const toolIntercept = url.searchParams.get('_toolIntercept')
        const toolResult = url.searchParams.get('_toolResult')
        const locale = getCurrentLocale()
        const bridgeScript = toolIntercept
          ? generateToolInterceptBridgeScript(appId, app.getVersion(), locale, {
              callId: url.searchParams.get('_toolCallId') || '',
              toolName: url.searchParams.get('_toolName') || '',
              initialData: JSON.parse(url.searchParams.get('_toolData') || 'null'),
            })
          : toolResult
            ? generateToolResultBridgeScript(appId, app.getVersion(), locale, {
                callId: url.searchParams.get('_toolCallId') || '',
                toolName: url.searchParams.get('_toolName') || '',
                result: JSON.parse(url.searchParams.get('_toolData') || 'null'),
              })
            : popoverName
              ? generatePopoverBridgeScript(appId, app.getVersion(), locale, JSON.parse(url.searchParams.get('_popoverData') || 'null'))
              : generateBridgeScript(appId, app.getVersion(), locale)
        const injected = html.includes('<head>')
          ? html.replace('<head>', `<head>${bridgeScript}`)
          : html.includes('<html>')
            ? html.replace('<html>', `<html><head>${bridgeScript}</head>`)
            : bridgeScript + html
        const manifest = await readManifest(basePath)
        const csp = manifest ? generateCSP(manifest) : "default-src 'none'"
        return new Response(injected, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp },
        })
      }

      return new Response(data, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(data.byteLength) },
      })
    } catch (err) {
      log.error('[superone-app] failed:', err)
      return new Response('Not found', { status: 404 })
    }
  })

  protocol.handle('superone-fs', async (request) => {
    try {
      const url = new URL(request.url)
      const appId = url.hostname
      const relativePath = decodeURIComponent(url.pathname).replace(/^\//, '')
      if (!relativePath) return new Response('Bad request', { status: 400 })

      const origin = request.headers.get('origin') || ''
      if (origin && origin !== 'null' && origin !== `superone-app://${appId}`) {
        return new Response('Forbidden', { status: 403 })
      }

      const dirs = getAllowedDirs(appId)
      if (!dirs?.length) return new Response('No allowed directories', { status: 403 })

      const { resolved, access: dirAccess } = resolveSafePathMulti(dirs, relativePath)

      if (request.method === 'GET') {
        const data = await readFile(resolved)
        const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
        const contentType = MINIAPP_MIME[ext] ?? 'application/octet-stream'
        return new Response(data, {
          headers: { 'Content-Type': contentType, 'Content-Length': String(data.byteLength) },
        })
      }

      if (request.method === 'PUT') {
        if (dirAccess === 'read') return new Response('Write access denied', { status: 403 })
        await mkdir(dirname(resolved), { recursive: true })
        const ct = request.headers.get('content-type') || ''
        if (ct.startsWith('text/') || ct.includes('json')) {
          const text = await request.text()
          await writeFile(resolved, text, 'utf-8')
        } else {
          const buf = Buffer.from(await request.arrayBuffer())
          await writeFile(resolved, buf)
        }
        return new Response(null, { status: 204 })
      }

      return new Response('Method not allowed', { status: 405 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[superone-fs] failed:', err)
      if (msg.includes('Access denied') || msg.includes('not within allowed')) {
        return new Response(msg, { status: 403 })
      }
      return new Response(msg, { status: 500 })
    }
  })

  fixPath()
  startMediaServer().catch((err) => log.error('[media-server] failed to start:', err))
  ipcMain.handle(AgentIpcChannels.MEDIA_SERVER_PORT, () => getMediaServerPort())
  getDb() // Initialize database
  registerIpcHandlers()

  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const reqUrl = (details as { requestingUrl?: string }).requestingUrl ?? wc.getURL() ?? ''
    const appId = appIdFromUrl(reqUrl)
    if (!appId) {
      callback(true)
      return
    }
    if (permission !== 'media') {
      callback(false)
      return
    }
    const mediaTypes = (details as { mediaTypes?: Array<'audio' | 'video'> }).mediaTypes ?? []
    if (mediaTypes.length === 0) {
      callback(false)
      return
    }
    const ok = mediaTypes.every((t) => isMediaAllowed(appId, t === 'audio' ? 'microphone' : 'camera'))
    callback(ok)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const appId = appIdFromUrl(requestingOrigin) ?? appIdFromUrl((details as { requestingUrl?: string }).requestingUrl ?? '')
    if (!appId) return true
    if (permission !== 'media') return false
    const mediaType = (details as { mediaType?: 'audio' | 'video' | 'unknown' }).mediaType
    if (mediaType === 'audio') return isMediaAllowed(appId, 'microphone')
    if (mediaType === 'video') return isMediaAllowed(appId, 'camera')
    return isMediaAllowed(appId, 'microphone') || isMediaAllowed(appId, 'camera')
  })

  createWindow()
  initUpdater(mainWindow!)

  let devUpdateToggle = false
  function buildAppMenu(): void {
    if (process.platform !== 'darwin') return
    const { label: updateLabel, enabled: updateEnabled } = getUpdateMenuState()
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: updateLabel, enabled: updateEnabled, click: () => {
            if (getUpdaterState() === 'downloaded') {
              if (is.dev) {
                devUpdateToggle = false
                simulateNotAvailable()
              } else {
                installUpdate()
              }
              return
            }
            if (is.dev) {
              devUpdateToggle = !devUpdateToggle
              devUpdateToggle ? simulateUpdate() : simulateNotAvailable()
            } else {
              checkForUpdates()
            }
          } },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }
  buildAppMenu()
  setOnMenuChange(buildAppMenu)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let quitting = false

function performQuit(): void {
  quitting = true
  automationService.stop()
  stopWatching()
  stopMcpHttpServer()
  disposeUpdater()
  remoteControlService.stop().catch(() => {})
  agentService
    .dispose()
    .catch(() => {})
    .finally(() => {
      codexService.dispose()
      closeDb()
      closeTraceDb()
      // Give SDK child processes a moment to fully terminate before quitting.
      // abort() signals the SDK to stop, but the async iterator needs time to
      // detect the child process exit and release its handles.
      setTimeout(() => app.quit(), 500)
    })
}

app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()

  if (!agentService.hasRunningSessions()) {
    performQuit()
    return
  }

  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) {
    performQuit()
    return
  }

  dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Quit SuperOne?',
    detail: 'Running sessions will be stopped.',
  }).then(({ response }) => {
    if (response === 0) performQuit()
  })
})
