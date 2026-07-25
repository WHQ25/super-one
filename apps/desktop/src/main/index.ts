import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, protocol, screen, session, shell, systemPreferences, webContents } from 'electron'
import { join, dirname, basename, resolve, extname, relative, isAbsolute, sep } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, readdir, rename, cp, rm, access, stat, mkdir, open } from 'fs/promises'
import { cpus, homedir, hostname } from 'os'
import { resolveRealPath, isPathWithinAllowed, sanitizeGitRef, getReadableAssetRoots } from './path-security'
import { spawn } from 'child_process'
import { gitRun } from './git-run'
import { activateWorktree, assignBranch, getCheckedOutBranches, getHandoffPreview, getWorktreeInfo, gitErrorMessage, handoffToLocal } from './git/worktree-ops'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { startMediaServer, getMediaServerPort } from './media-server'
import { getMediaProviderStatuses } from './media-gen/settings-service'
import { getAppBasePath, cacheAppEntry, getAppInstallDir, generateCSP, readManifest, validatePath, discoverApps, setAllowedDirectories, clearAllowedDirectories, handleFsRequest, handleGitRequest, discoverProjectApps, startWatch, stopWatch, onFsWatchEvent, onGitHeadChangeEvent, getAllowedDirs, resolveSafePathMulti, setAllowedMedia, clearAllowedMedia, isMediaAllowed, appIdFromUrl, listDevRegistryView, registerDevMiniApp, unregisterDevMiniApp, installDevPointer, removeDevPointer, setDevPointerEnabled, type AllowedDir } from './miniapp/miniapp-service'
import * as devRegistry from './miniapp/dev-registry'
import { handleDbRequest, closeAllDbConnections } from './miniapp/miniapp-db'
import { handleKvRequest, type KvOp, type KvRequestArgs } from './miniapp/miniapp-kv'
import { setPeerBroadcaster, emitPeer } from './miniapp/miniapp-peer-bus'
import { generateBridgeScript, generatePopoverBridgeScript, generateStandaloneBridgeScript, generateToolInterceptBridgeScript, generateToolResultBridgeScript } from './miniapp/miniapp-bridge'
import { registerMiniAppProtocolHandlers } from './miniapp/miniapp-protocol'
import { initWorkerHost, startWorker, stopWorker, stopWorkersByAppId, workerStatus, listWorkers, hasActiveWorkers, stopAllWorkers, sendToWorker, handleWorkerSend } from './miniapp/worker-host'
import { buildMiniAppHost } from '@superone/shared/miniapp-host'
import { previewApp, confirmInstall, cancelInstall, uninstallApp, packApp, getInstallMeta, getPreapproved, getPreapprovedByPath, setPreapproved, setPreapprovedByPath } from './miniapp/miniapp-packager'
import { previewMcpbBundle, installMcpbBundle, uninstallMcpbBundle, listInstalledMcpb, revealMcpbBundle } from './mcpb/mcpb-installer'
import { initBrowserAutomation, resolveBrowserAutomation, rejectBrowserAutomation } from './browser/browser-automation-bridge'
import { detachAllCdp } from './browser/browser-cdp'
import { registerBrowserPopupRedirect } from './browser-popup-redirect'
import { fetchBrowserBytes, registerBrowserDownloadCapture } from './browser/browser-downloads'
import { setBrowserDownloadTaskHost } from './browser/browser-download-tasks'
import { initSuperoneMcpServer, registerAppTools, unregisterAppTools, unregisterAppAcrossSessions, resolveToolCall, rejectToolCall, notifyAppReady as notifyMiniAppReady, loadPreapprovedTools, updatePreapprovedTools, registerAppTemplates, unregisterAppTemplates, submitToolIntercept, cancelToolIntercept, clearSessionPendingCalls as clearSessionPendingMiniAppCalls, disposeSuperoneMcpServer, setSessionHostProvider, setAppSettingsApplier, clearAppReadyGate, isAppStillAuthorizedInProject, addToolsChangedListener, setMobileShareToolDeps, registerMobileShareTool, unregisterMobileShareTool } from './mcp/superone-mcp-server'
import { MobileShareService, type MobileShareTarget } from './remote/mobile-share-service'
import { MobileReceiveService, type MobileReceiveTarget } from './remote/mobile-receive-service'
import { MobileShareToolCoordinator } from './remote/mobile-share-tool-coordinator'
import { startSuperoneMcpStdioBridge, stopSuperoneMcpStdioBridge } from './mcp/superone-mcp-stdio-ipc'
import { scheduleMcpReload } from './mcp/mcp-reload-scheduler'
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveSdkClaudeBinary } from './agent/claude-binary'
import { disposeGlobalWarmupManager } from './agent/warmup-manager'
import { resolveProbeCwd } from './agent/probe-cwd'
import { fixPath } from './agent/resolve-cli'
import { buildSafeEnv } from './spawn-env'
import { AgentService } from './agent/agent-service'
import { SessionManagerImpl } from './session/session-manager'
import { TerminalManager } from './terminal/terminal-manager'
import { TerminalBroadcaster } from './remote/terminal-broadcaster'
import { nodePtySpawner } from './terminal/pty'
import { DeviceRegistry } from './remote/device-registry'
import { MobileBroadcaster } from './remote/mobile-broadcaster'
import { PresenceCoordinator } from './remote/presence-coordinator'
import { listWorktreePaths, loadSessionStateBySid, saveSessionStateBySid, updateProviderSessionId } from './session/session-repo'
import { buildClaudeEnv, buildRemoteActiveService, resolveChatService } from './providers/resolver'
import type { ProxyUpstream } from './providers/llm-proxy-manager'
import { shutdownAll as shutdownAllProxies } from './providers/llm-proxy-manager'
import { getBinding } from './providers/credential-store'
import type { SessionProvider } from './session/types'
import { expandProviderModelEnv } from '@superone/shared/agent-types'
import { PROXY_TRANSFORMERS_ENV } from '@superone/shared/platform-registry'
import { detectBuiltinAgents } from './acp/acp-detect'
import { getBuiltinAgent } from './acp/agent-catalog'
import { readAcpResourcesCache, writeAcpResourcesCache, refreshAcpModelsOnce } from './acp/acp-model-cache'
import {
  AgentIpcChannels,
  type ModelOption,
  type SaveWidgetTemplateRequest,
  type CodexCollaborationMode,
  type CodexPermissionPreset,
  type CodexReasoningEffort,
  type CodexReviewTarget,
  type CodexRunResult,
  type CodexExternalAgentItem,
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
  type NativeContextMenuItemSpec,
} from '@superone/shared/agent-types'
import { initUpdater, installUpdate, checkForUpdates, simulateUpdate, simulateNotAvailable, getUpdaterState, getUpdateMenuState, setOnMenuChange, disposeUpdater, setUpdateChannel } from './updater'
import { startWatching, stopWatching } from './file-watcher'
import { notifyWidgetReady, clearAllGates } from './generative-ui/widget-gate'
import { setBashOutputWindow, watchBashOutput, unwatchBashOutput, unwatchAll as unwatchAllBashOutputs, readBashOutputTail, getWatchedFilePath } from './bash-output-watcher'
import { setUnsavedBuffer } from './acp/acp-unsaved-buffer'
import { closeAllOpenCodeServers, probeOpenCodeResources, reapOrphanOpenCodeServers } from './opencode/opencode-client'
import { listWorkflowAgents, readWorkflowOutput, readWorkflowScript } from './workflow-transcripts'
import { readSubagentTranscript } from './agent/subagent-transcript'
import { parseGitStatusOutput, parseGitStatusFiles, type GitStatusPair } from './git-status-utils'
import { mapModelInfo } from './agent/claude-models'
import { getClaudeRateLimits } from './agent/claude-usage-service'
import { getProviderRateLimits } from './agent/provider-usage-service'
import { getRecentFolders, addRecentFolder, removeRecentFolder, getProjectId, getProjectPathById } from './recent-folders'
import { getDb, closeDb, getCachedHarnessResources, getHarnessResourceCacheAgeMs, setCachedHarnessResources, upsertPairedDevice, listPairedDevices, deletePairedDevice, isPairedDevice } from './database'
import { backfillFromHistory, getBackfillStatus, queryCounts, queryUsage } from './usage-stats-service'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents, discoverCodexUserPrompts } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'
import { getCodexProviderOverrideFor } from './codex/app-server-connection'
import { CodexPluginsService } from './codex/codex-plugins-service'
import { CodexHooksService } from './codex/codex-hooks-service'
import { CodexMarketplaceService } from './codex/codex-marketplace-service'
import { setCodexSkillsWatcherWindow } from './codex/codex-skills-watcher'
import { deleteCodexMcpConfig, saveCodexMcpConfig, toggleCodexMcpConfig } from './codex-config-service'
import { setCodexServiceFactory } from './session/backends/codex-backend'
import { AutomationService } from './automation-service'
import { listAutomationsForProject, createAutomation as dbCreateAutomation, updateAutomation as dbUpdateAutomation, deleteAutomation as dbDeleteAutomation } from './db-automations'
import { trace, closeTraceDb } from './agent/event-trace'
import { RemoteControlService } from './remote-control-service'
import { readProjectPreferences, saveProjectPreferences } from './claude-preferences-service'
import { readAppSettings, saveAppSettings } from './app-settings-service'
import type { AppSettings, AppSettingsPatch, ThemeMode } from '@superone/shared/agent-types'
import { recordBrowserHistory, suggestBrowserHistory, deleteBrowserHistory } from './browser-history-service'
import { getSandboxCapability, probeSandboxDependencies } from './sandbox-platform'
import { ProcessTitle, WindowRole, roleArg, glassBootArgs } from './process-titles'
import { applyLocale, getSystemLocale, getCurrentLocale, initMainI18n, t } from './i18n'
import { applyAppIcon, clearStoredCustomIcons, getAppIcon, storeCustomIcon } from './app-icon'
import { planStartDrag } from './start-drag'
import type { RemoteCommand, PairedDevice, CreateAutomationRequest, RemoteDeviceConfig, UpdateAutomationRequest, ChatMessageContext, ContentBlock, WorktreeActivateRequest } from '@superone/shared/agent-types'
import type { RemoteControlCallbacks } from './remote-control-service'


process.on('uncaughtException', (err: Error & { code?: string }) => {
  log.error('[main] uncaughtException', {
    name: err?.name,
    code: err?.code,
    message: err?.message,
    stack: err?.stack,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  })
})

process.on('unhandledRejection', (reason) => {
  const err = (reason ?? {}) as Error & { code?: string }
  log.error('[main] unhandledRejection', {
    name: err?.name,
    code: err?.code,
    message: err?.message ?? String(reason),
    stack: err?.stack,
    appVersion: app.getVersion(),
    platform: process.platform,
  })
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'superone-app', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, standard: true } },
  { scheme: 'superone-fs', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, standard: true } },
])

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

app.setName('SuperOne')
if (is.dev) {
  app.setPath('userData', join(process.cwd(), '.dev-data'))
} else {
  const baseUserData = join(app.getPath('appData'), 'super-one')
  app.setPath('userData', process.env.SUPERONE_INSTANCE
    ? join(baseUserData, `instance-${process.env.SUPERONE_INSTANCE}`)
    : baseUserData)
}

const agentService = new AgentService()
const codexService = new CodexExperimentService()
const codexPluginsService = new CodexPluginsService(codexService)
const codexHooksService = new CodexHooksService(codexService)
const codexMarketplaceService = new CodexMarketplaceService(codexService)
setCodexServiceFactory(() => codexService)
const automationService = new AutomationService()
// `apiProviderId` carries the session's chosen credential id (dynamic-follow: null follows the global binding).
function resolveBaseProviderConfig(provider: SessionProvider, apiProviderId: string | null = null): unknown {
  if (!provider.isBase) return provider.config
  if (provider.harnessId === 'opencode') return provider.config
  if (provider.harnessId === 'acp') {
    const base = (provider.config && typeof provider.config === 'object')
      ? provider.config as Record<string, unknown>
      : {}
    const selected = readAppSettings().agentPreference.acp?.selectedAgentId
    const agentId = (typeof selected === 'string' && selected)
      || (typeof base.agentId === 'string' && base.agentId)
      || 'grok-build'
    return { ...base, agentId }
  }
  const resolved = resolveChatService(provider.harnessId, apiProviderId)
  if (!resolved) return provider.config

  if (resolved.protocol === 'openai-chat') {
    const name = resolved.brand
    const modelMapping = resolved.modelMapping ?? {}
    const prefixed: Record<string, { id: string; name?: string; description?: string }> = {}
    for (const [bucket, slot] of Object.entries(modelMapping)) {
      if (slot) prefixed[bucket] = { ...slot, id: `${name},${slot.id}` }
    }
    const transformersRaw = (resolved.extraEnv ?? {})[PROXY_TRANSFORMERS_ENV] ?? 'openai,reasoning'
    const apiBase = resolved.baseUrl.replace(/\/$/, '')
    const proxy: ProxyUpstream = {
      name,
      api_base_url: `${apiBase}/chat/completions`,
      api_key: resolved.apiKey,
      models: Object.values(modelMapping).map((s) => s?.id).filter(Boolean) as string[],
      transformerUse: transformersRaw.split(',').map((t) => t.trim()).filter(Boolean),
    }
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(resolved.extraEnv ?? {})) {
      if (key !== PROXY_TRANSFORMERS_ENV) env[key] = value
    }
    Object.assign(env, expandProviderModelEnv(prefixed))
    return {
      apiKey: 'sk-superone-proxy',
      baseUrl: undefined,
      extraEnv: Object.keys(env).length > 0 ? env : undefined,
      proxy,
    }
  }

  const env = buildClaudeEnv(resolved)
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
        apiProviderId: snapshot.apiProviderId,
        acpAgentId: snapshot.acpAgentId,
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
      title: loaded.record.title,
      worktreePath: loaded.record.worktreePath,
      gitBranch: loaded.record.gitBranch,
      apiProviderId: loaded.record.apiProviderId,
      acpAgentId: loaded.record.acpAgentId,
    }
  },
  getActiveProvider: (harnessId, apiProviderId) => {
    if (harnessId === 'acp' || harnessId === 'opencode') return null
    return buildRemoteActiveService(resolveChatService(harnessId, apiProviderId ?? null), harnessId)
  },
  getActiveDefaultApiProviderId: (harnessId) => {
    if (harnessId === 'acp' || harnessId === 'opencode') return null
    return getBinding(harnessId === 'codex' ? 'chat:codex' : 'chat:claude')?.credentialId ?? null
  },
  onBeforeInterrupt: (sessionId) => {
    clearAllGates()
    clearSessionPendingMiniAppCalls(sessionId)
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
  onLanStatusChanged: (active) => {
    safeSend(AgentIpcChannels.REMOTE_LAN_STATUS, active)
  },
  onLanUploadProgress: (info) => mobileReceiveService.handleLanUploadProgress(info),
  isPairedDevice: (deviceId) => isPairedDevice(deviceId),
}
declare const __CF_RELAY_URL__: string
const remoteControlService = new RemoteControlService(__CF_RELAY_URL__, remoteCallbacks)
let mainWindow: BrowserWindow | null = null
const miniAppSessionRefs = new Map<string, Set<string>>()
const allWindows = new Set<BrowserWindow>()
const sessionWindows = new Map<string, BrowserWindow>()
let currentThemeMode: ThemeMode = 'system'
let currentDarkTheme = true

const sessionWindowKey = (projectPath: string, sessionId: string): string =>
  `${projectPath}::${sessionId}`

function getMainWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('Main window not created yet')
  return mainWindow
}

function safeSend(channel: string, ...args: unknown[]): void {
  for (const win of allWindows) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

new PresenceCoordinator(sessionManager, {
  broadcastToRenderer: (event) => safeSend(AgentIpcChannels.EVENT, event),
  sendToMobile: (event, targetDeviceIds) => remoteControlService.sendEventToMobile(event, targetDeviceIds),
})

const mobileShareService = new MobileShareService({
  resolveTarget: (sessionId): MobileShareTarget | null => {
    const session = sessionManager.getSession(sessionId)
    if (!session) return null
    const deviceId = session.owner.kind === 'remote'
      ? session.owner.deviceId
      : session.subscribers.values().next().value
    if (!deviceId) return null
    return {
      deviceId,
      projectPath: session.projectPath,
      allowedRoots: [session.projectPath, ...session.getAdditionalDirectoriesSnapshot()],
    }
  },
  resolveDeviceName: (deviceId) => remoteControlService.getOnlineDevices().get(deviceId)?.name ?? null,
  uploadFileToRelay: (realPath, meta, sessionId, onProgress) =>
    remoteControlService.uploadFileToRelay(realPath, meta, sessionId, onProgress),
  sendAgentEvent: (event, targetDeviceIds) => remoteControlService.sendAgentEvent(event, targetDeviceIds),
  emitToRenderer: (event) => safeSend(AgentIpcChannels.EVENT, event),
  now: () => Date.now(),
})
setMobileShareToolDeps({ shareFile: (req) => mobileShareService.shareFile(req) })

const mobileReceiveService = new MobileReceiveService({
  resolveTarget: (sessionId): MobileReceiveTarget | null => {
    if (!sessionId) return null
    const session = sessionManager.getSession(sessionId)
    if (!session) return null
    const deviceId = session.owner.kind === 'remote'
      ? session.owner.deviceId
      : session.subscribers.values().next().value
    if (!deviceId) return null
    return {
      deviceId,
      deviceName: remoteControlService.getOnlineDevices().get(deviceId)?.name,
      projectPath: session.projectPath,
      allowedRoots: [session.projectPath, ...session.getAdditionalDirectoriesSnapshot()],
    }
  },
  signLanUploadUrl: (savedPath) => remoteControlService.signLanUploadUrl(savedPath, { ttlMs: 60_000 }),
  computeRelayKey: (name) => remoteControlService.computeRelayUploadKey(name),
  signRelayUploadUrl: (key) => remoteControlService.signRelayUploadUrl(key),
  downloadAndDecryptRelayFile: (key, onProgress) => remoteControlService.downloadAndDecryptRelayFile(key, onProgress),
  deleteRelayFile: (key) => remoteControlService.deleteRelayFile(key),
  emitProgress: (event) => safeSend(AgentIpcChannels.REMOTE_UPLOAD_PROGRESS, event),
  now: () => Date.now(),
})
agentService.setMobileReceiveService(mobileReceiveService)

new MobileShareToolCoordinator(sessionManager, {
  enable: registerMobileShareTool,
  disable: unregisterMobileShareTool,
})

const terminalManager = new TerminalManager({
  spawner: nodePtySpawner,
  onEvent: (event) => {
    safeSend(AgentIpcChannels.TERMINAL_EVENT, event)
    void terminalBroadcaster.broadcast(event)
  },
})
const terminalBroadcaster = new TerminalBroadcaster(terminalManager, remoteControlService)
deviceRegistry.setTerminalManager(terminalManager)
agentService.setTerminalManager(terminalManager)
let terminalSweepTimer: ReturnType<typeof setInterval> | null = null

function resolveTerminalCwd(projectPath: string, sessionId?: string): string {
  if (sessionId) {
    const session = sessionManager.getSession(sessionId)
    if (session) return session.cwd
  }
  return projectPath
}

function isGlassEnabled(): boolean {
  return process.platform === 'darwin' && readAppSettings().liquidGlass
}

function glassWindowOptions(): Electron.BrowserWindowConstructorOptions {
  if (!isGlassEnabled() || !currentDarkTheme) return {}
  return { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
}

function applyLiquidGlass(): void {
  if (process.platform !== 'darwin') return
  const active = isGlassEnabled() && currentDarkTheme
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setVibrancy(active ? 'under-window' : null)
    win.setBackgroundColor(active ? '#00000000' : currentDarkTheme ? '#1c1c1c' : '#ffffff')
  }
}

async function applyAppSettingsPatch(patch: AppSettingsPatch): Promise<AppSettings> {
  const result = saveAppSettings(patch)
  if (result.locale) {
    await applyLocale(result.locale)
  }
  if (patch?.updateChannel !== undefined) {
    setUpdateChannel(result.updateChannel)
  }
  if (patch?.liquidGlass !== undefined) {
    applyLiquidGlass()
  }
  if (patch?.cdpEnabled === false) {
    detachAllCdp()
  }
  safeSend(AgentIpcChannels.APP_SETTINGS_CHANGED, result)
  return result
}

function syncNativeAppearance(): void {
  nativeTheme.themeSource = currentThemeMode
}

function broadcastTheme(): void {
  safeSend(AgentIpcChannels.THEME_CHANGED, { mode: currentThemeMode, dark: currentDarkTheme })
}

function setThemeMode(mode: ThemeMode): void {
  if (currentThemeMode === mode) return
  currentThemeMode = mode
  saveAppSettings({ themeMode: mode })
  syncNativeAppearance()
  currentDarkTheme = nativeTheme.shouldUseDarkColors
  applyLiquidGlass()
  broadcastTheme()
}


function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 }, ...glassWindowOptions() }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#888888', height: 40 } }),
    icon: getAppIcon() ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      webviewTag: true,
      additionalArguments: [roleArg(WindowRole.Main), ...glassBootArgs(isGlassEnabled())],
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow?.webContents.getURL()) e.preventDefault()
  })

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.control || input.meta) {
      if (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0') {
        _e.preventDefault()
        const action = input.key === '-' ? 'out' : input.key === '0' ? 'reset' : 'in'
        mainWindow?.webContents.send(AgentIpcChannels.CONTENT_ZOOM, action)
        return
      }
      // Windows/Linux have no application menu, so route the Close-Tab shortcut through
      // host-focus key input here (macOS uses the global menu accelerator instead).
      if (input.key.toLowerCase() === 'w' && input.type === 'keyDown' && process.platform !== 'darwin') {
        _e.preventDefault()
        mainWindow?.webContents.send(AgentIpcChannels.CLOSE_TAB_SHORTCUT)
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
  setCodexSkillsWatcherWindow(mainWindow)
  initWorkerHost(() => mainWindow)
  agentService.setBroadcastFn((event) => safeSend(AgentIpcChannels.EVENT, event))
  agentService.setSessionManager(sessionManager)
  automationService.setMainWindow(mainWindow)
  automationService.setAgentService(agentService)
  automationService.start()
  setBashOutputWindow(mainWindow)

  allWindows.add(mainWindow)
  mainWindow.on('closed', () => {
    if (mainWindow) allWindows.delete(mainWindow)
    mainWindow = null
    destroyDragPreviewWindow()
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

function createSessionWindow(projectPath: string, sessionId: string, title?: string, position?: { x: number; y: number }): void {
  const key = sessionWindowKey(projectPath, sessionId)
  const existing = sessionWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 380,
    height: 640,
    minWidth: 380,
    minHeight: 480,
    ...(position ? { x: Math.round(position.x), y: Math.round(position.y) } : {}),
    title: title ?? 'Session',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 }, ...glassWindowOptions() }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#888888', height: 36 } }),
    icon: getAppIcon() ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      additionalArguments: [roleArg(WindowRole.Mini), ...glassBootArgs(isGlassEnabled())],
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('before-input-event', (_e, input) => {
    if (!is.dev) {
      if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        _e.preventDefault()
        return
      }
      if (input.key === 'F5') _e.preventDefault()
    }
  })

  allWindows.add(win)
  sessionWindows.set(key, win)
  win.on('closed', () => {
    allWindows.delete(win)
    if (sessionWindows.get(key) === win) sessionWindows.delete(key)
  })

  const titleQuery = title ? `&title=${encodeURIComponent(title)}` : ''
  const query = `?mode=miniwindow&project=${encodeURIComponent(projectPath)}&session=${encodeURIComponent(sessionId)}${titleQuery}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${query}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search: query.slice(1) })
  }
}

const DRAG_PREVIEW_WIDTH = 260
let dragPreviewWindow: BrowserWindow | null = null
let dragPreviewTimer: ReturnType<typeof setInterval> | null = null
let dragPreviewActive = false
let dragPreviewOutside = false

function ensureDragPreviewWindow(): BrowserWindow {
  if (dragPreviewWindow && !dragPreviewWindow.isDestroyed()) return dragPreviewWindow
  const win = new BrowserWindow({
    width: DRAG_PREVIEW_WIDTH,
    height: 220,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      backgroundThrottling: false,
      additionalArguments: [roleArg(WindowRole.Mini)],
    },
  })
  win.setIgnoreMouseEvents(true)
  const query = '?mode=dragpreview'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${query}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search: query.slice(1) })
  }
  dragPreviewWindow = win
  return win
}

function stopDragPreview(): void {
  if (dragPreviewTimer) {
    clearInterval(dragPreviewTimer)
    dragPreviewTimer = null
  }
  dragPreviewActive = false
  dragPreviewOutside = false
  if (dragPreviewWindow && !dragPreviewWindow.isDestroyed()) dragPreviewWindow.hide()
}

function destroyDragPreviewWindow(): void {
  stopDragPreview()
  if (dragPreviewWindow && !dragPreviewWindow.isDestroyed()) dragPreviewWindow.destroy()
  dragPreviewWindow = null
}

function startDragPreview(title: string): void {
  if (dragPreviewTimer) clearInterval(dragPreviewTimer)
  dragPreviewActive = true
  dragPreviewOutside = false
  const win = ensureDragPreviewWindow()
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(AgentIpcChannels.DRAG_PREVIEW_UPDATE, { title, dark: currentDarkTheme })
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
  dragPreviewTimer = setInterval(() => {
    if (!dragPreviewActive || !mainWindow || mainWindow.isDestroyed() || win.isDestroyed()) return
    const point = screen.getCursorScreenPoint()
    const b = mainWindow.getBounds()
    const inside = point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height
    if (inside) {
      if (dragPreviewOutside) {
        dragPreviewOutside = false
        win.hide()
        mainWindow.webContents.send(AgentIpcChannels.DRAG_PREVIEW_ZONE, 'inside')
      }
    } else {
      win.setPosition(Math.round(point.x - DRAG_PREVIEW_WIDTH / 2), Math.round(point.y + 8))
      if (!dragPreviewOutside) {
        dragPreviewOutside = true
        win.showInactive()
        mainWindow.webContents.send(AgentIpcChannels.DRAG_PREVIEW_ZONE, 'outside')
      }
    }
  }, 16)
}

let benchWindow: BrowserWindow | null = null

function createBenchWindow(): void {
  if (!is.dev) return
  if (benchWindow && !benchWindow.isDestroyed()) {
    if (benchWindow.isMinimized()) benchWindow.restore()
    benchWindow.focus()
    return
  }
  benchWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Harness Anim Bench',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    icon: getAppIcon() ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      backgroundThrottling: false,
      additionalArguments: [roleArg(WindowRole.Mini)],
    },
  })
  benchWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  allWindows.add(benchWindow)
  benchWindow.on('closed', () => {
    if (benchWindow) allWindows.delete(benchWindow)
    benchWindow = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    benchWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/bench.html`)
  } else {
    benchWindow.loadFile(join(__dirname, '../renderer/bench.html'))
  }
  benchWindow.webContents.openDevTools({ mode: 'detach' })
}

/** Register all IPC handlers once at app startup. */
function setAppFsPermissions(appId: string, manifest: { permissions?: { fs?: Array<{ scope: string; path?: string; access?: string; reason: string }> } }, projectDir: string, installDir: string): void {
  const fsEntries = manifest.permissions?.fs ?? []
  if (fsEntries.length === 0) return
  const dirs = fsEntries.flatMap((entry): AllowedDir[] => {
    switch (entry.scope) {
      case 'project': return [{ path: join(projectDir, entry.path!), access: entry.access as 'read' | 'readwrite', root: projectDir, scope: 'project' }]
      case 'user': return [{ path: join(homedir(), entry.path!), access: entry.access as 'read' | 'readwrite', root: homedir(), scope: 'user' }]
      case 'app': { const dataDir = join(installDir, 'data'); return [{ path: dataDir, access: 'readwrite', root: dataDir, scope: 'app' }] }
      default: return []
    }
  })
  setAllowedDirectories(projectDir, appId, dirs)
}

function setAppMediaPermissions(appId: string, manifest: { permissions?: { media?: Array<{ kind: import('@superone/shared/miniapp-types').MiniAppMediaKind; reason: string }> } }): void {
  const entries = manifest.permissions?.media ?? []
  setAllowedMedia(appId, entries.map((e) => e.kind))
}


function getOrCreateCodexSession(sessionId: string, projectPath: string, cwd?: string, gitBranch?: string | null, apiProviderId?: string | null) {
  const existing = sessionManager.getSession(sessionId)
  if (existing) {
    if (existing.snapshot.harnessId !== 'codex') {
      throw new Error(`Session ${sessionId} is not a codex session (harness=${existing.snapshot.harnessId})`)
    }
    sessionManager.setActiveSession(projectPath, existing.snapshot.id)
    if (apiProviderId != null && existing.snapshot.apiProviderId !== apiProviderId) {
      existing.setApiProviderId(apiProviderId)
    }
    return existing
  }
  const fresh = sessionManager.createSession({
    projectPath,
    id: sessionId,
    providerId: 'codex-base',
    cwd,
    gitBranch: gitBranch ?? null,
    apiProviderId: apiProviderId ?? null,
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
  ipcMain.handle(
    AgentIpcChannels.TERMINAL_CREATE,
    (_e, opts: { projectPath: string; sessionId?: string; title?: string; cols?: number; rows?: number }) => {
      const cwd = resolveTerminalCwd(opts.projectPath, opts.sessionId)
      const session = terminalManager.create({
        cwd,
        title: opts.title ?? (basename(cwd) || 'Terminal'),
        cols: opts.cols,
        rows: opts.rows,
      })
      return session.listItem()
    },
  )
  ipcMain.handle(AgentIpcChannels.TERMINAL_LIST, (_e, cwd?: string) => terminalManager.list(cwd))
  ipcMain.handle(AgentIpcChannels.TERMINAL_SNAPSHOT, async (_e, terminalId: string) => {
    const session = terminalManager.get(terminalId)
    if (!session) return null
    return session.snapshot('local')
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_WRITE, (_e, terminalId: string, data: string) => {
    const session = terminalManager.get(terminalId)
    if (session?.ownership.isWritableBy('local')) session.input(data)
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_RESIZE, (_e, terminalId: string, cols: number, rows: number) => {
    const session = terminalManager.get(terminalId)
    if (session?.ownership.isWritableBy('local')) session.resize(cols, rows)
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_KILL, (_e, terminalId: string) => {
    terminalManager.kill(terminalId)
  })


  // Setup agent IPC handlers (does NOT auto-initialize)
  agentService.setCodexListModels((projectPath) => codexService.listModels(projectPath))
  agentService.setCodexProviderChanged((invalidateModelCache) => codexService.handleProviderChanged(invalidateModelCache))
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

  ipcMain.handle(AgentIpcChannels.GET_PROJECT_ID, (_event, folderPath: string) => {
    return getProjectId(folderPath)
  })

  ipcMain.handle(AgentIpcChannels.OPEN_FOLDER, async (_event, folderPath: string) => {
    if (!existsSync(folderPath)) return false
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

  ipcMain.on(AgentIpcChannels.CLOSE_WINDOW, () => {
    mainWindow?.close()
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null },
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const persistedUserMessageId = userMessageId ?? `user_${Date.now()}`
      const session = getOrCreateCodexSession(sessionId, projectPath, cwd, gitBranch, extras?.apiProviderId)
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

  ipcMain.handle(AgentIpcChannels.CODEX_LIST_MODELS, async (_event, projectPath: string, apiProviderId?: string | null, force?: boolean) => {
    let models = await codexService.listModels(projectPath, apiProviderId ?? null, force ?? false)
    const resolved = resolveChatService('codex', apiProviderId ?? null)
    log.debug('[CODEX_LIST_MODELS] raw=%d protocol=%s models=%d hasMapping=%s apiProvider=%s',
      models.length, resolved?.protocol ?? 'null', resolved?.models?.length ?? 0, String(Boolean(resolved?.modelMapping)), apiProviderId ?? 'null')
    if (resolved && resolved.protocol === 'openai-chat' && !getCodexProviderOverrideFor(apiProviderId ?? null)) {
      const catalogById = new Map<string, string>()
      for (const m of (resolved.models ?? [])) if (m.name) catalogById.set(m.id, m.name)
      const mapped = new Map<string, ModelOption>()
      for (const m of (resolved.models ?? [])) mapped.set(m.id, { id: m.id, name: m.name ?? m.id, description: '', isDefault: false })
      for (const slot of Object.values(resolved.modelMapping ?? {})) {
        if (!slot.id) continue
        const strippedId = slot.id.replace(/\[1m\]/i, '')
        if (!mapped.has(strippedId)) {
          const name = slot.name?.replace(/\[1m\]/i, '').trim() || catalogById.get(strippedId) || strippedId
          mapped.set(strippedId, { id: strippedId, name, description: '', isDefault: true })
        }
      }
      models = [...mapped.values()]
      log.debug('[CODEX_LIST_MODELS] overrode with %d models (enabled=%d mapped=%d)',
        models.length, resolved.models?.length ?? 0, Object.keys(resolved.modelMapping ?? {}).length)
    }
    if (apiProviderId == null) {
      const current = getCachedHarnessResources('codex')
      setCachedHarnessResources('codex', { models, prompts: current?.prompts ?? [] })
    }
    log.info('[CODEX_LIST_MODELS] response project=%s apiProvider=%s models=%s', projectPath, apiProviderId ?? 'default', JSON.stringify(models))
    return models
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_AUTH_STATUS, (_event, projectPath: string) => {
    return codexService.getAuthStatus(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_RATE_LIMITS, (_event, projectPath: string, apiProviderId?: string | null) => {
    return codexService.getRateLimits(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_ACCOUNT_USAGE, (_event, projectPath: string, apiProviderId?: string | null) => {
    return codexService.getAccountUsage(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_CONSUME_RATE_LIMIT_RESET, (_event, projectPath: string, apiProviderId?: string | null, creditId?: string | null) => {
    return codexService.consumeRateLimitReset(projectPath, apiProviderId ?? null, creditId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_OAUTH_LOGIN, (_event, projectPath: string, serverName: string, apiProviderId?: string | null) => {
    return codexService.loginMcpServerOauth(projectPath, serverName, apiProviderId ?? null, (url) => shell.openExternal(url))
  })

  ipcMain.handle(AgentIpcChannels.CODEX_EXTERNAL_AGENT_DETECT, (_event, projectPath: string, apiProviderId?: string | null) => {
    return codexService.detectExternalAgentConfig(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_EXTERNAL_AGENT_IMPORT, (_event, projectPath: string, items: CodexExternalAgentItem[], apiProviderId?: string | null) => {
    return codexService.importExternalAgentConfig(projectPath, items, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_GET_RATE_LIMITS, (_event, force?: boolean) => {
    return getClaudeRateLimits(force ?? false)
  })

  ipcMain.handle(AgentIpcChannels.PROVIDER_GET_RATE_LIMITS, (_event, apiProviderId: string, force?: boolean) => {
    return getProviderRateLimits(apiProviderId, force ?? false)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_SET_AUTH, (_event, projectPath: string, request: CodexSetAuthRequest) => {
    return codexService.setAuth(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_HOOKS_LIST, (_event, projectPath: string) => {
    return codexHooksService.list(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GOAL_GET, (_event, sessionId: string, threadId: string) => {
    const session = getCodexSession(sessionId)
    if (!session) throw new Error(`CODEX_GOAL_GET: no codex session found for sid=${sessionId}`)
    return session.getCodexGoal(threadId)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GOAL_SET, (_event, sessionId: string, threadId: string, objective: string, status?: import('@superone/shared/agent-types').CodexGoalStatus) => {
    const session = getCodexSession(sessionId)
    if (!session) throw new Error(`CODEX_GOAL_SET: no codex session found for sid=${sessionId}`)
    return session.setCodexGoal(threadId, objective, status)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GOAL_CLEAR, (_event, sessionId: string, threadId: string) => {
    const session = getCodexSession(sessionId)
    if (!session) throw new Error(`CODEX_GOAL_CLEAR: no codex session found for sid=${sessionId}`)
    return session.clearCodexGoal(threadId)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MARKETPLACE_ADD, (_event, projectPath: string, request: import('@superone/shared/agent-types').CodexMarketplaceAddRequest) => {
    return codexMarketplaceService.add(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MARKETPLACE_REMOVE, (_event, projectPath: string, marketplaceName: string) => {
    return codexMarketplaceService.remove(projectPath, marketplaceName)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MARKETPLACE_UPGRADE, (_event, projectPath: string, marketplaceName?: string) => {
    return codexMarketplaceService.upgrade(projectPath, marketplaceName)
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null },
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const session = getOrCreateCodexSession(sessionId, projectPath, cwd, gitBranch, extras?.apiProviderId)
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null },
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const session = getOrCreateCodexSession(sessionId, projectPath, cwd, gitBranch, extras?.apiProviderId)
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
      const status = await gitRun(folderPath, ['status', '--porcelain', '-uall'])
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
        try {
          const untrackedRaw = await gitRun(folderPath, ['ls-files', '--others', '--exclude-standard', '-z'])
          const untracked = untrackedRaw ? untrackedRaw.split('\0').filter(Boolean) : []
          for (const rel of untracked) {
            try {
              const abs = join(folderPath, rel)
              const fileStat = await stat(abs)
              if (!fileStat.isFile()) continue
              const buf = await readFile(abs)
              if (buf.includes(0)) continue
              let count = 0
              for (let i = 0; i < buf.length; i++) {
                if (buf[i] === 0x0a) count++
              }
              if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) count++
              insertions += count
            } catch {
              /* skip unreadable */
            }
          }
        } catch {
          /* no untracked or git unavailable */
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

  ipcMain.handle(AgentIpcChannels.GIT_IS_REPO, (_event, folderPath: string) => {
    return existsSync(join(folderPath, '.git'))
  })

  ipcMain.handle(AgentIpcChannels.GIT_INIT, async (_event, folderPath: string) => {
    if (!existsSync(folderPath)) return { ok: false, error: 'Folder does not exist' }
    if (existsSync(join(folderPath, '.git'))) return { ok: true }
    try {
      await gitRun(folderPath, ['init'])
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('[GIT_INIT] failed for %s: %s', folderPath, error)
      return { ok: false, error }
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

  ipcMain.handle(AgentIpcChannels.GIT_HANDOFF_TO_LOCAL, async (_event, worktreePath: string) => {
    try {
      return await handoffToLocal(worktreePath)
    } catch (err) {
      log.warn('[handoff] unexpected failure:', err)
      return { ok: false as const, reason: 'error' as const, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_HANDOFF_PREVIEW, async (_event, worktreePath: string) => {
    return getHandoffPreview(worktreePath)
  })

  ipcMain.handle(AgentIpcChannels.GIT_ASSIGN_BRANCH, async (_event, folderPath: string, worktreePath: string, name: string) => {
    const result = await assignBranch(worktreePath, name)
    if (result.ok) await agentService.switchCwd(folderPath, worktreePath, result.branch)
    return result
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
  const BINARY_SNIFF_BYTES = 8192
  const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

  async function detectTextOrBinary(fullPath: string): Promise<'text' | 'binary' | 'too-large'> {
    const st = await stat(fullPath)
    if (st.size > MAX_TEXT_FILE_BYTES) return 'too-large'
    if (st.size === 0) return 'text'
    const fd = await open(fullPath, 'r')
    try {
      const sniffSize = Math.min(BINARY_SNIFF_BYTES, st.size)
      const buf = Buffer.alloc(sniffSize)
      await fd.read(buf, 0, sniffSize, 0)
      return buf.includes(0) ? 'binary' : 'text'
    } finally {
      await fd.close()
    }
  }

  ipcMain.handle(AgentIpcChannels.READ_PROJECT_FILE, async (_event, folderPath: string, filePath: string) => {
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
      const kind = await detectTextOrBinary(fullPath)
      if (kind === 'binary') return { path: filePath, content: '', language: 'binary' }
      if (kind === 'too-large') return { path: filePath, content: '', language: 'too-large' }
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

  const GIT_STATUS_PRIORITY: Record<string, number> = { U: 6, D: 5, R: 4, C: 4, M: 3, A: 2, '?': 1 }

  const IGNORED_PAIR: GitStatusPair = { index: null, worktree: '!' }
  const EMPTY_PAIR: GitStatusPair = { index: null, worktree: null }

  function isPairIgnored(p: GitStatusPair | undefined): boolean {
    return p?.index === '!' || p?.worktree === '!'
  }

  async function entryIsDirectory(
    dir: string,
    entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
  ): Promise<boolean> {
    if (entry.isDirectory()) return true
    if (entry.isSymbolicLink()) {
      try {
        return (await stat(join(dir, entry.name))).isDirectory()
      } catch {
        return false
      }
    }
    return false
  }

  async function decorateEntries<T extends { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>(
    dir: string,
    entries: T[],
  ): Promise<{ entry: T; isDir: boolean }[]> {
    const decorated = await Promise.all(
      entries.map(async (entry) => ({ entry, isDir: await entryIsDirectory(dir, entry) })),
    )
    return decorated.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.entry.name.localeCompare(b.entry.name)
    })
  }

  function worstColumn(values: (GitFileStatus | null | undefined)[]): GitFileStatus | null {
    let worst: GitFileStatus | null = null
    let worstPri = 0
    for (const s of values) {
      if (!s || s === '!') continue
      const pri = GIT_STATUS_PRIORITY[s] ?? 0
      if (pri > worstPri) { worst = s; worstPri = pri }
    }
    return worst
  }

  function worstChildPair(children: FileTreeEntry[]): GitStatusPair {
    return {
      index: worstColumn(children.map((c) => c.gitIndex ?? null)),
      worktree: worstColumn(children.map((c) => c.gitWorktree ?? null)),
    }
  }

  function dirStatusPair(statusMap: Map<string, GitStatusPair>, dirRelPath: string): GitStatusPair {
    const prefix = dirRelPath + '/'
    let worstIdx: GitFileStatus | null = null
    let worstIdxPri = 0
    let worstWt: GitFileStatus | null = null
    let worstWtPri = 0
    for (const [path, pair] of statusMap) {
      if (!path.startsWith(prefix)) continue
      if (isPairIgnored(pair)) continue
      if (pair.index) {
        const pri = GIT_STATUS_PRIORITY[pair.index] ?? 0
        if (pri > worstIdxPri) { worstIdx = pair.index; worstIdxPri = pri }
      }
      if (pair.worktree) {
        const pri = GIT_STATUS_PRIORITY[pair.worktree] ?? 0
        if (pri > worstWtPri) { worstWt = pair.worktree; worstWtPri = pri }
      }
    }
    return { index: worstIdx, worktree: worstWt }
  }

  ipcMain.handle(AgentIpcChannels.GIT_FILE_TREE, async (_event, folderPath: string) => {
    try {
      let statusMap = new Map<string, GitStatusPair>()
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

        const sorted = await decorateEntries(dir, entries)

        for (const { entry, isDir } of sorted) {
          if (SKIP_DIRS.has(entry.name)) continue
          if (entry.name === '.DS_Store') continue

          const fullPath = join(dir, entry.name)
          const relPath = relative(folderPath, fullPath)
          const isIgnored = parentIgnored || ignoredDirs.has(relPath) || isPairIgnored(statusMap.get(relPath))

          if (isDir) {
            const children = await walk(fullPath, isIgnored)
            const pair = isIgnored ? IGNORED_PAIR : worstChildPair(children)
            result.push({
              name: entry.name,
              path: relPath,
              isDirectory: true,
              children,
              gitIndex: pair.index,
              gitWorktree: pair.worktree,
            })
          } else {
            const pair = isIgnored ? IGNORED_PAIR : (statusMap.get(relPath) ?? EMPTY_PAIR)
            result.push({
              name: entry.name,
              path: relPath,
              isDirectory: false,
              gitIndex: pair.index,
              gitWorktree: pair.worktree,
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
  const gitStatusSnapshotCache = new Map<string, { at: number; statusMap: Map<string, GitStatusPair>; ignoredDirs: Set<string> }>()
  const gitStatusInFlight = new Map<string, Promise<{ statusMap: Map<string, GitStatusPair>; ignoredDirs: Set<string> }>>()

  async function getGitStatusMap(folderPath: string) {
    const now = Date.now()
    const cached = gitStatusSnapshotCache.get(folderPath)
    if (cached && now - cached.at < GIT_STATUS_CACHE_TTL_MS) {
      return { statusMap: cached.statusMap, ignoredDirs: cached.ignoredDirs }
    }
    const inFlight = gitStatusInFlight.get(folderPath)
    if (inFlight) return inFlight

    const promise = (async () => {
      let statusMap = new Map<string, GitStatusPair>()
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

  ipcMain.handle(AgentIpcChannels.GIT_LIST_DIR, async (_event, folderPath: string, dirRelPath: string) => {
    try {
      const { statusMap, ignoredDirs } = await getGitStatusMap(folderPath)
      const targetDir = dirRelPath ? join(folderPath, dirRelPath) : folderPath
      const entries = await readdir(targetDir, { withFileTypes: true })

      const sorted = await decorateEntries(targetDir, entries)

      const result: FileTreeEntry[] = []
      for (const { entry, isDir } of sorted) {
        if (SKIP_DIRS.has(entry.name) || entry.name === '.DS_Store') continue
        const relPath = dirRelPath ? dirRelPath + '/' + entry.name : entry.name
        const isIgnored = ignoredDirs.has(relPath) || isPairIgnored(statusMap.get(relPath))

        if (isDir) {
          const pair = isIgnored ? IGNORED_PAIR : dirStatusPair(statusMap, relPath)
          result.push({
            name: entry.name,
            path: relPath,
            isDirectory: true,
            children: undefined,
            gitIndex: pair.index,
            gitWorktree: pair.worktree,
          })
        } else {
          const pair = isIgnored ? IGNORED_PAIR : (statusMap.get(relPath) ?? EMPTY_PAIR)
          result.push({
            name: entry.name,
            path: relPath,
            isDirectory: false,
            gitIndex: pair.index,
            gitWorktree: pair.worktree,
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

  ipcMain.handle(AgentIpcChannels.SHOW_CONTEXT_MENU, async (event, items: NativeContextMenuItemSpec[]) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return await new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      const build = (specs: NativeContextMenuItemSpec[]): Electron.MenuItemConstructorOptions[] =>
        specs.map((spec) => {
          if (spec.type === 'separator') return { type: 'separator' }
          const item: Electron.MenuItemConstructorOptions = {
            label: spec.label,
            enabled: spec.enabled !== false,
          }
          if (spec.iconDataUrl) {
            const icon = nativeImage.createEmpty()
            icon.addRepresentation({ scaleFactor: 2, dataURL: spec.iconDataUrl })
            icon.setTemplateImage(true)
            item.icon = icon
          }
          if (spec.submenu) item.submenu = build(spec.submenu)
          else item.click = () => { chosen = spec.id ?? null }
          return item
        })
      const menu = Menu.buildFromTemplate(build(items))
      menu.popup({ window: win, callback: () => resolve(chosen) })
    })
  })

  const startDragWithIcon = (event: Electron.IpcMainEvent, files: string[], icon: Electron.NativeImage): void => {
    if (icon.isEmpty()) {
      log.warn('[start-drag] skipped: empty drag icon for %s', files[0])
      return
    }
    event.sender.startDrag({ files, file: files[0], icon })
  }

  ipcMain.on(AgentIpcChannels.START_DRAG, async (event, paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }) => {
    try {
      const { existsSync } = await import('node:fs')
      const { nativeImage } = await import('electron')
      const plan = await planStartDrag(paths, iconOpts, {
        exists: existsSync,
        createFromBuffer: (buf, opts) => nativeImage.createFromBuffer(buf, opts),
        getFileIcon: (filePath) => app.getFileIcon(filePath, { size: 'small' }),
      })
      if (!plan) {
        log.warn('[start-drag] skipped: no draggable files/icon for %o', paths)
        return
      }
      event.sender.startDrag({ files: plan.files, file: plan.files[0], icon: plan.icon })
    } catch (err) {
      log.warn('[start-drag] failed:', err)
    }
  })

  ipcMain.on(
    AgentIpcChannels.MINIAPP_START_DRAG,
    async (
      event,
      projectDir: string,
      appId: string,
      relPaths: string[],
      iconOpts?: { png: ArrayBuffer; scaleFactor?: number },
    ) => {
      if (!Array.isArray(relPaths) || relPaths.length === 0) return
      try {
        const dirs = getAllowedDirs(projectDir, appId)
        if (!dirs || dirs.length === 0) {
          log.warn('[miniapp start-drag] no allowed dirs for appId=%s', appId)
          return
        }
        const { existsSync } = await import('node:fs')
        const files: string[] = []
        for (const rel of relPaths) {
          if (typeof rel !== 'string') continue
          const { resolved } = resolveSafePathMulti(dirs, rel)
          if (existsSync(resolved)) files.push(resolved)
          else log.warn('[miniapp start-drag] file not found: %s', resolved)
        }
        if (files.length === 0) return
        const { nativeImage } = await import('electron')
        let icon: Electron.NativeImage
        if (iconOpts?.png) {
          // Caller-supplied icon (e.g. the runtime's filename pill).
          icon = nativeImage.createFromBuffer(Buffer.from(iconOpts.png), {
            scaleFactor: iconOpts.scaleFactor ?? 1,
          })
        } else if (/\.(png|jpe?g|gif|webp|bmp|avif|ico|tiff?)$/i.test(files[0])) {
          // Image file: build a small, faded thumbnail from the file itself.
          const full = nativeImage.createFromPath(files[0])
          if (full.isEmpty()) {
            icon = await app.getFileIcon(files[0], { size: 'small' })
          } else {
            const { width, height } = full.getSize()
            const scale = Math.min(1, 120 / Math.max(width, height))
            const small =
              scale < 1 ? full.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : full
            try {
              const size = small.getSize()
              const bmp = small.toBitmap()
              for (let i = 3; i < bmp.length; i += 4) bmp[i] = Math.round(bmp[i] * 0.65)
              icon = nativeImage.createFromBitmap(bmp, { width: size.width, height: size.height, scaleFactor: 1 })
            } catch {
              icon = small
            }
          }
        } else {
          icon = await app.getFileIcon(files[0], { size: 'small' })
        }
        startDragWithIcon(event, files, icon)
      } catch (err) {
        log.warn('[miniapp start-drag] failed:', err)
      }
    },
  )

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

  ipcMain.handle(AgentIpcChannels.MEDIA_GEN_PROVIDERS, () => getMediaProviderStatuses())

  ipcMain.handle(AgentIpcChannels.MODEL_CATALOG_GET, async () => {
    const { getModelCatalog } = await import('./model-catalog')
    return getModelCatalog()
  })

  ipcMain.handle(AgentIpcChannels.MODEL_CATALOG_REFRESH, async () => {
    const { refreshModelCatalog } = await import('./model-catalog')
    return refreshModelCatalog()
  })

  ipcMain.handle(AgentIpcChannels.LIST_WORKFLOW_AGENTS, async (_event, transcriptDir: string) => {
    if (typeof transcriptDir !== 'string' || !isAbsolute(transcriptDir)) return []
    return listWorkflowAgents(transcriptDir)
  })

  ipcMain.handle(AgentIpcChannels.READ_WORKFLOW_OUTPUT, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) return null
    return readWorkflowOutput(filePath)
  })

  ipcMain.handle(AgentIpcChannels.READ_WORKFLOW_SCRIPT, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) return null
    return readWorkflowScript(filePath)
  })

  ipcMain.handle(AgentIpcChannels.READ_SUBAGENT_TRANSCRIPT, async (_event, outputFile: string, dir?: string) => {
    if (typeof outputFile !== 'string' || !isAbsolute(outputFile)) return null
    return readSubagentTranscript(outputFile, typeof dir === 'string' ? dir : undefined)
  })

  ipcMain.handle(AgentIpcChannels.SAVE_FILE_AS, async (_event, sourcePath: string, defaultName: string, defaultDir?: string) => {
    try {
      if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) {
        return { ok: false, error: 'Source path must be absolute' }
      }
      await access(sourcePath)
      const ext = extname(sourcePath).toLowerCase().replace(/^\./, '') || 'png'
      const name = defaultName || basename(sourcePath)
      const defaultPath = defaultDir && isAbsolute(defaultDir) ? join(defaultDir, name) : name
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        defaultPath,
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

  ipcMain.handle(AgentIpcChannels.CLIPBOARD_WRITE_IMAGE, async (_event, absPath: string) => {
    const { nativeImage } = await import('electron')
    const img = nativeImage.createFromPath(absPath)
    if (img.isEmpty()) return { ok: false, error: 'Failed to read image' }
    clipboard.writeImage(img)
    return { ok: true }
  })

  ipcMain.handle(AgentIpcChannels.BROWSER_FETCH_IMAGE, async (_event, url: string) => {
    try {
      if (typeof url !== 'string') return { ok: false, error: 'Invalid URL' }
      const { buf, mimeType } = await fetchBrowserBytes(url, 'image/png')
      return { ok: true, base64: buf.toString('base64'), mimeType }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    AgentIpcChannels.BROWSER_SAVE_IMAGE,
    async (_event, base64: string, mimeType: string, suggestedName: string, defaultDir?: string) => {
      try {
        const ext = (mimeType.split('/')[1]?.split('+')[0] || 'png').toLowerCase()
        const name = suggestedName || `image.${ext}`
        const defaultPath = defaultDir && isAbsolute(defaultDir) ? join(defaultDir, name) : name
        const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
          defaultPath,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        })
        if (result.canceled || !result.filePath) return { ok: false, canceled: true }
        await writeFile(result.filePath, Buffer.from(base64, 'base64'))
        return { ok: true, savedPath: result.filePath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
  )

  ipcMain.handle(AgentIpcChannels.BROWSER_COPY_IMAGE_AT, (_event, webContentsId: number, x: number, y: number) => {
    const contents = webContents.fromId(webContentsId)
    if (!contents) return { ok: false, error: 'No web contents' }
    contents.copyImageAt(Math.round(x), Math.round(y))
    return { ok: true }
  })

  ipcMain.handle(AgentIpcChannels.REVEAL_FILE, (_event, absPath: string) => {
    shell.showItemInFolder(absPath)
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

    const colorEnv = buildSafeEnv({
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
      CLICOLOR_FORCE: '1',
    })
    const child = isWin
      ? spawn('powershell', ['-NoProfile', '-Command', installCmd], { env: colorEnv, argv0: ProcessTitle.Installer })
      : spawn('bash', ['-c', installCmd], { env: colorEnv, argv0: ProcessTitle.Installer })

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

  ipcMain.handle(AgentIpcChannels.ACP_SET_UNSAVED_BUFFER, (_e, filePath: string, content: string | null) => {
    if (typeof filePath !== 'string' || !filePath) return
    setUnsavedBuffer(filePath, content)
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
  ipcMain.handle(AgentIpcChannels.APP_SETTINGS_SAVE, (_e, patch) => applyAppSettingsPatch(patch))
  ipcMain.handle(AgentIpcChannels.APP_SYSTEM_LOCALE, () => getSystemLocale())

  ipcMain.handle(AgentIpcChannels.BROWSER_HISTORY_RECORD, (_e, url: string, title: string, titleOnly?: boolean) => recordBrowserHistory(url, title, titleOnly))
  ipcMain.handle(AgentIpcChannels.BROWSER_HISTORY_SUGGEST, (_e, query: string, limit?: number) => suggestBrowserHistory(query, limit))
  ipcMain.handle(AgentIpcChannels.BROWSER_HISTORY_DELETE, (_e, url: string | null) => deleteBrowserHistory(url))

  if (is.dev) {
  ipcMain.handle(AgentIpcChannels.APP_ICON_PICK_FILE, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: t('settings.general.appIcon.label'),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(AgentIpcChannels.APP_ICON_SET, (_e, pngDataUri: string) => {
    const match = /^data:image\/png;base64,(.+)$/.exec(pngDataUri ?? '')
    if (!match) throw new Error('App icon must be a PNG data URI')
    const buffer = Buffer.from(match[1], 'base64')
    const storedPath = storeCustomIcon(buffer)
    const settings = saveAppSettings({ customAppIconPath: storedPath })
    applyAppIcon(storedPath, allWindows)
    safeSend(AgentIpcChannels.APP_SETTINGS_CHANGED, settings)
    return settings
  })

  ipcMain.handle(AgentIpcChannels.APP_ICON_RESET, () => {
    clearStoredCustomIcons()
    const settings = saveAppSettings({ customAppIconPath: null })
    applyAppIcon(null, allWindows)
    safeSend(AgentIpcChannels.APP_SETTINGS_CHANGED, settings)
    return settings
  })
  }

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
  ipcMain.handle(AgentIpcChannels.REMOTE_GET_LAN_STATUS, () => remoteControlService.isLanActive())
  ipcMain.handle(AgentIpcChannels.REMOTE_GET_HOSTNAME, () => hostname())
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

  ipcMain.handle(AgentIpcChannels.OPEN_SESSION_WINDOW, (_e, projectPath: string, sessionId: string, title?: string, position?: { x: number; y: number }) => {
    if (!projectPath || !sessionId) return
    createSessionWindow(projectPath, sessionId, title, position)
  })

  ipcMain.handle(AgentIpcChannels.DRAG_PREVIEW_START, (_e, title: string) => {
    startDragPreview(title ?? '')
  })

  ipcMain.handle(AgentIpcChannels.DRAG_PREVIEW_END, () => {
    stopDragPreview()
  })

  ipcMain.handle(AgentIpcChannels.SET_WINDOW_ALWAYS_ON_TOP, (_e, value: boolean): boolean => {
    const win = BrowserWindow.fromWebContents(_e.sender)
    if (!win || win.isDestroyed()) return false
    win.setAlwaysOnTop(value)
    return win.isAlwaysOnTop()
  })

  ipcMain.handle(AgentIpcChannels.GET_THEME, () => ({ mode: currentThemeMode, dark: currentDarkTheme }))

  ipcMain.handle(AgentIpcChannels.SET_THEME, (_e, mode: ThemeMode): void => {
    setThemeMode(mode)
  })

  ipcMain.handle(AgentIpcChannels.BROADCAST_SESSION_SETTING, (_e, sessionId: string, patch: import('@superone/shared/agent-types').SessionSettingsPatch): void => {
    if (!sessionId || !patch || Object.keys(patch).length === 0) return
    const session = sessionManager.getSession(sessionId)
    if (session) {
      session.broadcastSettingsPatch(patch)
      return
    }
    safeSend(AgentIpcChannels.EVENT, { type: 'agent_setting_change', sessionId, patch })
  })

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
    const acp = getCachedHarnessResources('acp')
    const opencode = getCachedHarnessResources('opencode')
    const sandboxCapability = getSandboxCapability()
    log.info(
      '[GET_STARTUP_DATA] cached: claude=%s codex=%s acp=%s opencode=%s sandbox=%s',
      claude ? `${claude.models?.length ?? 0} models` : 'null',
      codex ? `${codex.models?.length ?? 0} models` : 'null',
      acp ? `${acp.agents?.length ?? 0} agents` : 'null',
      opencode ? `${opencode.models?.length ?? 0} models` : 'null',
      sandboxCapability.supportLevel,
    )
    return { cached: { claude, codex, acp, opencode }, sandboxCapability, appVersion: app.getVersion() }
  })

  ipcMain.handle(AgentIpcChannels.SANDBOX_PROBE, async () => {
    return probeSandboxDependencies()
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CLAUDE, async (_e, force?: boolean): Promise<ClaudeResources> => {
    const CLAUDE_RESOURCES_CACHE_TTL_MS = 24 * 60 * 60 * 1000
    const cached = getCachedHarnessResources('claude')
    const cacheAgeMs = getHarnessResourceCacheAgeMs('claude')
    const skills = discoverUserSkills()
    const userCommands = discoverUserCommands()
    const agents = discoverUserAgents()
    if (!force && cached && cacheAgeMs !== null && cacheAgeMs < CLAUDE_RESOURCES_CACHE_TTL_MS) {
      log.info('[CONNECT_CLAUDE] cache fresh (ageMs=%d), skipping CLI query', cacheAgeMs)
      const resources: ClaudeResources = { ...cached, skills, commands: userCommands, agents }
      setCachedHarnessResources('claude', resources)
      return resources
    }

    const probeCwd = resolveProbeCwd()
    log.info('[CONNECT_CLAUDE] cwd:', probeCwd)
    log.info('[CONNECT_CLAUDE] platform=%s arch=%s', process.platform, process.arch)
    const q = query({
      prompt: 'hi',
      options: { cwd: probeCwd, pathToClaudeCodeExecutable: resolveSdkClaudeBinary(), maxTurns: 0, permissionMode: 'default', persistSession: false },
    })
    try {
      log.info('[CONNECT_CLAUDE] Fetching models, account, commands...')
      const drainResult = (async (): Promise<SDKResultMessage | null> => {
        for await (const msg of q) {
          if (msg.type === 'result') return msg
        }
        return null
      })()
      const [modelInfos, accountInfo, commands, initResult, resultMessage] = await Promise.all([
        q.supportedModels(),
        q.accountInfo(),
        q.supportedCommands(),
        q.initializationResult(),
        drainResult,
      ])
      log.info('[CONNECT_CLAUDE] Fetch complete, closing query...')
      q.close()

      if (resultMessage) {
        log.info(
          '[CONNECT_CLAUDE] handshake result subtype=%s costUSD=%d usage=%s modelUsage=%s',
          resultMessage.subtype,
          resultMessage.total_cost_usd,
          JSON.stringify(resultMessage.usage),
          JSON.stringify(resultMessage.modelUsage),
        )
      } else {
        log.warn('[CONNECT_CLAUDE] handshake result message never arrived')
      }
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

  ipcMain.handle(AgentIpcChannels.CONNECT_OPENCODE, async () => {
    const cached = getCachedHarnessResources('opencode')
    try {
      const resources = await probeOpenCodeResources({ cwd: resolveProbeCwd() })
      setCachedHarnessResources('opencode', resources)
      return resources
    } catch (error) {
      log.warn('[CONNECT_OPENCODE] failed: %s', error instanceof Error ? error.message : String(error))
      return cached ?? { models: [], agents: [] }
    }
  })

  ipcMain.handle(AgentIpcChannels.WIDGET_IFRAME_READY, (_e, widgetId: string) => {
    notifyWidgetReady(widgetId)
  })

  ipcMain.handle(AgentIpcChannels.WIDGET_SAVE_TEMPLATE, async (_e, projectPath: string | null, input: SaveWidgetTemplateRequest) => {
    const { allocateTemplateId, saveTemplate } = await import('./generative-ui/template-store')
    const roots = { project: projectPath ?? undefined, user: homedir() }
    if (input.scope === 'project' && !roots.project) throw new Error('no project open')
    const id = allocateTemplateId(roots, input.id, input.scope)
    const saved = saveTemplate(roots, { ...input, id })
    return { id: saved.id, scope: saved.scope, version: saved.version }
  })

  initSuperoneMcpServer(() => mainWindow)
  initBrowserAutomation(() => mainWindow)
  setSessionHostProvider(() => sessionManager)
  setAppSettingsApplier(applyAppSettingsPatch)
  setBrowserDownloadTaskHost({
    emitHostEvent(sessionId, event) {
      sessionManager.getSession(sessionId)?.emitHostEvent(event)
    },
    async injectTaskNotification(sessionId, content) {
      const session = sessionManager.getSession(sessionId)
      if (!session) throw new Error(`Session ${sessionId} not found`)
      await session.injectTaskNotification(content)
    },
  })

  // When a session's app-tool set changes (mini-app opened/closed/@-mentioned),
  // ask its backend to refresh MCP servers. Codex snapshots tools once per thread
  // and ignores `tools/list_changed`, so it needs an explicit reload to pick up
  // the new tools on the next turn; Claude no-ops. Debounced per session (see
  // mcp-reload-scheduler) to coalesce bursts; the timer is cancelled on session
  // dispose so a reload never fires against a torn-down session.
  addToolsChangedListener((sessionId) => {
    scheduleMcpReload(sessionId, () => {
      sessionManager.getSession(sessionId)?.reloadMcpServers().catch((err) =>
        log.debug('[mcp-reload] reloadMcpServers failed for %s: %s', sessionId, err instanceof Error ? err.message : String(err)),
      )
    })
  })
  setPeerBroadcaster((sessionId, appId, event, payload) => {
    const hasWin = !!(mainWindow && !mainWindow.isDestroyed())
    trace('miniapp.peer', 'broadcast', { sessionId, appId, event, payload, hasMainWindow: hasWin })
    if (hasWin) {
      mainWindow!.webContents.send('miniapp-peer-event', { sessionId, appId, event, payload })
    }
  })

  ipcMain.on(AgentIpcChannels.MINIAPP_PEER_EMIT, (_e, appId: string, event: string, payload: unknown) => {
    if (typeof appId !== 'string' || typeof event !== 'string') return
    emitPeer('', appId, event, payload)
  })

  startSuperoneMcpStdioBridge().catch((err) => log.error('[mcp-stdio-ipc] failed to start:', err))

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
    }
    return apps
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_OPEN, async (_e, appId: string, projectDir: string, sessionId: string) => {
    const basePath = getAppBasePath(appId)
    const installDir = getAppInstallDir(appId)
    const manifest = await readManifest(basePath)
    if (!manifest) throw new Error(`App not found: ${appId}`)
    const projectAppKey = `${projectDir}::${appId}`
    let sessions = miniAppSessionRefs.get(projectAppKey)
    if (!sessions) {
      sessions = new Set()
      miniAppSessionRefs.set(projectAppKey, sessions)
    }
    const isFirstSessionForApp = sessions.size === 0
    sessions.add(sessionId)
    if (isFirstSessionForApp) {
      setAppFsPermissions(appId, manifest, projectDir, installDir)
      setAppMediaPermissions(appId, manifest)
      registerAppTemplates(projectDir, appId, manifest.templates)
    }
    const toolSlug = manifest.toolSlug ?? appId
    registerAppTools(sessionId, projectDir, appId, toolSlug, manifest.tools ?? [])
    loadPreapprovedTools(appId, toolSlug, basePath)
    if (manifest.tools?.length) agentService.markSessionNeedsRebuild(sessionId, 'codex')
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_AUTHORIZE, async (_e, appIds: string[], projectDir: string, sessionId: string) => {
    log.info('[MINIAPP_AUTHORIZE] called appIds=%j projectDir=%s sessionId=%s', appIds, projectDir, sessionId)
    if (!Array.isArray(appIds) || appIds.length === 0) {
      log.warn('[MINIAPP_AUTHORIZE] empty appIds, skip')
      return
    }
    let registeredAny = false
    for (const appId of appIds) {
      const basePath = getAppBasePath(appId)
      const installDir = getAppInstallDir(appId)
      const manifest = await readManifest(basePath)
      if (!manifest) {
        log.warn('[MINIAPP_AUTHORIZE] no manifest for appId=%s basePath=%s', appId, basePath)
        continue
      }
      setAppFsPermissions(appId, manifest, projectDir, installDir)
      registerAppTemplates(projectDir, appId, manifest.templates)
      const toolSlug = manifest.toolSlug ?? appId
      registerAppTools(sessionId, projectDir, appId, toolSlug, manifest.tools ?? [])
      loadPreapprovedTools(appId, toolSlug, basePath)
      if (manifest.tools?.length) {
        registeredAny = true
        log.info('[MINIAPP_AUTHORIZE] registered %d tools for appId=%s sessionId=%s', manifest.tools.length, appId, sessionId)
      } else {
        log.info('[MINIAPP_AUTHORIZE] manifest has no tools for appId=%s', appId)
      }
    }
    if (registeredAny) agentService.markSessionNeedsRebuild(sessionId, 'codex')
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_UNAUTHORIZE, async (_e, appIds: string[], _projectDir: string, sessionId: string) => {
    if (!Array.isArray(appIds) || appIds.length === 0) return
    for (const appId of appIds) {
      unregisterAppTools(sessionId, appId)
    }
    agentService.markSessionNeedsRebuild(sessionId, 'codex')
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_CLOSE, async (_e, appId: string, projectDir: string, sessionId: string) => {
    // Closing the panel is purely a UI action. Tools, templates, and fs/media
    // permissions stay registered for the session lifetime — if the agent
    // calls a UI tool later, `requestLazyOpenPanel` re-mounts the iframe.
    // Cleanup is owned by SessionManager.disposeSession (session end) and the
    // MINIAPP_UNINSTALL path (app removal).
    clearAppReadyGate(projectDir, appId)
    const projectAppKey = `${projectDir}::${appId}`
    const sessions = miniAppSessionRefs.get(projectAppKey)
    if (sessions) {
      sessions.delete(sessionId)
      if (sessions.size === 0) miniAppSessionRefs.delete(projectAppKey)
    }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_WORKER_START, async (_e, projectDir: string, appId: string) => {
    if (!isAppStillAuthorizedInProject(projectDir, appId)) {
      log.warn('[worker-host] start rejected: not authorized %s::%s', projectDir, appId)
      throw new Error('App is not authorized in this project')
    }
    const basePath = getAppBasePath(appId)
    const manifest = await readManifest(basePath)
    if (!manifest) throw new Error(`App not found: ${appId}`)
    if (!manifest.background?.entry) throw new Error('App does not declare a background entry')
    if (!manifest.permissions?.background) throw new Error('App lacks permissions.background')
    const projectId = getProjectId(projectDir)
    const media = (manifest.permissions?.media ?? []).map((m) => m.kind)
    return startWorker({
      appId,
      projectDir,
      name: manifest.name,
      host: buildMiniAppHost(appId, projectId),
      entry: manifest.background.entry,
      storage: !!manifest.permissions?.storage,
      media,
    })
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_WORKER_STOP, (_e, projectDir: string, appId: string) => {
    stopWorker(projectDir, appId)
    return { running: false }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_WORKER_STATUS, (_e, projectDir: string, appId: string) => {
    return workerStatus(projectDir, appId)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_WORKER_LIST, () => listWorkers())

  ipcMain.on(AgentIpcChannels.MINIAPP_WORKER_SEND, (_e, msg: { projectDir: string; appId: string; type: string; data: Record<string, unknown> }) => {
    if (!msg) return
    if (msg.type === 'miniapp-worker-msg') {
      sendToWorker(msg.projectDir, msg.appId, (msg.data as { payload?: unknown }).payload)
    } else {
      handleWorkerSend(msg.projectDir, msg.appId, msg.type, msg.data)
    }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_RESULT, (_e, callId: string, result: unknown, error?: string) => {
    trace('miniapp.toolcall', 'main-result-ipc', { callId, hasError: !!error, error })
    if (error) {
      rejectToolCall(callId, error)
    } else {
      resolveToolCall(callId, result)
    }
  })

  ipcMain.handle(AgentIpcChannels.BROWSER_AUTOMATION_RESULT, (_e, callId: string, ok: boolean, result: unknown, error?: string) => {
    if (ok) {
      resolveBrowserAutomation(callId, result)
    } else {
      rejectBrowserAutomation(callId, error ?? 'Browser automation failed')
    }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_SUBMIT, (_e, callId: string, userInput: Record<string, unknown>) => {
    submitToolIntercept(callId, userInput ?? {})
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CANCEL, (_e, callId: string, reason?: string) => {
    cancelToolIntercept(callId, reason)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_FS_REQUEST, async (_e, projectDir: string, appId: string, op: string, args: Record<string, unknown>) => {
    return handleFsRequest(projectDir, appId, op as any, args)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_FS_WATCH, (_e, projectDir: string, appId: string, path: string) => {
    return startWatch(projectDir, appId, path)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_FS_UNWATCH, (_e, watchId: number) => {
    stopWatch(watchId)
  })

  onFsWatchEvent((event) => {
    mainWindow?.webContents.send(AgentIpcChannels.MINIAPP_FS_WATCH_EVENT, event)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_GIT_REQUEST, async (_e, projectDir: string, appId: string, op: string, args: Record<string, unknown>) => {
    return handleGitRequest(projectDir, appId, op as any, args)
  })

  onGitHeadChangeEvent((event) => {
    mainWindow?.webContents.send(AgentIpcChannels.MINIAPP_GIT_HEAD_CHANGE, event)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DB_REQUEST, async (_e, projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>) => {
    return handleDbRequest(projectDir, scope as 'user' | 'project', appId, op as any, args)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_KV_REQUEST, async (_e, projectDir: string | null, scope: string, appId: string, op: string, args: KvRequestArgs) => {
    return handleKvRequest(projectDir, scope as 'user' | 'project', appId, op as KvOp, args ?? {})
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_IFRAME_READY, (_e, appId: string, projectDir: string) => {
    trace('miniapp.lazyopen', 'main-iframe-ready-ipc', { appId, projectDir })
    notifyMiniAppReady(projectDir, appId)
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

  ipcMain.handle(AgentIpcChannels.MINIAPP_UNINSTALL, async (_e, appId: string, installDir?: string) => {
    const affectedSessions = unregisterAppAcrossSessions(appId)
    for (const sid of affectedSessions) agentService.markSessionNeedsRebuild(sid, 'codex')
    stopWorkersByAppId(appId)
    for (const [key] of miniAppSessionRefs) {
      if (key.endsWith(`::${appId}`)) miniAppSessionRefs.delete(key)
    }
    return uninstallApp(appId, installDir)
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

  // Dev-registry (mini-app development)
  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_LIST, async () => {
    const knownProjects = getRecentFolders().map((f) => f.path)
    return listDevRegistryView(knownProjects)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_ADD, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory'],
      title: 'Select mini-app source directory',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return registerDevMiniApp({ directory: result.filePaths[0] })
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_REMOVE, async (_e, appId: string, cascade?: boolean) => {
    const knownProjects = getRecentFolders().map((f) => f.path)
    await unregisterDevMiniApp(appId, !!cascade, knownProjects)
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_INSTALL, async (_e, appId: string, scope: 'user' | 'project', projectDir?: string, force?: boolean) => {
    const installDir = await installDevPointer({ appId, scope, projectDir, force })
    return { installDir }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_UNINSTALL, async (_e, appId: string, scope: 'user' | 'project', projectDir?: string) => {
    await removeDevPointer({ appId, scope, projectDir })
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_SET_ENABLED, async (_e, appId: string, scope: 'user' | 'project', enabled: boolean, projectDir?: string) => {
    await setDevPointerEnabled({ appId, scope, projectDir, enabled })
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_DEV_REGISTRY_REVEAL_SOURCE, async (_e, appId: string) => {
    const entry = await devRegistry.lookupByAppId(appId)
    if (!entry) return
    shell.showItemInFolder(entry.sourceDir)
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

  // Older builds spawned detached `opencode serve` processes that survived force-quit.
  const reaped = reapOrphanOpenCodeServers()
  if (reaped > 0) log.info('[startup] reaped %d orphan opencode serve process(es)', reaped)

  currentThemeMode = readAppSettings().themeMode
  syncNativeAppearance()
  currentDarkTheme = nativeTheme.shouldUseDarkColors
  nativeTheme.on('updated', () => {
    if (currentThemeMode !== 'system') return
    const nextDark = nativeTheme.shouldUseDarkColors
    if (nextDark === currentDarkTheme) return
    currentDarkTheme = nextDark
    applyLiquidGlass()
    broadcastTheme()
  })
  registerBrowserPopupRedirect()
  registerBrowserDownloadCapture()

  if (is.dev && process.env.SUPERONE_BENCH) {
    ipcMain.handle(AgentIpcChannels.GET_APP_METRICS, (event) => ({
      selfPid: event.sender.getOSProcessId(),
      logicalCpuCount: Math.max(1, cpus().length),
      metrics: app.getAppMetrics(),
    }))
    createBenchWindow()
    return
  }

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
  registerMiniAppProtocolHandlers(protocol)

  fixPath()
  startMediaServer().catch((err) => log.error('[media-server] failed to start:', err))
  ipcMain.handle(AgentIpcChannels.MEDIA_SERVER_PORT, () => getMediaServerPort())
  getDb() // Initialize database
  void (async () => {
    try {
      const prev = readAcpResourcesCache()
      const agents = await detectBuiltinAgents()
      const prevSelected = prev.selectedAgentId
      const selectedAgentId =
        prevSelected && (getBuiltinAgent(prevSelected) || prevSelected === 'custom')
          ? prevSelected
          : null
      writeAcpResourcesCache({
        ...prev,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          installed: a.installed,
          commandPreview: a.commandPreview,
        })),
        selectedAgentId,
        modelsByAgentId: prev.modelsByAgentId ?? {},
        configByAgentId: prev.configByAgentId ?? {},
      })
      log.info('[acp] agent cache refreshed: %d agents', agents.length)
      const withConfig = await refreshAcpModelsOnce()
      log.info(
        '[acp] config cache refreshed: %d agents with config',
        Object.keys(withConfig.configByAgentId ?? {}).length,
      )
    } catch (err) {
      log.warn('[acp] detect/refresh models failed:', err)
    }
  })()
  registerIpcHandlers()
  terminalSweepTimer = setInterval(() => terminalManager.sweep(), 30_000)

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
    if (!ok) {
      callback(false)
      return
    }
    if (process.platform === 'darwin') {
      // Granting the Electron permission does NOT request macOS AVFoundation
      // access. Without askForMediaAccess the OS prompt never shows and
      // getUserMedia hangs forever (no dialog, perpetual "Requesting…").
      Promise.all(
        mediaTypes.map((t) =>
          systemPreferences.askForMediaAccess(t === 'audio' ? 'microphone' : 'camera'),
        ),
      )
        .then((results) => callback(results.every(Boolean)))
        .catch(() => callback(false))
      return
    }
    callback(true)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const appId = appIdFromUrl(requestingOrigin) ?? appIdFromUrl((details as { requestingUrl?: string }).requestingUrl ?? '')
    if (!appId) return true
    if (permission !== 'media') return false
    const mediaType = (details as { mediaType?: 'audio' | 'video' | 'unknown' }).mediaType
    const manifestOk =
      mediaType === 'audio'
        ? isMediaAllowed(appId, 'microphone')
        : mediaType === 'video'
          ? isMediaAllowed(appId, 'camera')
          : isMediaAllowed(appId, 'microphone') || isMediaAllowed(appId, 'camera')
    if (!manifestOk) return false
    if (process.platform !== 'darwin') return true
    // Only report "granted" when macOS TCC is actually granted. Returning true
    // while TCC is still not-determined short-circuits the request handler, so
    // askForMediaAccess never runs, the OS prompt never shows, and
    // getUserMedia hangs forever. Returning false here routes Chromium through
    // setPermissionRequestHandler, which prompts and then grants.
    const granted = (k: 'microphone' | 'camera') =>
      systemPreferences.getMediaAccessStatus(k) === 'granted'
    if (mediaType === 'audio') return granted('microphone')
    if (mediaType === 'video') return granted('camera')
    return granted('microphone') || granted('camera')
  })

  createWindow()
  applyAppIcon(readAppSettings().customAppIconPath, allWindows)
  initUpdater(mainWindow!, readAppSettings().updateChannel)

  let devUpdateToggle = false
  function buildAppMenu(): void {
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(null)
      return
    }
    const { label: updateLabel, enabled: updateEnabled } = getUpdateMenuState()
    const sendCloseTabShortcut = (): void => {
      mainWindow?.webContents.send(AgentIpcChannels.CLOSE_TAB_SHORTCUT)
    }
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
      {
        label: 'File',
        submenu: [
          {
            label: 'Close Tab',
            accelerator: 'CmdOrCtrl+W',
            click: sendCloseTabShortcut,
          },
          { role: 'close', label: 'Close Window', accelerator: 'Shift+CmdOrCtrl+W' },
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
    if (!mainWindow) {
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
let agentSessionCleanupPromise: Promise<void> | null = null

function disposeAgentSessions(): Promise<void> {
  agentSessionCleanupPromise ??= Promise.allSettled([
    agentService.dispose(),
    sessionManager.disposeAllSessions(),
  ]).then(() => undefined)
  return agentSessionCleanupPromise
}

function performQuit(): void {
  quitting = true
  if (terminalSweepTimer) clearInterval(terminalSweepTimer)
  shutdownAllProxies()
  terminalManager.killAll()
  automationService.stop()
  stopAllWorkers()
  stopWatching()
  stopSuperoneMcpStdioBridge()
  disposeUpdater()
  const remoteStop = Promise.race([
    remoteControlService.stop(),
    new Promise<void>((r) => setTimeout(r, 1500)),
  ]).catch(() => {})
  Promise.allSettled([
    remoteStop,
    disposeAgentSessions(),
    closeAllOpenCodeServers(),
  ]).finally(() => {
    codexService.dispose()
    disposeGlobalWarmupManager()
    closeAllDbConnections()
    closeDb()
    closeTraceDb()
    setTimeout(() => app.quit(), 500)
  })
}

let signalQuitting = false
const handleSignalQuit = (sig: NodeJS.Signals): void => {
  if (signalQuitting) return
  signalQuitting = true
  log.info(`[main] received ${sig}, shutting down`)
  if (terminalSweepTimer) clearInterval(terminalSweepTimer)
  terminalManager.killAll()
  closeAllDbConnections()
  Promise.allSettled([
    remoteControlService.stop(),
    disposeAgentSessions(),
    closeAllOpenCodeServers(),
  ]).finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.once('SIGTERM', () => handleSignalQuit('SIGTERM'))
process.once('SIGINT', () => handleSignalQuit('SIGINT'))
process.once('SIGHUP', () => handleSignalQuit('SIGHUP'))

app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()

  if (!agentService.hasRunningSessions() && !hasActiveWorkers()) {
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
    detail: 'Running sessions and background tasks will be stopped.',
  }).then(({ response }) => {
    if (response === 0) performQuit()
  })
})
