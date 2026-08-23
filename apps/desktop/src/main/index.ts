import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, protocol, screen, session, shell, systemPreferences, webContents } from 'electron'
import { join, dirname, basename, resolve, extname, relative, isAbsolute, sep } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, readdir, rename, cp, rm, access, stat, mkdir } from 'fs/promises'
import { cpus, homedir, hostname, release as osRelease } from 'os'
import { resolveRealPath, isPathWithinAllowed, isPathAtOrWithinAllowed, sanitizeGitRef, getReadableAssetRoots } from './path-security'
import { spawn } from 'child_process'
import { gitRun, type GitRunOptions } from './git-run'
import { logGitFailure, logSlowGit } from './git-diagnostics'
import { AsyncCoalescer } from './async-cache'
import { countAddedLines } from './git-added-lines'
import { activateWorktree, assignBranch, getCheckedOutBranches, getHandoffPreview, getWorktreeInfo, gitErrorMessage, handoffToLocal } from './git/worktree-ops'
import { is } from '@electron-toolkit/utils'
import type { EnvironmentHost } from './environment/environment-host'
import type { DraftUpsertRequest } from '@superone/shared/environment'
import log from './logger'
import { resolveAndMigrateUserData } from './user-data-path'
import { startMediaServer, getMediaServerPort } from './media-server'
import { getMediaProviderStatuses } from './media-gen/settings-service'
import { getAppBasePath, cacheAppEntry, generateCSP, readManifest, validatePath, discoverApps, discoverProjectApps, setAllowedMedia, clearAllowedMedia, isMediaAllowed, appIdFromUrl, listDevRegistryView, registerDevMiniApp, unregisterDevMiniApp, installDevPointer, removeDevPointer, setDevPointerEnabled } from './miniapp/miniapp-service'
import * as devRegistry from './miniapp/dev-registry'
import { registerMiniAppProtocolHandlers } from './miniapp/miniapp-protocol'
import { attachMiniAppWebviewGuards } from './miniapp/miniapp-webview-guard'
import { initMiniAppHostActionBridge, runMiniAppHostAction, settleMiniAppHostAction } from './miniapp/miniapp-host-action-bridge'
import { isPathExposableByApp } from './miniapp/miniapp-path-exposure'
import { executeMiniAppTool, hasActiveMiniAppHosts, initMiniAppHost, listMiniAppHosts, notifyMiniAppContextConsumed, postMiniAppWebviewMessage, releaseMiniAppHost, setMiniAppHostActionRunner, startMiniAppHost, stopAllMiniAppHosts, stopMiniAppHost, stopMiniAppHostsByAppId } from './miniapp/miniapp-host'
import { closeAllMiniAppState, resolveMiniAppStoragePaths } from './miniapp/miniapp-state'
import { previewApp, confirmInstall, cancelInstall, uninstallApp, packApp, getInstallMeta, getPreapproved, getPreapprovedByPath, setPreapproved, setPreapprovedByPath } from './miniapp/miniapp-packager'
import { previewMcpbBundle, installMcpbBundle, uninstallMcpbBundle, listInstalledMcpb, revealMcpbBundle } from './mcpb/mcpb-installer'
import { initBrowserAutomation, resolveBrowserAutomation, rejectBrowserAutomation } from './browser/browser-automation-bridge'
import { detachAllCdp } from './browser/browser-cdp'
import { registerBrowserPopupRedirect } from './browser-popup-redirect'
import { fetchBrowserBytes, registerBrowserDownloadCapture } from './browser/browser-downloads'
import { setBrowserDownloadTaskHost } from './browser/browser-download-tasks'
import { initSuperoneMcpServer, registerAppTools, unregisterAppTools, unregisterAppAcrossSessions, loadPreapprovedTools, updatePreapprovedTools, registerAppTemplates, unregisterAppTemplates, submitToolIntercept, cancelToolIntercept, clearSessionPendingCalls as clearSessionPendingMiniAppCalls, disposeSuperoneMcpServer, setSessionHostProvider, setAppSettingsApplier, isAppStillAuthorizedInProject, addToolsChangedListener, setAppToolExecutor, setMobileShareToolDeps, registerMobileShareTool, unregisterMobileShareTool } from './mcp/superone-mcp-server'
import { MobileShareService, type MobileShareTarget } from './remote/mobile-share-service'
import { MobileReceiveService, type MobileReceiveTarget } from './remote/mobile-receive-service'
import { MobileShareToolCoordinator } from './remote/mobile-share-tool-coordinator'
import { startSuperoneMcpStdioBridge, stopSuperoneMcpStdioBridge } from './mcp/superone-mcp-stdio-ipc'
import {
  getComputerUsePermissionStatus,
  noteComputerUsePermissionBaseline,
  pollComputerUsePermissionStatus,
  prepareComputerUseHelper,
  recheckComputerUsePermissionStatus,
  startComputerUseHelper,
  stopComputerUseHelper,
} from './computer-use/computer-use-helper-lifecycle'
import {
  closeComputerUsePermissionFloat,
  continueComputerUsePermissionStep,
  destroyComputerUsePermissionFloat,
  pushComputerUsePermissionStatus,
  resizeComputerUsePermissionFloat,
  showComputerUsePermissionFloat,
  type PrivacyPane,
} from './computer-use/computer-use-permission-window'
import { scheduleMcpReload } from './mcp/mcp-reload-scheduler'
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  markTerminalBoundSlashCommands,
  readTerminalSlashCommandsFromInitMessage,
} from '@superone/shared/slash-commands'
import { tryResolveHarnessRuntime } from './harness/resolve-runtime'
import { disposeGlobalWarmupManager } from './agent/warmup-manager'
import { resolveProbeCwd } from './agent/probe-cwd'
import { fixPath } from './agent/resolve-cli'
import { buildSafeEnv } from './spawn-env'
import { AgentService } from './agent/agent-service'
import { createRendererAgentEventTransport } from './agent/renderer-agent-event-transport'
import { SessionManagerImpl } from './session/session-manager'
import { TerminalManager } from './terminal/terminal-manager'
import { RemoteTerminalController } from './environment/remote-terminal-controller'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { TerminalBroadcaster } from './remote/terminal-broadcaster'
import { nodePtySpawner } from './terminal/pty'
import { DeviceRegistry } from './remote/device-registry'
import { MobileBroadcaster } from './remote/mobile-broadcaster'
import { PresenceCoordinator } from './remote/presence-coordinator'
import { getSessionRecord, listWorktreePaths, loadSessionStateBySid, resolveProviderSessionIdForResume, saveSessionStateBySid, updateProviderSessionId } from './session/session-repo'
import { deepseekTrajectorySource } from './deepseek/trajectory-source'
import { clearTrajectoryWatches, setTrajectoryWatch } from './deepseek/trajectory-watch'
import type { TrajectoryPayloadRef } from '@superone/shared/trajectory-types'
import {
  getSessionCollaborationRunConfig,
  getSessionCollaborationSystemPrompt,
  setSessionCollaborationCallbacks,
} from './session/session-collaboration'
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
  type CodexMcpOauthLoginOptions,
  type AgentEvent,
  type CodexThreadItem,
  type CodexUsageInfo,
  type CodexSetAuthRequest,
  type CodexAccountLoginStartResult,
  type ImageAttachment,
  type ClaudeResources,
  type CodexResources,
  type StartupData,
  type FileTreeEntry,
  type FileOpResult,
  type NativeContextMenuItemSpec,
  type ComputerUseDisplayInfo,
} from '@superone/shared/agent-types'
import { initUpdater, installUpdate, checkForUpdates, downloadUpdate, retryUpdateHarnessPrefetch, simulateUpdate, simulateNotAvailable, getUpdaterState, getUpdateMenuState, setOnMenuChange, setUpdateChannel, isInstallingUpdate } from './updater'
import { startWatching, stopWatching } from './file-watcher'
import { detectTextOrBinary, maxReadableBytes } from './file-read-limits'
import { notifyWidgetReady, clearAllGates } from './generative-ui/widget-gate'
import { setBashOutputWindow, watchBashOutput, unwatchBashOutput, unwatchAll as unwatchAllBashOutputs, readBashOutputTail, getWatchedFilePath } from './bash-output-watcher'
import { setUnsavedBuffer } from './acp/acp-unsaved-buffer'
import { closeAllOpenCodeServers, probeOpenCodeResources, reapOrphanOpenCodeServers } from './opencode/opencode-client'
import { probeCursorResources } from './cursor/cursor-client'
import { encryptCursorApiKey, readCursorConfig, resolveCursorApiKey } from './cursor/cursor-auth'
import {
  archiveCursorAgent,
  cancelCursorRun,
  deleteCursorAgent,
  downloadCursorArtifact,
  getCursorAgent,
  getCursorRun,
  listCursorAgentMessages,
  listCursorArtifacts,
  listCursorCloudAgents,
  listCursorLocalAgents,
  listCursorRepositories,
  listCursorRuns,
  unarchiveCursorAgent,
} from './cursor/cursor-cloud'
import { getBaseProvider, updateBaseProviderConfig } from './session/session-provider-repo'
import { listWorkflowAgents, readWorkflowOutput, readWorkflowScript } from './workflow-transcripts'
import { discoverGrokWorkflows } from './workflow-discovery'
import { readSubagentTranscript } from './agent/subagent-transcript'
import {
  parseGitStatusOutput,
  parseGitStatusFiles,
  resolveEntryStatusPair,
  GIT_TREE_STATUS_ARGS,
  type GitStatusPair,
  type ParsedGitStatus,
} from './git-status-utils'
import { mapModelInfo } from './agent/claude-models'
import { getClaudeRateLimits } from './agent/claude-usage-service'
import { getProviderRateLimits } from './agent/provider-usage-service'
import { getRecentFolders, getRecentFoldersWithPresence, addRecentFolder, removeRecentFolder, getProjectExtraDirs, getProjectId, getProjectPathById } from './recent-folders'
import { PATH_EXISTS_OPEN_TIMEOUT_MS, pathExistsBounded } from './path-exists-bounded'
import { registerHarnessIpcHandlers } from './harness/ipc'
import { registerIosSimulatorIpc } from './ios-simulator/ipc'
import { registerDeviceIpc, closeDevicePorts } from './device/ipc'
import { openDeviceSetup, probeDeviceSetup } from './device/setup'
import { deviceSurfaces, listAllDevices } from './device/registry'
import { disposeIosSimulatorManager } from './ios-simulator'
import { disposeAndroidDeviceManager } from './device/android'
import { disposeMirrorDeviceManager } from './device/ios-mirror'
import { attachDeviceGestureEvents } from './device/gesture-events'
import { getDb, closeDb, getCachedHarnessResources, setCachedHarnessResources, upsertPairedDevice, listPairedDevices, deletePairedDevice, isPairedDevice } from './database'
import { connectWithHarnessResourceCache, getFreshHarnessResources } from './harness/resource-cache'
import { backfillFromHistory, getBackfillStatus, queryCounts, queryHarnessSessionRanks, queryUsage } from './usage-stats-service'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents, discoverCodexUserPrompts } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'
import { getCodexProviderOverrideFor } from './codex/app-server-connection'
import { CodexPluginsService } from './codex/codex-plugins-service'
import { CodexHooksService } from './codex/codex-hooks-service'
import { CodexMarketplaceService } from './codex/codex-marketplace-service'
import { setCodexSkillsWatcherWindow } from './codex/codex-skills-watcher'
import { deleteCodexMcpConfig, saveCodexMcpConfig, toggleCodexMcpConfig } from './codex-config-service'
import { setCodexServiceFactory } from './session/backends/codex-backend'
import { AutomationService, bindAutomationService, notifyAutomationsListChanged } from './automation-service'
import { ScheduledSendService } from './session/scheduled-send-service'
import { listAutomationsForProject, createAutomation as dbCreateAutomation, updateAutomation as dbUpdateAutomation, deleteAutomation as dbDeleteAutomation, getAutomation as dbGetAutomation } from './db-automations'
import { trace, closeTraceDb } from './agent/event-trace'
import { RemoteControlService } from './remote-control-service'
import { readProjectPreferences, saveProjectPreferences } from './claude-preferences-service'
import { readAppSettings, saveAppSettings } from './app-settings-service'
import { getInstallId } from './install-id'
import type { AppSettings, AppSettingsPatch, GitInfo, ScheduledSendPatch, ScheduledSendSessionInit, ThemeMode } from '@superone/shared/agent-types'
import { recordBrowserHistory, suggestBrowserHistory, deleteBrowserHistory } from './browser-history-service'
import { getSandboxCapability, probeSandboxDependencies } from './sandbox-platform'
import { ProcessTitle, WindowRole, roleArg, glassBootArgs } from './process-titles'
import {
  GLASS_BACKGROUND,
  WINDOWS_GLASS_MATERIAL,
  glassConstructorOptions,
  isGlassPlatformSupported,
  isWindowsGlassSupported,
  windowsChromeBackground,
} from './window-glass'
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
])

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

app.setName('SuperOne')
if (is.dev) {
  app.setPath('userData', join(process.cwd(), '.dev-data'))
} else {
  const resolved = resolveAndMigrateUserData({
    appData: app.getPath('appData'),
    instance: process.env.SUPERONE_INSTANCE,
  })
  if (resolved.action !== 'none') {
    log.info(`[user-data] ${resolved.action} → ${resolved.path}`)
  }
  if (resolved.error) {
    log.warn(`[user-data] ${resolved.error}`)
  }
  app.setPath('userData', resolved.path)
}

/**
 * Read-only git calls behind the polling status bar. Without a timeout a git
 * that never exits (hung `core.fsmonitor`, stalled network filesystem) leaves
 * the renderer's promise unsettled forever, and the branch chip never appears.
 */
const GIT_READ_OPTS: GitRunOptions = { timeoutMs: 20_000 }
const GIT_INFO_SLOW_MS = 3_000

const agentService = new AgentService()
const codexService = new CodexExperimentService()
const codexPluginsService = new CodexPluginsService(codexService)
const codexHooksService = new CodexHooksService(codexService)
const codexMarketplaceService = new CodexMarketplaceService(codexService)
setCodexServiceFactory(() => codexService)
const automationService = new AutomationService()
bindAutomationService(automationService)
// `apiProviderId` carries the session's chosen credential id (dynamic-follow: null follows the global binding).
function resolveBaseProviderConfig(provider: SessionProvider, apiProviderId: string | null = null): unknown {
  if (!provider.isBase) return provider.config
  if (provider.harnessId === 'opencode' || provider.harnessId === 'cursor' || provider.harnessId === 'dsh') return provider.config
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
  const resolved = resolveChatService(provider.harnessId, apiProviderId, {
    experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled,
  })
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
  getProjectExtraDirs,
  onSessionStateChange: (snapshot) => {
    // Do not swallow errors: Session clears dirty ids only after a successful
    // return from this hook. Rethrow so notifyStateChange retains dirty state.
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
      selectedModel: snapshot.selectedModel,
      selectedEffort: snapshot.selectedEffort,
      providerSessionId: snapshot.providerSessionId,
      messagePersistMode: snapshot.messagePersistMode,
    })
  },
  onProviderSessionIdChange: (sid, providerSessionId) => {
    try {
      const updated = updateProviderSessionId(sid, providerSessionId)
      if (!updated) {
        // Common for draft sessions: prewarm resolves the Grok id before the
        // first message creates the sessions row. saveSessionStateBySid will
        // write it on the next state change.
        log.debug(
          '[sessionManager] updateProviderSessionId no row yet sid=%s providerSessionId=%s',
          sid,
          providerSessionId,
        )
      }
    } catch (err) {
      log.warn('[sessionManager] updateProviderSessionId failed:', err)
    }
  },
  loadSession: (sessionId) => {
    const loaded = loadSessionStateBySid(sessionId)
    if (!loaded) return null
    const collaborationConfig = getSessionCollaborationRunConfig(sessionId)
    const providerSessionId = resolveProviderSessionIdForResume(loaded.record, loaded.messages)
    if (providerSessionId && providerSessionId !== loaded.record.providerSessionId) {
      updateProviderSessionId(sessionId, providerSessionId)
      log.info(
        '[sessionManager] repaired providerSessionId from message metadata sid=%s providerSessionId=%s',
        sessionId,
        providerSessionId,
      )
    }
    return {
      projectPath: loaded.record.projectPath,
      providerId: loaded.record.providerId,
      providerSessionId,
      messages: loaded.messages,
      totalCostUsd: loaded.record.totalCostUsd,
      contextTokens: loaded.record.contextTokens,
      title: loaded.record.title,
      worktreePath: loaded.record.worktreePath,
      gitBranch: loaded.record.gitBranch,
      apiProviderId: loaded.record.apiProviderId,
      acpAgentId: loaded.record.acpAgentId,
      selectedModel: loaded.record.selectedModel,
      selectedEffort: loaded.record.selectedEffort,
      permissionMode: collaborationConfig?.permissionMode,
      sandboxMode: collaborationConfig?.sandboxMode,
      systemPromptAppend: getSessionCollaborationSystemPrompt(sessionId),
    }
  },
  getActiveProvider: (harnessId, apiProviderId) => {
    if (harnessId === 'acp' || harnessId === 'opencode' || harnessId === 'cursor' || harnessId === 'dsh') return null
    return buildRemoteActiveService(resolveChatService(harnessId, apiProviderId ?? null, {
      experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled,
    }), harnessId)
  },
  getActiveDefaultApiProviderId: (harnessId) => {
    if (harnessId === 'acp' || harnessId === 'opencode' || harnessId === 'cursor' || harnessId === 'dsh') return null
    return getBinding(harnessId === 'codex' ? 'chat:codex' : 'chat:claude')?.credentialId ?? null
  },
  onBeforeInterrupt: (sessionId) => {
    clearAllGates()
    clearSessionPendingMiniAppCalls(sessionId)
  },
})
const scheduledSendService = new ScheduledSendService({
  sessionManager,
  broadcast: (sessionId, scheduled, delivered) =>
    safeSend(AgentIpcChannels.SCHEDULED_SEND_CHANGED, { sessionId, scheduled, delivered }),
  resumeDefaults: () => agentService.readDefaultSessionPrefs(),
})
sessionManager.onAny((_sid, event) => {
  if (event.type === 'permission_request') {
    const alive = !!mainWindow && !mainWindow.isDestroyed()
    log.info('[onAny] permission_request sid=%s sessionId=%s projectPath=%s windowAlive=%s requestId=%s',
      _sid, event.sessionId ?? '(none)', event.projectPath ?? '(none)', alive, event.request.requestId)
  }
  agentService.notifyEventSubscribers(event)
  scheduledSendService.observe(_sid, event)
  rendererAgentEventTransport.push(event)
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

function listComputerUseDisplays(): ComputerUseDisplayInfo[] {
  if (process.platform !== 'darwin') return []
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    name: display.label || `Display ${index + 1}`,
    primary: display.id === primaryId,
    internal: display.internal === true,
  }))
}

function pushComputerUseDisplaysChanged(): void {
  safeSend(AgentIpcChannels.COMPUTER_USE_DISPLAYS_CHANGED)
}

// Computer Use's leg of the shared floating preview. It is a native window, so it
// cannot be positioned by the renderer — it reports when it becomes the newest agent
// target and is told to stand down when something pinned outranks it.
void import('./computer-use/viewfinder').then(({ setComputerUseViewfinderClaimSink }) => {
  setComputerUseViewfinderClaimSink((claim) => {
    safeSend(AgentIpcChannels.COMPUTER_USE_VIEWFINDER_CLAIM, claim)
  })
})

const rendererAgentEventTransport = createRendererAgentEventTransport((events) => {
  safeSend(AgentIpcChannels.EVENT, events)
})

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
      allowedRoots: [
        session.projectPath,
        // Read from the catalog, not just the session snapshot: before the
        // first send the snapshot is still empty.
        ...getProjectExtraDirs(session.projectPath),
        ...session.getAdditionalDirectoriesSnapshot(),
      ],
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
      allowedRoots: [
        session.projectPath,
        // Read from the catalog, not just the session snapshot: before the
        // first send the snapshot is still empty.
        ...getProjectExtraDirs(session.projectPath),
        ...session.getAdditionalDirectoriesSnapshot(),
      ],
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
const remoteTerminalController = new RemoteTerminalController({
  getHost: async () => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost()
  },
  onEvent: (event) => safeSend(AgentIpcChannels.TERMINAL_EVENT, event),
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
  return isGlassPlatformSupported(process.platform, osRelease()) && readAppSettings().liquidGlass
}

function glassWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return glassConstructorOptions({
    enabled: isGlassEnabled(),
    platform: process.platform,
    release: osRelease(),
  })
}

function applyLiquidGlass(): void {
  const active = isGlassEnabled()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (process.platform === 'darwin') {
      win.setVibrancy(active ? 'under-window' : null)
      win.setBackgroundColor(active ? GLASS_BACKGROUND : currentDarkTheme ? '#1c1c1c' : '#ffffff')
    } else if (process.platform === 'win32' && isWindowsGlassSupported(process.platform, osRelease())) {
      try {
        win.setBackgroundMaterial(active ? WINDOWS_GLASS_MATERIAL : 'none')
      } catch {
        // Frameless hosts (drag preview / permission float) have no material surface.
      }
    }
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
    applyWindowAppearance()
  }
  if (patch?.cdpEnabled === false) {
    detachAllCdp()
  }
  if (patch?.experimentalClaudeOpenAiChatEnabled !== undefined) {
    sessionManager.markAllNeedsRebuild('claude')
  }
  if (patch?.computerUseEnabled === false) {
    // Feature off → immediately drop any lingering control chrome.
    try {
      const { hideComputerUseVisuals } = await import('./computer-use/tools')
      await hideComputerUseVisuals()
    } catch {
      // ignore
    }
  }
  if (patch?.computerUsePictureInPicture !== undefined) {
    try {
      const { getSharedHelperClient } = await import('./computer-use/platform/macos-helper-client')
      await getSharedHelperClient().call('pip_set_enabled', {
        enabled: result.computerUsePictureInPicture,
      })
    } catch {
      // helper offline or unsupported platform
    }
  }
  if (patch?.computerUseDedicatedDisplayId !== undefined) {
    try {
      const { getSharedHelperClient } = await import('./computer-use/platform/macos-helper-client')
      await getSharedHelperClient().call('display_restore_all')
    } catch {
      // helper offline or unsupported platform
    }
  }
  if (patch?.computerUseEnabled !== undefined) {
    // Computer Use must reach every harness that injects SuperOne MCP:
    // - Claude / OpenCode: in-process createSuperoneMcpServer (+ registerComputerUseTools)
    // - Codex: HTTP initialize → createSuperoneMcpServer; also snapshots once per thread
    // - ACP: HTTP or stdio → listSuperoneMcpTools / createSuperoneMcpServer
    // Close HTTP sessions so the next MCP initialize re-registers the tool set.
    // markNeedsRebuild on ALL harnesses so the next turn re-snapshots (Codex/ACP
    // ignore tools/list_changed for the thread tool list).
    const { notifySessionToolsChanged, disposeSuperoneMcpServer } = await import('./mcp/superone-mcp-server')
    const { closeSuperoneMcpHttpSessions } = await import('./mcp/superone-mcp-http-state')
    const { harnessRecoveryForComputerUseToggle } = await import('./computer-use/harness-surface')
    sessionManager.forEachSession((session) => {
      const recovery = harnessRecoveryForComputerUseToggle(session.snapshot.harnessId)
      if (recovery.closeHttpSessions) {
        void closeSuperoneMcpHttpSessions(session.id)
      }
      // Drop in-process MCP instances so Claude rebuild picks up a fresh server.
      try {
        disposeSuperoneMcpServer(session.id)
      } catch {
        // ignore
      }
      if (recovery.markNeedsRebuild) {
        session.markNeedsRebuild()
      }
      if (recovery.notifyToolsChanged) {
        notifySessionToolsChanged(session.id)
      }
    })
  }
  if (
    patch?.computerUseAlwaysAllowApps !== undefined
    || patch?.computerUseAllowAllApps !== undefined
  ) {
    try {
      const { syncAllComputerUseServicesFromSettings } = await import('./computer-use/tools')
      syncAllComputerUseServicesFromSettings()
    } catch {
      // ignore if computer-use module not loaded
    }
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
  applyWindowAppearance()
  broadcastTheme()
}

/**
 * Boot-time fallback only. The strip the caption buttons sit on is a themed
 * surface — `--sidebar` in the main window, `--card` in the session window — and
 * both resolve through `--brand-hue` plus any palette override, so no constant
 * here can be exact. These are the default-hue (240) values from theme.css; once
 * a renderer paints, `SET_WINDOW_CHROME_COLORS` replaces them with the colour that
 * window actually renders. Light mode runs a DARK sidebar — do not "fix" the light
 * branch back to `--background`, that is what left a white patch behind the buttons.
 */
type ChromeSurface = 'sidebar' | 'card'

function windowChromeColors(surface: ChromeSurface): { backgroundColor: string; symbolColor: string } {
  if (surface === 'card') {
    return currentDarkTheme
      ? { backgroundColor: '#171717', symbolColor: '#c8c8c8' }
      : { backgroundColor: '#fcfefe', symbolColor: '#555555' }
  }
  return currentDarkTheme
    ? { backgroundColor: '#0a0a0a', symbolColor: '#c8c8c8' }
    : { backgroundColor: '#1b252d', symbolColor: '#e4e8eb' }
}

/** `#rrggbb` / `#rrggbbaa` — anything else is rejected rather than fed to Electron. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

function isSessionWindow(win: BrowserWindow): boolean {
  for (const w of sessionWindows.values()) {
    if (w === win) return true
  }
  return false
}

function applyWindowChromeColors(
  win: BrowserWindow,
  colors: { backgroundColor: string; symbolColor: string },
): void {
  const chromeBg = windowsChromeBackground({
    glassActive: isGlassEnabled(),
    backgroundColor: colors.backgroundColor,
  })
  win.setBackgroundColor(chromeBg)
  try {
    win.setTitleBarOverlay({ color: chromeBg, symbolColor: colors.symbolColor })
  } catch {
    // Frameless windows (drag preview, permission float) have no overlay.
  }
}

function windowsChromeOptions(overlayHeight: number, surface: ChromeSurface): Electron.BrowserWindowConstructorOptions {
  const { backgroundColor, symbolColor } = windowChromeColors(surface)
  const chromeBg = windowsChromeBackground({
    glassActive: isGlassEnabled(),
    backgroundColor,
  })
  return {
    backgroundColor: chromeBg,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: chromeBg,
      symbolColor,
      height: overlayHeight,
    },
  }
}

/**
 * Repaint on theme/glass change. Every window with a renderer re-reports its own
 * colour right after (the `dark` class flip is what the renderer observes), so this
 * only has to be close enough to cover that one frame.
 */
function applyWindowsChrome(): void {
  if (process.platform !== 'win32') return
  const mainColors = windowChromeColors('sidebar')
  const cardColors = windowChromeColors('card')
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    applyWindowChromeColors(win, isSessionWindow(win) ? cardColors : mainColors)
  }
}

function applyWindowAppearance(): void {
  applyLiquidGlass()
  applyWindowsChrome()
}

function attachRendererDiagnostics(win: BrowserWindow, role: string): void {
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('[window] render-process-gone role=%s reason=%s exitCode=%s', role, details.reason, details.exitCode)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return
    log.error('[window] did-fail-load role=%s code=%s %s url=%s', role, code, desc, url)
  })
  win.webContents.on('unresponsive', () => {
    log.error('[window] unresponsive role=%s', role)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120, // MIN_MAIN + MIN_SIDEBAR + MIN_AP
    minHeight: 700,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 }, ...glassWindowOptions() }
      : { ...windowsChromeOptions(40, 'sidebar'), ...glassWindowOptions() }),
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

  attachMiniAppWebviewGuards(mainWindow)

  attachDeviceGestureEvents(mainWindow)

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
  initMiniAppHost(() => mainWindow, () => getCurrentLocale())
  initMiniAppHostActionBridge(() => mainWindow)
  setMiniAppHostActionRunner(runMiniAppHostAction)
  setAppToolExecutor(executeMiniAppTool)
  agentService.setBroadcastFn((event) => rendererAgentEventTransport.push(event))
  agentService.setSessionManager(sessionManager)
  automationService.setMainWindow(mainWindow)
  automationService.setAgentService(agentService)
  automationService.start()
  scheduledSendService.start()
  setBashOutputWindow(mainWindow)

  allWindows.add(mainWindow)
  attachRendererDiagnostics(mainWindow, 'main')
  rendererAgentEventTransport.resetCodexBaselines()
  mainWindow.on('closed', () => {
    if (mainWindow) allWindows.delete(mainWindow)
    rendererAgentEventTransport.resetCodexBaselines()
    mainWindow = null
    destroyDragPreviewWindow()
    destroyComputerUsePermissionFloat()
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
      : { ...windowsChromeOptions(36, 'card'), ...glassWindowOptions() }),
    icon: getAppIcon() ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1,
      // The detached session window renders the same chat as the main window,
      // so its mini-app tool blocks mount <webview> tags too.
      webviewTag: true,
      additionalArguments: [roleArg(WindowRole.Mini), ...glassBootArgs(isGlassEnabled())],
    },
  })

  attachMiniAppWebviewGuards(win)
  attachDeviceGestureEvents(win)

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
  attachRendererDiagnostics(win, 'mini')
  rendererAgentEventTransport.resetCodexBaselines()
  sessionWindows.set(key, win)
  win.on('closed', () => {
    allWindows.delete(win)
    rendererAgentEventTransport.resetCodexBaselines()
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
  rendererAgentEventTransport.resetCodexBaselines()
  benchWindow.on('closed', () => {
    if (benchWindow) allWindows.delete(benchWindow)
    rendererAgentEventTransport.resetCodexBaselines()
    benchWindow = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    benchWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/bench.html`)
  } else {
    benchWindow.loadFile(join(__dirname, '../renderer/bench.html'))
  }
  benchWindow.webContents.openDevTools({ mode: 'detach' })
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

/**
 * Forward supervisor state changes to the renderer once per host instance.
 * Attached lazily so the environment subsystem stays unloaded until used.
 */
let environmentStatusBridgeAttached = false
let environmentConnectivityDisposer: (() => void) | null = null
function attachEnvironmentStatusBridge(host: EnvironmentHost): void {
  if (environmentStatusBridgeAttached) return
  environmentStatusBridgeAttached = true
  host.onStatusChange((snapshot) => {
    safeSend(AgentIpcChannels.ENVIRONMENT_STATUS_EVENT, snapshot)
  })
  // Remote node turns: map session.events → AgentEvent and stream into chat.
  host.setAgentEventSink((event) => {
    safeSend(AgentIpcChannels.EVENT, event)
  })
  // Auto-connect desired remotes + network-online edge wake.
  // (powerMonitor resume also wakes via registerAgentService.)
  void import('./environment/environment-connectivity-monitor')
    .then(({ attachEnvironmentConnectivityMonitor, createOnlineEdgeWatcher }) => {
      const online = createOnlineEdgeWatcher(() => net.isOnline())
      const unsubOffline = online.onOfflineEdge?.(() => {
        void host.wakeDesiredConnections('network-offline')
      })
      const disposeMonitor = attachEnvironmentConnectivityMonitor({
        onResume: () => {
          /* resume wired in powerMonitor */
        },
        onOnlineEdge: online.onOnlineEdge,
        startDesiredConnections: () => host.startDesiredConnections(),
        wakeDesiredConnections: (reason) => host.wakeDesiredConnections(reason),
        log: (message) => log.info(message),
      })
      environmentConnectivityDisposer = () => {
        disposeMonitor()
        unsubOffline?.()
        online.stop()
      }
    })
    .catch((err) => {
      log.warn(
        '[environment] connectivity monitor failed to start: %s',
        err instanceof Error ? err.message : String(err),
      )
    })
}

function registerIpcHandlers(): void {
  // Local harness catalog (Settings → Harnesses). Register before createWindow
  // so continueToMain's needsHarnessAlign invoke cannot race a dynamic import.
  registerHarnessIpcHandlers()
  registerIosSimulatorIpc(app.getPath('userData'))
  // The panel's own channels, one set for both platforms. Surfaces are rebuilt per
  // call rather than captured: the Android manager is constructed on first probe, so
  // a list taken at startup would be permanently iOS-only on a machine that has an
  // SDK. `listDevices` is the same enumeration the agent's `device_list` reads.
  registerDeviceIpc({
    surfaces: () => deviceSurfaces(app.getPath('userData')),
    listDevices: () => listAllDevices(app.getPath('userData')),
    setupOptions: () => probeDeviceSetup(app.getPath('userData')),
    openSetup: (kind) => openDeviceSetup(app.getPath('userData'), kind),
  })

  // Environment / remote-node product path (gateway + workspace router).
  // Lazy import keeps main boot light when environments unused.
  // NOTE: full renderer Session/store migration is a follow-up; these channels
  // make the Main path reachable without claiming UI Phase 0–3 complete.
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_LIST, async () => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().registry.list()
  })
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_GET_LOCAL_ID, async () => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().registry.getLocal().getEnvironmentId()
  })
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_WORKSPACE_LIST_DIR,
    async (_e, project: { environmentId: string; projectId: string }, relativePath: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().workspace().listDir({ project, relativePath })
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_WORKSPACE_READ_FILE,
    async (_e, project: { environmentId: string; projectId: string }, relativePath: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().workspace().readFile({ project, relativePath })
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_WORKSPACE_TAIL_WATCH_START,
    async (
      _e,
      project: { environmentId: string; projectId: string },
      relativePath: string,
      offset?: number,
      absolutePath?: string,
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().workspace().tailWatchStart({
        project,
        relativePath: relativePath ?? '',
        offset,
        ...(absolutePath ? { absolutePath } : {}),
      })
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_WORKSPACE_TAIL_WATCH_POLL,
    async (_e, watchId: string, project?: { environmentId: string; projectId: string }) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().workspace().tailWatchPoll({
        watchId,
        ...(project ? { project } : {}),
      })
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_WORKSPACE_TAIL_WATCH_STOP,
    async (_e, watchId: string, project: { environmentId: string; projectId: string }) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().workspace().tailWatchStop({ watchId, project })
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PAIR_REMOTE,
    async (_e, input: { baseUrl: string; pairingToken: string; label: string }) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().pairRemote(input)
    },
  )
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_CONNECT_FAILOVER, async (_e, connectionId: string) => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().connectWithFailover(connectionId)
  })
  // Dev-only local remote-node lab (host process on loopback — not Docker SSH).
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_LOCAL_LAB_STATUS, async () => {
    const { getLocalLabStatus } = await import('./environment/local-lab')
    return getLocalLabStatus()
  })
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_PAIR_LOCAL_LAB, async () => {
    const { getEnvironmentHost } = await import('./environment')
    const { pairLocalLab } = await import('./environment/local-lab')
    const host = getEnvironmentHost()
    attachEnvironmentStatusBridge(host)
    return pairLocalLab(host)
  })

  // Environment management (Settings → Environments).
  // The first listItems() call also attaches the supervisor → renderer status push.
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_LIST_ITEMS, async () => {
    const { getEnvironmentHost } = await import('./environment')
    const host = getEnvironmentHost()
    attachEnvironmentStatusBridge(host)
    return host.listEnvironments()
  })
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_ADD_OVER_SSH,
    async (_e, input: Parameters<EnvironmentHost['addRemoteOverSsh']>[0]) => {
      const { getEnvironmentHost } = await import('./environment')
      const host = getEnvironmentHost()
      attachEnvironmentStatusBridge(host)
      const result = await host.addRemoteOverSsh(input, (progress) => {
        safeSend(AgentIpcChannels.ENVIRONMENT_INSTALL_PROGRESS, {
          ...progress,
          operation: 'add',
        })
      })
      // Descriptor is structured-clone safe, but drop it to keep the payload lean.
      return {
        connectionId: result.connectionId,
        persisted: result.persisted,
        warnings: result.warnings,
        installed: result.installed,
      }
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_UPGRADE_NODE,
    async (_e, connectionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      const host = getEnvironmentHost()
      attachEnvironmentStatusBridge(host)
      return host.upgradeRemoteNode(connectionId, (progress) => {
        safeSend(AgentIpcChannels.ENVIRONMENT_INSTALL_PROGRESS, {
          ...progress,
          connectionId,
          operation: 'upgrade',
        })
      })
    },
  )
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_LIST_SSH_CONFIG_HOSTS, async () => {
    const { listSshConfigHosts } = await import('./environment/ssh-config')
    return listSshConfigHosts()
  })
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_HARNESS_LIST, async (_e, connectionId: string) => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().listRemoteHarnesses(connectionId)
  })
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_HARNESS_ENABLE,
    async (
      _e,
      connectionId: string,
      input: {
        harnessId: string
        artifactPath?: string
        command?: string
        serverUrl?: string
        args?: string[]
      },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().enableRemoteHarness(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_HARNESS_DISABLE,
    async (_e, connectionId: string, harnessId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().disableRemoteHarness(connectionId, harnessId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_HARNESS_PROBE,
    async (_e, connectionId: string, harnessId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().probeRemoteHarness(connectionId, harnessId)
    },
  )
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_LIST_PROJECTS, async (
    _e,
    connectionId: string,
    options?: { refresh?: boolean },
  ) => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().listProjects(connectionId, options)
  })
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_OPEN_PROJECT,
    async (
      _e,
      connectionId: string,
      projectPath: string,
      opts?: { createIfMissing?: boolean },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().openProject(connectionId, projectPath, opts)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_REMOVE_PROJECT,
    async (
      _e,
      connectionId: string,
      input: { projectId?: string; path?: string },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().removeProject(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_UPDATE_PROJECT,
    async (
      _e,
      connectionId: string,
      input: {
        projectId?: string
        path?: string
        name?: string
        extraDirs?: string[]
        addExtraDirs?: string[]
        removeExtraDirs?: string[]
      },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      const updated = await getEnvironmentHost().updateProject(connectionId, input)
      // A rename changes the sidebar label in every window; remote rows repaint
      // off the host-projects bus instead.
      if (connectionId === 'local') {
        safeSend(AgentIpcChannels.RECENT_FOLDERS_CHANGED, getRecentFolders())
      }
      return updated
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_LIST_SESSIONS,
    async (
      _e,
      connectionId: string,
      projectId: string,
      options: { limit: number; offset: number },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listSessions(connectionId, projectId, options)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_LIST_DRAFTS,
    async (_e, connectionId: string, projectPath?: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listDrafts(connectionId, projectPath)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_UPSERT_DRAFT,
    async (_e, connectionId: string, draft: DraftUpsertRequest) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().upsertDraft(connectionId, draft)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DELETE_DRAFT,
    async (_e, connectionId: string, draftId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      await getEnvironmentHost().deleteDraft(connectionId, draftId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_CREATE_SESSION,
    async (
      _e,
      connectionId: string,
      input: { projectId: string; title?: string; providerId?: string; harnessId?: string },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().createSession(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_GET_SESSION,
    async (_e, connectionId: string, sessionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().getSession(connectionId, sessionId)
    },
  )
  /** Paged denser message catalog for remote open/hydrate (session.messages.list). */
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_LIST_SESSION_MESSAGES,
    async (
      _e,
      connectionId: string,
      input: { sessionId: string; cursor?: string | number | null; limit?: number },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listSessionMessages(connectionId, input)
    },
  )
  // Node provider credentials (CRUD + push/pull)
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_CREDENTIALS,
    async (_e, connectionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listRemoteCredentials(connectionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_CREATE_CREDENTIAL,
    async (_e, connectionId: string, input: Record<string, unknown>) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().createRemoteCredential(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_UPDATE_CREDENTIAL,
    async (_e, connectionId: string, input: Record<string, unknown>) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().updateRemoteCredential(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_DELETE_CREDENTIAL,
    async (_e, connectionId: string, id: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().deleteRemoteCredential(connectionId, id)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_BINDINGS,
    async (_e, connectionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listRemoteBindings(connectionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_SET_BINDING,
    async (_e, connectionId: string, binding: Record<string, unknown>) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().setRemoteBinding(connectionId, binding)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_CLEAR_BINDING,
    async (_e, connectionId: string, consumer: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().clearRemoteBinding(connectionId, consumer)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_CUSTOM_PLATFORMS,
    async (_e, connectionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listRemoteCustomPlatforms(connectionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_UPSERT_CUSTOM_PLATFORM,
    async (_e, connectionId: string, def: Record<string, unknown>) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().upsertRemoteCustomPlatform(connectionId, def)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_DELETE_CUSTOM_PLATFORM,
    async (_e, connectionId: string, id: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().deleteRemoteCustomPlatform(connectionId, id)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_PUSH_LOCAL,
    async (_e, connectionId: string, opts?: { replaceAll?: boolean }) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().pushLocalProvidersToRemote(connectionId, opts)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_PULL_REMOTE,
    async (_e, connectionId: string, opts?: { replaceAll?: boolean }) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().pullRemoteProvidersToLocal(connectionId, opts)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_PROVIDER_LIST_MODELS,
    async (
      _e,
      connectionId: string,
      harness: string,
      apiProviderId?: string | null,
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listRemoteModels(connectionId, harness, apiProviderId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SEND_SESSION_MESSAGE,
    async (
      _e,
      connectionId: string,
      input: {
        sessionId: string
        text: string
        clientMessageId?: string
        projectPath?: string
        providerId?: string
        cwdHostPath?: string | null
        model?: string | null
        apiProviderId?: string | null
        turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
        collaborationMode?: string | Record<string, unknown> | null
        reviewTarget?: unknown
      },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      const host = getEnvironmentHost()
      attachEnvironmentStatusBridge(host)
      return host.sendSessionMessage(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_LIST_SESSION_EVENTS,
    async (_e, connectionId: string, afterSequence?: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().listSessionEvents(connectionId, afterSequence ?? '0')
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_INTERRUPT_SESSION,
    async (_e, connectionId: string, sessionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().interruptSession(connectionId, sessionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_RENAME_SESSION,
    async (_e, connectionId: string, sessionId: string, title: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().renameSession(connectionId, sessionId, title)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_REMOVE_SESSION,
    async (_e, connectionId: string, sessionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().removeSession(connectionId, sessionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_SET_SESSION_UI_FLAGS,
    async (
      _e,
      connectionId: string,
      sessionId: string,
      flags: { isPinned?: boolean; isHidden?: boolean },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().setSessionUiFlags(connectionId, sessionId, flags)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_FORK_SESSION,
    async (
      _e,
      connectionId: string,
      input: { sessionId: string; mode?: 'local' | 'worktree'; forkFromMessageId?: string },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().forkSession(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_PERMISSION,
    async (
      _e,
      connectionId: string,
      input: {
        sessionId: string
        interactionId: string
        decision: 'allow' | 'deny' | 'allow_always'
        continueDrain?: {
          projectPath?: string
          providerId?: string
          timeoutMs?: number
        }
      },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().respondSessionPermission(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_QUESTION,
    async (
      _e,
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
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().respondSessionQuestion(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_PLAN,
    async (
      _e,
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
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().respondSessionPlan(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_RESUME_REMOTE_SESSION_EVENTS,
    async (
      _e,
      connectionId: string,
      input: {
        sessionId: string
        projectPath?: string
        providerId?: string
        settleAfterInteractionId?: string
        timeoutMs?: number
      },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().resumeRemoteSessionEvents(connectionId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_BROWSE_PATH,
    async (_e, connectionId: string, absolutePath: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().browsePath(connectionId, absolutePath)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_CLONE_REPOSITORY,
    async (
      _e,
      connectionId: string,
      input: { remoteUrl: string; parentPath: string; directoryName?: string; shallow?: boolean },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().cloneRepository(connectionId, input)
    },
  )
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_CONNECT, async (_e, connectionId: string) => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().connect(connectionId)
  })
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_DISCONNECT, async (_e, connectionId: string) => {
    const { getEnvironmentHost } = await import('./environment')
    getEnvironmentHost().disconnect(connectionId)
  })
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_FORGET, async (_e, connectionId: string) => {
    const { getEnvironmentHost } = await import('./environment')
    getEnvironmentHost().forget(connectionId)
  })
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_RETRY_NOW, async (_e, connectionId: string) => {
    const { getEnvironmentHost } = await import('./environment')
    return getEnvironmentHost().retryNow(connectionId)
  })
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_REPAIR_PAIRING,
    async (
      _e,
      input: { connectionId: string; baseUrl: string; pairingToken: string },
    ) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().repairPairing(input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_REPAIR_PAIRING_SSH,
    async (_e, connectionId: string) => {
      const { getEnvironmentHost } = await import('./environment')
      return getEnvironmentHost().repairPairingOverSsh(connectionId, (progress) => {
        safeSend(AgentIpcChannels.ENVIRONMENT_INSTALL_PROGRESS, {
          ...progress,
          connectionId,
          operation: 'repair',
        })
      })
    },
  )

  ipcMain.handle(
    AgentIpcChannels.TERMINAL_CREATE,
    async (_e, opts: { projectPath: string; sessionId?: string; title?: string; cols?: number; rows?: number }) => {
      if (parseRemoteProjectKey(opts.projectPath)) {
        return remoteTerminalController.create(opts)
      }
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
  ipcMain.handle(AgentIpcChannels.TERMINAL_LIST, (_e, cwd?: string) => {
    if (cwd && parseRemoteProjectKey(cwd)) return remoteTerminalController.list(cwd)
    const local = terminalManager.list(cwd)
    return cwd === undefined ? [...local, ...remoteTerminalController.list()] : local
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_SNAPSHOT, async (_e, terminalId: string) => {
    if (remoteTerminalController.has(terminalId)) {
      return remoteTerminalController.snapshot(terminalId)
    }
    const session = terminalManager.get(terminalId)
    if (!session) return null
    return session.snapshot('local')
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_WRITE, async (_e, terminalId: string, data: string) => {
    if (remoteTerminalController.has(terminalId)) {
      await remoteTerminalController.write(terminalId, data)
      return
    }
    const session = terminalManager.get(terminalId)
    if (session?.ownership.isWritableBy('local')) session.input(data)
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_RESIZE, async (_e, terminalId: string, cols: number, rows: number) => {
    if (remoteTerminalController.has(terminalId)) {
      await remoteTerminalController.resize(terminalId, cols, rows)
      return
    }
    const session = terminalManager.get(terminalId)
    if (session?.ownership.isWritableBy('local')) session.resize(cols, rows)
  })
  ipcMain.handle(AgentIpcChannels.TERMINAL_KILL, async (_e, terminalId: string) => {
    if (remoteTerminalController.has(terminalId)) {
      await remoteTerminalController.kill(terminalId)
      return
    }
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
    return getRecentFoldersWithPresence()
  })

  ipcMain.handle(AgentIpcChannels.ADD_RECENT_FOLDER, async (_event, folderPath: string) => {
    if (!(await pathExistsBounded(folderPath, PATH_EXISTS_OPEN_TIMEOUT_MS))) return false
    addRecentFolder(folderPath)
    return true
  })

  ipcMain.handle(AgentIpcChannels.REMOVE_RECENT_FOLDER, async (_event, folderPath: string) => {
    removeRecentFolder(folderPath)
    return getRecentFoldersWithPresence()
  })

  ipcMain.handle(AgentIpcChannels.GET_PROJECT_ID, (_event, folderPath: string) => {
    return getProjectId(folderPath)
  })

  ipcMain.handle(AgentIpcChannels.OPEN_FOLDER, async (_event, folderPath: string) => {
    if (!(await pathExistsBounded(folderPath, PATH_EXISTS_OPEN_TIMEOUT_MS))) return false
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
    gitStatusSnapshot.invalidate(folderPath)
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null; serviceTier?: string | null; additionalDirectories?: string[] },
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
        additionalDirs: extras?.additionalDirectories,
        ...(extras?.userMessageContent ? { userMessageContent: extras.userMessageContent } : {}),
        ...(extras?.contexts ? { contexts: extras.contexts } : {}),
        ...(extras?.userSelections ? { userSelections: extras.userSelections } : {}),
        codex: {
          mode: 'run',
          prompt,
          reasoningEffort,
          serviceTier: extras?.serviceTier,
          permissionPreset,
          collaborationMode,
          threadId,
          cwd,
        },
      })
    },
  )

  ipcMain.handle(AgentIpcChannels.CODEX_LIST_MODELS, async (_event, projectPath: string, apiProviderId?: string | null, force?: boolean) => {
    const remoteKey = parseRemoteProjectKey(projectPath)
    // Remote: models come only from the node provider store (never local Codex/credentials).
    if (remoteKey) {
      try {
        const { getEnvironmentHost } = await import('./environment')
        const models = (await getEnvironmentHost().listRemoteModels(
          remoteKey.connectionId,
          'codex',
          apiProviderId ?? null,
        )) as ModelOption[]
        return Array.isArray(models) ? models : []
      } catch (err) {
        log.warn('[CODEX_LIST_MODELS] remote listModels failed: %s', err)
        return []
      }
    }

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

  ipcMain.handle(AgentIpcChannels.CODEX_GET_AUTH_STATUS, async (_event, projectPath: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetAuthStatus } = await import('./environment')
      const status = await remoteCodexGetAuthStatus(getEnvironmentHost(), projectPath)
      if (status) return status
      // Fail closed with an explicit offline marker — never invent a "healthy"
      // chatgpt profile that would hide a disconnected node.
      throw new Error('Remote Codex auth status unavailable (node not connected or project unresolved)')
    }
    return codexService.getAuthStatus(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_ACCOUNT_STATUS, async (_event, projectPath: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetAccountStatus } = await import('./environment')
      const status = await remoteCodexGetAccountStatus(getEnvironmentHost(), projectPath)
      if (status) return status
      throw new Error('Remote Codex account status unavailable (node not connected or project unresolved)')
    }
    return codexService.getAccountStatus()
  })

  ipcMain.handle(AgentIpcChannels.CODEX_ACCOUNT_LOGIN_START, async (_event, projectPath: string) => {
    let result: CodexAccountLoginStartResult
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexAccountLoginStart } = await import('./environment')
      const remoteResult = await remoteCodexAccountLoginStart(getEnvironmentHost(), projectPath)
      if (!remoteResult) throw new Error('Remote Codex login unavailable (node not connected or project unresolved)')
      result = remoteResult as CodexAccountLoginStartResult
    } else {
      result = await codexService.startAccountLogin(projectPath)
    }
    const url = result.authUrl ?? result.verificationUrl
    if (url) {
      void shell.openExternal(url).catch((error) => {
        log.warn('[codex] failed to open account login URL: %s', error instanceof Error ? error.message : String(error))
      })
    }
    return result
  })

  ipcMain.handle(AgentIpcChannels.CODEX_ACCOUNT_LOGIN_CANCEL, async (_event, projectPath: string, loginId: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexAccountLoginCancel } = await import('./environment')
      await remoteCodexAccountLoginCancel(getEnvironmentHost(), projectPath, loginId)
      return
    }
    await codexService.cancelAccountLogin(loginId)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_ACCOUNT_LOGOUT, async (_event, projectPath: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexAccountLogout } = await import('./environment')
      const status = await remoteCodexAccountLogout(getEnvironmentHost(), projectPath)
      if (status) return status
      throw new Error('Remote Codex logout unavailable (node not connected or project unresolved)')
    }
    return codexService.logoutAccount()
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_RATE_LIMITS, async (_event, projectPath: string, apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetRateLimits } = await import('./environment')
      return remoteCodexGetRateLimits(getEnvironmentHost(), projectPath, apiProviderId ?? null)
    }
    return codexService.getRateLimits(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_ACCOUNT_USAGE, async (_event, projectPath: string, apiProviderId?: string | null, threadId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetAccountUsage } = await import('./environment')
      return remoteCodexGetAccountUsage(getEnvironmentHost(), projectPath, apiProviderId ?? null, threadId ?? null)
    }
    return codexService.getAccountUsage(projectPath, apiProviderId ?? null, threadId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_SERVER_DIAGNOSTICS, async (_event, projectPath: string, apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetServerDiagnostics } = await import('./environment')
      return remoteCodexGetServerDiagnostics(getEnvironmentHost(), projectPath, apiProviderId ?? null)
    }
    return codexService.getServerDiagnostics(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_GET_CONFIG_REQUIREMENTS, async (_event, projectPath: string, apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetConfigRequirements } = await import('./environment')
      return remoteCodexGetConfigRequirements(getEnvironmentHost(), projectPath, apiProviderId ?? null)
    }
    return codexService.getConfigRequirements(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_CONSUME_RATE_LIMIT_RESET, async (_event, projectPath: string, apiProviderId?: string | null, creditId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexConsumeRateLimitReset } = await import('./environment')
      return remoteCodexConsumeRateLimitReset(
        getEnvironmentHost(),
        projectPath,
        apiProviderId ?? null,
        creditId ?? null,
      )
    }
    return codexService.consumeRateLimitReset(projectPath, apiProviderId ?? null, creditId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_OAUTH_LOGIN, async (
    _event,
    projectPath: string,
    serverName: string,
    apiProviderId?: string | null,
    options?: CodexMcpOauthLoginOptions,
  ) => {
    if (parseRemoteProjectKey(projectPath)) {
      // Node starts OAuth; browser open stays on desktop (result may include URL later via host_action).
      const { getEnvironmentHost, remoteCodexLoginMcpOauth } = await import('./environment')
      return remoteCodexLoginMcpOauth(
        getEnvironmentHost(),
        projectPath,
        serverName,
        apiProviderId ?? null,
        options,
      )
    }
    return codexService.loginMcpServerOauth(
      projectPath,
      serverName,
      apiProviderId ?? null,
      (url) => shell.openExternal(url),
      options,
    )
  })

  ipcMain.handle(AgentIpcChannels.CODEX_EXTERNAL_AGENT_DETECT, async (_event, projectPath: string, apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexDetectExternalAgent } = await import('./environment')
      const result = await remoteCodexDetectExternalAgent(
        getEnvironmentHost(),
        projectPath,
        apiProviderId ?? null,
      )
      if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
        return (result as { items: CodexExternalAgentItem[] }).items
      }
      return Array.isArray(result) ? result : []
    }
    return codexService.detectExternalAgentConfig(projectPath, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_EXTERNAL_AGENT_IMPORT, async (_event, projectPath: string, items: CodexExternalAgentItem[], apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexImportExternalAgent } = await import('./environment')
      return remoteCodexImportExternalAgent(
        getEnvironmentHost(),
        projectPath,
        items,
        apiProviderId ?? null,
      )
    }
    return codexService.importExternalAgentConfig(projectPath, items, apiProviderId ?? null)
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_GET_RATE_LIMITS, (_event, force?: boolean) => {
    return getClaudeRateLimits(force ?? false)
  })

  ipcMain.handle(AgentIpcChannels.PROVIDER_GET_RATE_LIMITS, (_event, apiProviderId: string, force?: boolean) => {
    return getProviderRateLimits(apiProviderId, force ?? false)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_SET_AUTH, async (_event, projectPath: string, request: CodexSetAuthRequest) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexSetAuth } = await import('./environment')
      return remoteCodexSetAuth(getEnvironmentHost(), projectPath, request)
    }
    return codexService.setAuth(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_HOOKS_LIST, (_event, projectPath: string, opts?: { forceReload?: boolean }) => {
    return codexHooksService.list(projectPath, opts)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_STATUS, async (_event, projectPath: string, serverName?: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      throw new Error('Codex MCP status for remote projects must be provided by the remote node')
    }
    const statuses = await codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('mcpServerStatus/list', {
        detail: 'full',
      })
      return Array.isArray(result.data) ? result.data : []
    })
    const { mapCodexMcpStatusForIpc } = await import('./codex/codex-mcp-status')
    const mapped = statuses.map(mapCodexMcpStatusForIpc).filter((entry): entry is import('@superone/shared/agent-types').McpServerInfo => entry !== null)
    return serverName ? mapped.filter((entry) => entry.name === serverName) : mapped
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_RESOURCE_READ, async (_event, projectPath: string, serverName: string, uri: string) => {
    if (!serverName.trim() || !uri.trim()) throw new Error('MCP resource requires server and uri')
    if (parseRemoteProjectKey(projectPath)) throw new Error('Codex MCP resource reads for remote projects are not supported by the local bridge')
    return codexService.withAppServerRequest(projectPath, async (request) =>
      request('mcpServer/resource/read', { server: serverName, uri }),
    )
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MCP_TOOL_CALL, async (_event, projectPath: string, threadId: string, serverName: string, toolName: string, args?: Record<string, unknown>) => {
    if (!threadId.trim() || !serverName.trim() || !toolName.trim()) throw new Error('MCP tool call requires threadId, server and tool')
    if (parseRemoteProjectKey(projectPath)) throw new Error('Codex MCP tool calls for remote projects are not supported by the local bridge')
    return codexService.withAppServerRequest(projectPath, async (request) =>
      request('mcpServer/tool/call', { threadId, server: serverName, tool: toolName, arguments: args ?? {} }),
    )
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

  ipcMain.handle(AgentIpcChannels.CODEX_MARKETPLACE_ADD, async (_event, projectPath: string, request: import('@superone/shared/agent-types').CodexMarketplaceAddRequest) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexMarketplaceAdd } = await import('./environment')
      return remoteCodexMarketplaceAdd(getEnvironmentHost(), projectPath, request)
    }
    return codexMarketplaceService.add(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MARKETPLACE_REMOVE, async (_event, projectPath: string, marketplaceName: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexMarketplaceRemove } = await import('./environment')
      return remoteCodexMarketplaceRemove(getEnvironmentHost(), projectPath, marketplaceName)
    }
    return codexMarketplaceService.remove(projectPath, marketplaceName)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_MARKETPLACE_UPGRADE, async (_event, projectPath: string, marketplaceName?: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexMarketplaceUpgrade } = await import('./environment')
      return remoteCodexMarketplaceUpgrade(getEnvironmentHost(), projectPath, marketplaceName)
    }
    return codexMarketplaceService.upgrade(projectPath, marketplaceName)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_LIST, async (_event, projectPath: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexPluginsList } = await import('./environment')
      const result = await remoteCodexPluginsList(getEnvironmentHost(), projectPath)
      if (result && typeof result === 'object' && Array.isArray((result as { plugins?: unknown }).plugins)) {
        return (result as { plugins: unknown[] }).plugins
      }
      return Array.isArray(result) ? result : []
    }
    return codexPluginsService.listPlugins(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_READ, (_event, projectPath: string, key: string) => {
    // Node admin surface has no plugins.read; remote paths have no local FS.
    if (parseRemoteProjectKey(projectPath)) return null
    return codexPluginsService.readPlugin(projectPath, key)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_READ_FILE, (_event, projectPath: string, key: string, relativePath: string) => {
    if (parseRemoteProjectKey(projectPath)) return null
    return codexPluginsService.readPluginFile(projectPath, key, relativePath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_DELETE, async (_event, projectPath: string, key: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexPluginsUninstall } = await import('./environment')
      await remoteCodexPluginsUninstall(getEnvironmentHost(), projectPath, key)
      return
    }
    await codexPluginsService.uninstallPlugin(projectPath, key)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_LIST_MARKETPLACE, async (_event, projectPath: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexPluginsList } = await import('./environment')
      const result = await remoteCodexPluginsList(getEnvironmentHost(), projectPath, {
        marketplace: true,
      })
      if (result && typeof result === 'object' && Array.isArray((result as { plugins?: unknown }).plugins)) {
        return (result as { plugins: unknown[] }).plugins
      }
      return Array.isArray(result) ? result : []
    }
    return codexPluginsService.listMarketplacePlugins(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLUGINS_INSTALL, async (_event, projectPath: string, key: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexPluginsInstall } = await import('./environment')
      await remoteCodexPluginsInstall(getEnvironmentHost(), projectPath, key)
      return
    }
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null; serviceTier?: string | null; additionalDirectories?: string[] },
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
        additionalDirs: extras?.additionalDirectories,
        ...(extras?.userMessageContent ? { userMessageContent: extras.userMessageContent } : {}),
        ...(extras?.contexts ? { contexts: extras.contexts } : {}),
        ...(extras?.userSelections ? { userSelections: extras.userSelections } : {}),
        codex: {
          mode: 'review',
          reviewTarget: target,
          reasoningEffort,
          serviceTier: extras?.serviceTier,
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
      extras?: { contexts?: ChatMessageContext[]; userSelections?: string[]; userMessageContent?: ContentBlock[]; apiProviderId?: string | null; serviceTier?: string | null; additionalDirectories?: string[] },
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
        additionalDirs: extras?.additionalDirectories,
        ...(extras?.userMessageContent ? { userMessageContent: extras.userMessageContent } : {}),
        ...(extras?.contexts ? { contexts: extras.contexts } : {}),
        ...(extras?.userSelections ? { userSelections: extras.userSelections } : {}),
        codex: {
          mode: 'compact',
          serviceTier: extras?.serviceTier,
          permissionPreset,
          threadId,
          cwd,
        },
      })
    },
  )

  // Every session pane refreshes on the same signal (its turn going idle), so
  // the requests arrive together and want the same snapshot. No TTL: a refresh
  // often follows a checkout the user just made, and must not read a stale one.
  const gitInfoCoalescer = new AsyncCoalescer<GitInfo | null>()

  ipcMain.handle(AgentIpcChannels.GIT_INFO, (_event, folderPath: string) =>
    gitInfoCoalescer.get(folderPath, async () => {
      const startedAt = Date.now()
      try {
        if (parseRemoteProjectKey(folderPath)) {
          const { getEnvironmentHost } = await import('./environment')
          const { getRemoteGitInfo } = await import('./environment/remote-file-tree')
          return getRemoteGitInfo(getEnvironmentHost(), folderPath)
        }
        let branch: string
        try {
          branch = await gitRun(folderPath, ['rev-parse', '--abbrev-ref', 'HEAD'], undefined, GIT_READ_OPTS)
        } catch {
          const ref = await gitRun(folderPath, ['symbolic-ref', 'HEAD'], undefined, GIT_READ_OPTS)
          branch = ref.replace('refs/heads/', '')
        }
        const status = await gitRun(folderPath, ['status', '--porcelain', '-uall'], undefined, GIT_READ_OPTS)
        const files = status ? status.split('\n').filter(Boolean).length : 0
        let insertions = 0
        let deletions = 0
        if (files > 0) {
          try {
            const shortstat = await gitRun(folderPath, ['diff', 'HEAD', '--shortstat'], undefined, GIT_READ_OPTS)
            const insMatch = shortstat.match(/(\d+) insertion/)
            const delMatch = shortstat.match(/(\d+) deletion/)
            if (insMatch) insertions = parseInt(insMatch[1])
            if (delMatch) deletions = parseInt(delMatch[1])
          } catch {
            /* no HEAD yet or no tracked changes */
          }
          try {
            const untrackedRaw = await gitRun(folderPath, ['ls-files', '--others', '--exclude-standard', '-z'], undefined, GIT_READ_OPTS)
            const untracked = untrackedRaw ? untrackedRaw.split('\0').filter(Boolean) : []
            for (const rel of untracked) {
              try {
                insertions += await countAddedLines(join(folderPath, rel))
              } catch {
                /* skip unreadable */
              }
            }
          } catch {
            /* no untracked or git unavailable */
          }
        }
        const elapsed = Date.now() - startedAt
        if (elapsed > GIT_INFO_SLOW_MS) logSlowGit('GIT_INFO', folderPath, elapsed, `changedFiles=${files}`)
        return {
          branch,
          ...(files > 0 ? { dirty: { files, insertions, deletions } } : {}),
        }
      } catch (err) {
        // Returning null here hides the whole branch chip (ChatStatusBar renders
        // it only when gitInfo is non-null, and the "Git init" fallback only when
        // `.git` is absent) — so a repo git refuses to read leaves the status bar
        // blank with no other trace. Log it.
        const isRemote = Boolean(parseRemoteProjectKey(folderPath))
        logGitFailure(
          'GIT_INFO',
          folderPath,
          err,
          isRemote ? true : existsSync(join(folderPath, '.git')),
        )
        return null
      }
    }),
  )

  ipcMain.handle(AgentIpcChannels.GIT_IS_REPO, async (_event, folderPath: string) => {
    if (parseRemoteProjectKey(folderPath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { getRemoteGitIsRepo } = await import('./environment/remote-file-tree')
      return (await getRemoteGitIsRepo(getEnvironmentHost(), folderPath)) === true
    }
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { getRemoteGitBranches } = await import('./environment/remote-file-tree')
        return (await getRemoteGitBranches(getEnvironmentHost(), folderPath)) ?? []
      }
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { remoteSwitchBranch } = await import('./environment/remote-worktree')
        return remoteSwitchBranch(getEnvironmentHost(), folderPath, branch, false)
      }
      await gitRun(folderPath, ['checkout', sanitizeGitRef(branch)])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_CREATE_BRANCH, async (_event, folderPath: string, branch: string) => {
    if (parseRemoteProjectKey(folderPath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { remoteSwitchBranch } = await import('./environment/remote-worktree')
      return remoteSwitchBranch(getEnvironmentHost(), folderPath, branch, true)
    }
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
    if (parseRemoteProjectKey(folderPath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { getRemoteWorktreeInfo } = await import('./environment/remote-file-tree')
      return getRemoteWorktreeInfo(getEnvironmentHost(), folderPath)
    }
    return getWorktreeInfo(folderPath)
  })

  ipcMain.handle(AgentIpcChannels.GIT_SWITCH_WORKTREE, async (_event, folderPath: string, wtPath: string, gitBranch: string | null) => {
    try {
      if (parseRemoteProjectKey(folderPath)) {
        // Remote: no local SessionManager cwd. Renderer stores activePath; next
        // sendSessionMessage applies session.setCwd via cwdHostPath. Existence is on node.
        void gitBranch
        return { ok: true as const }
      }
      if (!existsSync(wtPath)) return { ok: false as const, error: 'Worktree path not found' }
      await agentService.switchCwd(folderPath, wtPath, gitBranch)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_CHECKED_OUT_BRANCHES, async (_event, folderPath: string) => {
    if (parseRemoteProjectKey(folderPath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { remoteCheckedOutBranches } = await import('./environment/remote-worktree')
      return (await remoteCheckedOutBranches(getEnvironmentHost(), folderPath)) ?? []
    }
    return getCheckedOutBranches(folderPath)
  })

  ipcMain.handle(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, async (_event, folderPath: string, request: WorktreeActivateRequest | null) => {
    try {
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { remoteActivateWorktree } = await import('./environment/remote-worktree')
        return remoteActivateWorktree(getEnvironmentHost(), folderPath, request)
      }
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

  ipcMain.handle(AgentIpcChannels.GIT_HANDOFF_TO_LOCAL, async (_event, worktreePath: string, folderPath?: string) => {
    try {
      const projectKey =
        folderPath && parseRemoteProjectKey(folderPath)
          ? folderPath
          : parseRemoteProjectKey(worktreePath)
            ? worktreePath
            : null
      if (projectKey && parseRemoteProjectKey(projectKey)) {
        // Prefer explicit project key when provided; otherwise derive connection from worktree remote key.
        const remoteFolder =
          folderPath && parseRemoteProjectKey(folderPath)
            ? folderPath
            : (() => {
                const wt = parseRemoteProjectKey(worktreePath)
                // Project key is unknown if only worktree remote path is given — use connection + path's project via open.
                return wt ? worktreePath : null
              })()
        if (remoteFolder) {
          const { getEnvironmentHost } = await import('./environment')
          const { remoteHandoffToMain } = await import('./environment/remote-worktree')
          // folderPath should be the project key; if worktreePath is remote, pass project via folderPath arg.
          const proj =
            folderPath && parseRemoteProjectKey(folderPath) ? folderPath : remoteFolder
          return remoteHandoffToMain(getEnvironmentHost(), proj, worktreePath)
        }
      }
      return await handoffToLocal(worktreePath)
    } catch (err) {
      log.warn('[handoff] unexpected failure:', err)
      return { ok: false as const, reason: 'error' as const, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_HANDOFF_PREVIEW, async (_event, worktreePath: string, folderPath?: string) => {
    if (folderPath && parseRemoteProjectKey(folderPath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { remoteHandoffPreview } = await import('./environment/remote-worktree')
      return remoteHandoffPreview(getEnvironmentHost(), folderPath, worktreePath)
    }
    if (parseRemoteProjectKey(worktreePath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { remoteHandoffPreview } = await import('./environment/remote-worktree')
      // Need project key for projectId — use worktree remote path's connection + resolve via list
      return remoteHandoffPreview(getEnvironmentHost(), worktreePath, worktreePath)
    }
    return getHandoffPreview(worktreePath)
  })

  ipcMain.handle(AgentIpcChannels.GIT_ASSIGN_BRANCH, async (_event, folderPath: string, worktreePath: string, name: string) => {
    if (parseRemoteProjectKey(folderPath)) {
      const { getEnvironmentHost } = await import('./environment')
      const { remoteAssignBranch } = await import('./environment/remote-worktree')
      return remoteAssignBranch(getEnvironmentHost(), folderPath, worktreePath, name)
    }
    const result = await assignBranch(worktreePath, name)
    if (result.ok) await agentService.switchCwd(folderPath, worktreePath, result.branch)
    return result
  })

  const EXT_LANG: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.json': 'json', '.ipynb': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { getRemoteGitDiffFile } = await import('./environment/remote-file-tree')
        return (
          (await getRemoteGitDiffFile(getEnvironmentHost(), folderPath, filePath, staged)) ?? {
            path: filePath,
            diff: '',
          }
        )
      }
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
  ipcMain.handle(AgentIpcChannels.READ_PROJECT_FILE, async (_event, folderPath: string, filePath: string) => {
    try {
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { readRemoteProjectFile } = await import('./environment/remote-file-tree')
        return (
          (await readRemoteProjectFile(getEnvironmentHost(), folderPath, filePath)) ?? {
            path: filePath,
            content: '',
            language: 'text',
          }
        )
      }
      const ext = extname(filePath).toLowerCase()
      if (BINARY_IMAGE_EXTS.has(ext)) return { path: filePath, content: '', language: 'image' }
      if (PDF_EXTS.has(ext)) return { path: filePath, content: '', language: 'pdf' }
      if (VIDEO_EXTS.has(ext)) return { path: filePath, content: '', language: 'video' }
      if (AUDIO_EXTS.has(ext)) return { path: filePath, content: '', language: 'audio' }
      const fullPath = resolveRealPath(isAbsolute(filePath) ? filePath : join(folderPath, filePath))
      if (!isAbsolute(filePath) && !isPathWithinAllowed(fullPath, [folderPath])) {
        return { path: filePath, content: '', language: 'text' }
      }
      const kind = await detectTextOrBinary(fullPath, maxReadableBytes(ext))
      if (kind === 'binary') return { path: filePath, content: '', language: 'binary' }
      if (kind === 'too-large') return { path: filePath, content: '', language: 'too-large' }
      const content = await readFile(fullPath, 'utf-8')
      if (ext === '.svg') return { path: filePath, content, language: 'svg' }
      const language = EXT_LANG[ext] ?? 'text'
      return { path: filePath, content, language }
    } catch (err) {
      return { path: filePath, content: '', language: 'text', error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.SAVE_FILE, async (_event, folderPath: string, filePath: string, content: string) => {
    try {
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { saveRemoteProjectFile } = await import('./environment/remote-file-tree')
        return (
          (await saveRemoteProjectFile(getEnvironmentHost(), folderPath, filePath, content)) ?? {
            ok: false,
            error: 'remote save failed',
          }
        )
      }
      // Absolute paths (including outside the project) are writable — local files
      // opened from chat chips. Relative paths stay sandboxed to the project.
      const isAbs = isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath)
      const fullPath = isAbs
        ? resolveRealPath(filePath)
        : validatePathInProject(folderPath, join(folderPath, filePath))
      await writeFile(fullPath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  const SKIP_DIRS = new Set(['.git'])

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

  const EMPTY_PARSED_STATUS: ParsedGitStatus = {
    statusMap: new Map(),
    ignoredDirs: new Set(),
    untrackedDirs: new Set(),
  }

  ipcMain.handle(AgentIpcChannels.GIT_FILE_TREE, async (_event, folderPath: string) => {
    try {
      let parsed: ParsedGitStatus = EMPTY_PARSED_STATUS
      try {
        const raw = await gitRun(folderPath, GIT_TREE_STATUS_ARGS)
        if (raw) parsed = parseGitStatusOutput(raw)
      } catch { /* not a git repo or no commits */ }

      async function walk(dir: string): Promise<FileTreeEntry[]> {
        const entries = await readdir(dir, { withFileTypes: true })
        const result: FileTreeEntry[] = []

        const sorted = await decorateEntries(dir, entries)

        for (const { entry, isDir } of sorted) {
          if (SKIP_DIRS.has(entry.name)) continue
          if (entry.name === '.DS_Store') continue

          const fullPath = join(dir, entry.name)
          const relPath = relative(folderPath, fullPath).split(/[/\\]/).join('/')

          const pair = resolveEntryStatusPair(relPath, isDir, parsed)
          if (isDir) {
            const children = await walk(fullPath)
            result.push({
              name: entry.name,
              path: relPath,
              isDirectory: true,
              children,
              gitIndex: pair.index,
              gitWorktree: pair.worktree,
            })
          } else {
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

  // Read once per directory listing, so a short TTL is what keeps a deep tree
  // expansion from re-running the status read for every folder. The file
  // watcher also invalidates this on any change (see FILE_WATCH_START).
  const GIT_STATUS_CACHE_TTL_MS = 1500
  const gitStatusSnapshot = new AsyncCoalescer<ParsedGitStatus>(GIT_STATUS_CACHE_TTL_MS)

  function getGitStatusMap(folderPath: string) {
    return gitStatusSnapshot.get(folderPath, async () => {
      try {
        const raw = await gitRun(folderPath, GIT_TREE_STATUS_ARGS, undefined, GIT_READ_OPTS)
        if (raw) return parseGitStatusOutput(raw)
      } catch (err) {
        logGitFailure('GIT_STATUS_MAP', folderPath, err, existsSync(join(folderPath, '.git')))
      }
      return {
        statusMap: new Map<string, GitStatusPair>(),
        ignoredDirs: new Set<string>(),
        untrackedDirs: new Set<string>(),
      }
    })
  }

  ipcMain.handle(AgentIpcChannels.GIT_LIST_DIR, async (_event, folderPath: string, dirRelPath: string) => {
    try {
      // Remote projects use workspace RPC (not local readdir on the remote: key).
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { listRemoteFileTreeDir } = await import('./environment/remote-file-tree')
        const remoteEntries = await listRemoteFileTreeDir(
          getEnvironmentHost(),
          folderPath,
          dirRelPath ?? '',
        )
        return remoteEntries ?? []
      }

      const parsed = await getGitStatusMap(folderPath)
      const targetDir = dirRelPath ? join(folderPath, dirRelPath) : folderPath
      const entries = await readdir(targetDir, { withFileTypes: true })

      const sorted = await decorateEntries(targetDir, entries)

      const result: FileTreeEntry[] = []
      for (const { entry, isDir } of sorted) {
        if (SKIP_DIRS.has(entry.name) || entry.name === '.DS_Store') continue
        const relPath = dirRelPath ? dirRelPath + '/' + entry.name : entry.name
        const pair = resolveEntryStatusPair(relPath, isDir, parsed)
        result.push({
          name: entry.name,
          path: relPath,
          isDirectory: isDir,
          children: undefined,
          gitIndex: pair.index,
          gitWorktree: pair.worktree,
        })
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { moveRemoteFile } = await import('./environment/remote-file-tree')
        return (
          (await moveRemoteFile(getEnvironmentHost(), folderPath, srcRelPath, destDirRelPath)) ?? {
            ok: false,
            error: 'remote move failed',
          }
        )
      }
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { copyLocalPathsIntoRemote } = await import('./environment/remote-file-tree')
        return (
          (await copyLocalPathsIntoRemote(
            getEnvironmentHost(),
            folderPath,
            destDirRelPath,
            absolutePaths,
          )) ?? { ok: false, error: 'remote copy failed' }
        )
      }
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { movePathsIntoRemote } = await import('./environment/remote-file-tree')
        return (
          (await movePathsIntoRemote(
            getEnvironmentHost(),
            folderPath,
            destDirRelPath,
            absolutePaths,
          )) ?? { ok: false, error: 'remote move failed' }
        )
      }
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
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { deleteRemoteFile } = await import('./environment/remote-file-tree')
        return (
          (await deleteRemoteFile(getEnvironmentHost(), folderPath, relPath)) ?? {
            ok: false,
            error: 'remote delete failed',
          }
        )
      }
      const absPath = validatePathInProject(folderPath, relPath)
      await shell.trashItem(absPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(AgentIpcChannels.FILE_RENAME, async (_event, folderPath: string, relPath: string, newName: string): Promise<FileOpResult> => {
    try {
      if (parseRemoteProjectKey(folderPath)) {
        const { getEnvironmentHost } = await import('./environment')
        const { renameRemoteFile } = await import('./environment/remote-file-tree')
        return (
          (await renameRemoteFile(getEnvironmentHost(), folderPath, relPath, newName)) ?? {
            ok: false,
            error: 'remote rename failed',
          }
        )
      }
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
    // Remote project keys are not local paths — local shell reveal would open the wrong place.
    if (typeof folderPath === 'string' && folderPath.startsWith('remote:')) {
      return
    }
    // Absolute relPath (or Windows drive path) is revealed as-is so out-of-project
    // file chips can "Show in Folder". Relative paths stay inside the project.
    const isAbs = !!relPath && (isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath))
    const absPath = isAbs
      ? resolveRealPath(relPath)
      : validatePathInProject(folderPath, relPath)
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

  ipcMain.on(AgentIpcChannels.START_DRAG, (event, paths: string[], iconOpts?: { png: ArrayBuffer; scaleFactor?: number }) => {
    // Prefer a fully-sync path when every path exists locally and a PNG icon was
    // supplied. Remote project keys (`remote:…`) are materialized asynchronously
    // via workspace RPC before Electron startDrag (same pattern as async icons).
    const run = async (): Promise<void> => {
      const input = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
      let files = input.filter((p) => existsSync(p))
      const needsRemote = input.some((p) => !existsSync(p) && p.startsWith('remote:'))
      if (needsRemote) {
        try {
          const { getEnvironmentHost } = await import('./environment')
          const { resolvePathsForNativeDrag } = await import('./environment/remote-file-tree')
          files = await resolvePathsForNativeDrag(getEnvironmentHost(), input)
        } catch (err) {
          log.warn('[start-drag] remote materialize failed:', err)
        }
      }
      files = files.filter((p) => existsSync(p))
      if (files.length === 0) {
        log.warn('[start-drag] skipped: no draggable files for %o', paths)
        return
      }
      if (iconOpts?.png) {
        const icon = nativeImage.createFromBuffer(Buffer.from(iconOpts.png), {
          scaleFactor: iconOpts.scaleFactor ?? 1,
        })
        if (icon.isEmpty()) {
          log.warn('[start-drag] skipped: empty supplied icon for %s', files[0])
          return
        }
        event.sender.startDrag({ files, file: files[0], icon })
        return
      }
      const icon = await app.getFileIcon(files[0], {
        size: files[0].endsWith('.app') ? 'normal' : 'small',
      })
      if (icon.isEmpty()) {
        log.warn('[start-drag] skipped: empty file icon for %s', files[0])
        return
      }
      event.sender.startDrag({ files, file: files[0], icon })
    }
    try {
      // Sync fast-path: all local + PNG (Computer Use float / file chips).
      if (
        iconOpts?.png &&
        Array.isArray(paths) &&
        paths.every((p) => typeof p === 'string' && existsSync(p))
      ) {
        const files = paths as string[]
        const icon = nativeImage.createFromBuffer(Buffer.from(iconOpts.png), {
          scaleFactor: iconOpts.scaleFactor ?? 1,
        })
        if (icon.isEmpty()) {
          log.warn('[start-drag] skipped: empty supplied icon for %s', files[0])
          return
        }
        event.sender.startDrag({ files, file: files[0], icon })
        return
      }
      void run().catch((err) => log.warn('[start-drag] failed:', err))
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
      paths: string[],
      iconOpts?: { png: ArrayBuffer; scaleFactor?: number },
    ) => {
      if (!Array.isArray(paths) || paths.length === 0) return
      if (typeof projectDir !== 'string' || typeof appId !== 'string') return
      try {
        const files: string[] = []
        for (const path of paths) {
          if (!isPathExposableByApp(projectDir, appId, path)) {
            log.warn('[miniapp start-drag] path outside app scope: %s', path)
            continue
          }
          if (existsSync(path)) files.push(path)
          else log.warn('[miniapp start-drag] file not found: %s', path)
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

  ipcMain.on(AgentIpcChannels.MINIAPP_SHOW_ITEM_IN_FOLDER, (_event, projectDir: string, appId: string, path: string) => {
    if (typeof projectDir !== 'string' || typeof appId !== 'string') return
    if (!isPathExposableByApp(projectDir, appId, path)) {
      log.warn('[miniapp show-item] path outside app scope: %s', path)
      return
    }
    shell.showItemInFolder(path)
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

  ipcMain.handle(AgentIpcChannels.DISCOVER_GROK_WORKFLOWS, async (_event, projectPath?: string | null) => {
    const path = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : null
    return discoverGrokWorkflows(path)
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

  ipcMain.handle(
    AgentIpcChannels.SAVE_TEXT_AS,
    async (_event, text: string, suggestedName: string) => {
      try {
        const ext = extname(suggestedName).toLowerCase().replace(/^\./, '') || 'txt'
        const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
          defaultPath: suggestedName,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        })
        if (result.canceled || !result.filePath) return { ok: false, canceled: true }
        await writeFile(result.filePath, text, 'utf8')
        return { ok: true, savedPath: result.filePath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
  )

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

  ipcMain.handle(AgentIpcChannels.UPDATER_DOWNLOAD, () => {
    downloadUpdate()
  })

  ipcMain.handle(AgentIpcChannels.UPDATER_RETRY_HARNESS, () => {
    retryUpdateHarnessPrefetch()
  })

  ipcMain.handle(AgentIpcChannels.UPDATER_SIMULATE, () => {
    simulateUpdate()
  })

  ipcMain.handle(AgentIpcChannels.FILE_WATCH_START, (_e, folderPath: string) => {
    startWatching(getMainWindow(), folderPath, () => {
      gitStatusSnapshot.invalidate(folderPath)
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
  ipcMain.handle(AgentIpcChannels.APP_INSTALL_ID_GET, () => getInstallId())
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_OPEN_PERMISSIONS,
    async (
      _event,
      /**
       * false — status only.
       * true | 'guided' — two-step onboarding float (first enable).
       * 'accessibility' | 'screenRecording' — single-permission float.
       */
      request: boolean | 'guided' | PrivacyPane = true,
    ) => {
      const status = await getComputerUsePermissionStatus(false)
      if (process.platform !== 'darwin') return status

      // Shared with Recheck so poll does not re-trigger missing→granted restarts.
      noteComputerUsePermissionBaseline(status)
      const pollStatus = () => pollComputerUsePermissionStatus()

      if (request === false) {
        return status
      }

      if (request === 'accessibility' || request === 'screenRecording') {
        showComputerUsePermissionFloat(status, {
          flow: 'single',
          pane: request,
          pollStatus,
        })
        return status
      }

      // true | 'guided' — full two-step onboarding
      if (status.reason === 'already_granted') return status
      showComputerUsePermissionFloat(status, {
        flow: 'guided',
        pollStatus,
      })
      return status
    },
  )
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_RECHECK_PERMISSIONS, async () => {
    // recheckComputerUsePermissionStatus notes baseline before return.
    const status = await recheckComputerUsePermissionStatus()
    if (!status.error) {
      pushComputerUsePermissionStatus(status)
    }
    return status
  })
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_CLOSE_PERMISSION_FLOAT, () => {
    closeComputerUsePermissionFloat()
  })
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_RESIZE_PERMISSION_FLOAT,
    (_event, width: number, height: number) => {
      resizeComputerUsePermissionFloat(width, height)
    },
  )
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_CONTINUE_PERMISSION_STEP, () => {
    continueComputerUsePermissionStep()
  })
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_LIST_RUNNING_APPS, async () => {
    if (process.platform !== 'darwin') return []
    try {
      const { getOrCreateComputerUseService } = await import('./computer-use/tools')
      // Settings UI is not session-scoped; use a dedicated service id for listing.
      const service = getOrCreateComputerUseService('__settings__')
      return await service.listRunningApps()
    } catch (err) {
      log.warn(
        '[computer-use] list running apps failed: %s',
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  })
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_LIST_DISPLAYS, () => {
    return listComputerUseDisplays()
  })
  /**
   * The renderer owns the shared viewfinder arbitration, so it is the one that says
   * when the native window has lost. Hidden immediately rather than only on the next
   * action: the whole point of yielding is that something else is on screen NOW.
   */
  ipcMain.on(AgentIpcChannels.COMPUTER_USE_VIEWFINDER_YIELD, (_event, yielded: boolean) => {
    void (async () => {
      const { setComputerUseViewfinderYielded } = await import('./computer-use/viewfinder')
      if (!setComputerUseViewfinderYielded(yielded === true) || !yielded) return
      if (process.platform !== 'darwin') return
      try {
        const { getSharedHelperClient } = await import('./computer-use/platform/macos-helper-client')
        await getSharedHelperClient().call('pip_hide', {})
      } catch {
        // helper offline or unsupported platform
      }
    })()
  })
  ipcMain.handle(AgentIpcChannels.COMPUTER_USE_LIST_INSTALLED_APPS, async () => {
    if (process.platform !== 'darwin') return []
    try {
      const { listInstalledApps } = await import('./computer-use/resolve-installed-app')
      // Async scan — do not block the main process with sync readdir/plutil.
      const apps = await listInstalledApps()
      return apps.map((a) => ({
        app: a.app,
        bundleId: a.bundleId,
        aliases: a.aliases,
      }))
    } catch (err) {
      log.warn(
        '[computer-use] list installed apps failed: %s',
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  })
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_GRANT_SESSION_APPS,
    async (
      event,
      sessionId: string,
      apps: Array<{ app: string; bundleId: string }>,
    ) => {
      if (process.platform !== 'darwin') return false
      if (typeof sessionId !== 'string' || !sessionId.trim()) return false
      if (!Array.isArray(apps) || apps.length === 0 || apps.length > 16) return false
      // Only main-window / known app renderers may grant (not arbitrary web contents).
      const senderUrl = event.sender.getURL?.() ?? ''
      if (
        senderUrl
        && !senderUrl.startsWith('file:')
        && !senderUrl.includes('localhost')
        && !senderUrl.startsWith('app:')
      ) {
        log.warn('[computer-use] grant session apps rejected sender url=%s', senderUrl)
        return false
      }
      try {
        const {
          grantComputerUseSessionApps,
          isComputerUseEnabled,
        } = await import('./computer-use/tools')
        if (!isComputerUseEnabled()) return false
        const n = grantComputerUseSessionApps(
          sessionId.trim(),
          apps
            .filter((a) => a && typeof a.bundleId === 'string')
            .map((a) => ({
              app: typeof a.app === 'string' ? a.app : a.bundleId,
              bundleId: String(a.bundleId).trim(),
            })),
        )
        return n > 0
      } catch (err) {
        log.warn(
          '[computer-use] grant session apps failed: %s',
          err instanceof Error ? err.message : String(err),
        )
        return false
      }
    },
  )
  ipcMain.handle(
    AgentIpcChannels.COMPUTER_USE_RESOLVE_APP_ICON,
    async (_event, bundleId: string) => {
      if (process.platform !== 'darwin') return null
      if (typeof bundleId !== 'string' || !bundleId.trim()) return null
      const id = bundleId.trim()
      try {
        const { resolveAppIconDataUri, isSafeBundleId } = await import(
          './computer-use/app-icon-resolver'
        )
        if (!isSafeBundleId(id)) return null
        const uri = await resolveAppIconDataUri(id)
        log.info(
          '[computer-use] IPC resolve-app-icon %s → %s',
          id,
          uri ? `ok (${uri.length} chars)` : 'null',
        )
        return uri
      } catch (err) {
        log.warn(
          '[computer-use] resolve app icon failed for %s: %s',
          id,
          err instanceof Error ? err.message : String(err),
        )
        return null
      }
    },
  )
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
  ipcMain.handle(AgentIpcChannels.USAGE_COUNTS_QUERY, (_e, range: { from?: string; to?: string; harness?: 'claude' | 'codex' | 'grok' } | undefined) => {
    return queryCounts(range ?? {})
  })
  ipcMain.handle(AgentIpcChannels.USAGE_HARNESS_SESSION_RANKS, (_e, days: number | undefined) => {
    return queryHarnessSessionRanks(typeof days === 'number' ? days : 7)
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
      // QR pairing is phone-only today; desktop clients will set this explicitly later.
      clientKind: 'mobile' as const,
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
    // Remote node supervisors: probe live sockets / re-dial desired connections.
    void import('./environment')
      .then(({ getEnvironmentHost }) => getEnvironmentHost().wakeDesiredConnections('app-resume'))
      .catch((err) => {
        log.warn(
          '[environment] wakeDesiredConnections on resume failed: %s',
          err instanceof Error ? err.message : String(err),
        )
      })
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

  ipcMain.on(AgentIpcChannels.SET_WINDOW_CHROME_COLORS, (_e, colors: { backgroundColor: string; symbolColor: string }): void => {
    if (process.platform !== 'win32') return
    if (!HEX_COLOR_RE.test(colors?.backgroundColor ?? '') || !HEX_COLOR_RE.test(colors?.symbolColor ?? '')) return
    const win = BrowserWindow.fromWebContents(_e.sender)
    if (!win || win.isDestroyed()) return
    applyWindowChromeColors(win, colors)
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
    const cursor = getCachedHarnessResources('cursor')
    const sandboxCapability = getSandboxCapability()
    log.info(
      '[GET_STARTUP_DATA] cached: claude=%s codex=%s acp=%s opencode=%s cursor=%s sandbox=%s',
      claude ? `${claude.models?.length ?? 0} models` : 'null',
      codex ? `${codex.models?.length ?? 0} models` : 'null',
      acp ? `${acp.agents?.length ?? 0} agents` : 'null',
      opencode ? `${opencode.models?.length ?? 0} models` : 'null',
      cursor ? `${cursor.models?.length ?? 0} models` : 'null',
      sandboxCapability.supportLevel,
    )
    return { cached: { claude, codex, acp, opencode, cursor }, sandboxCapability, appVersion: app.getVersion() }
  })

  ipcMain.handle(AgentIpcChannels.SANDBOX_PROBE, async () => {
    return probeSandboxDependencies()
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CLAUDE, async (_e, force?: boolean): Promise<ClaudeResources> => {
    const skills = discoverUserSkills()
    const userCommands = discoverUserCommands()
    const agents = discoverUserAgents()
    const cacheHit = getFreshHarnessResources('claude', { force })
    if (cacheHit) {
      log.info('[CONNECT_CLAUDE] cache fresh (ageMs=%d), skipping CLI query', cacheHit.ageMs)
      const resources: ClaudeResources = { ...cacheHit.resources, skills, commands: userCommands, agents }
      setCachedHarnessResources('claude', resources)
      return resources
    }

    // Harness gate — same resolver the spawn path uses, so "no runtime" means the
    // same thing everywhere: never enabled, still installing after an upgrade, or
    // explicitly disabled. Probing without a binary makes the SDK throw
    // *synchronously* out of query() — which is constructed outside the try
    // below, so it escapes as a raw IPC rejection. The renderer used to answer
    // that by retrying forever. An empty catalog is the honest answer:
    // disk-discovered skills / commands / agents are still valid, there is just
    // no model list without a runtime.
    const claudeBinary = tryResolveHarnessRuntime('claude')
    if (!claudeBinary) {
      log.info('[CONNECT_CLAUDE] no runtime available — skipping CLI probe (harness not installed or disabled)')
      // Deliberately not cached: the harness may be installed or re-enabled at any moment.
      return { models: [], account: {}, slashCommands: [], skills, commands: userCommands, agents, outputStyles: [] }
    }

    const probeCwd = resolveProbeCwd()
    log.info('[CONNECT_CLAUDE] cwd:', probeCwd)
    log.info('[CONNECT_CLAUDE] platform=%s arch=%s', process.platform, process.arch)
    const q = query({
      prompt: 'hi',
      options: { cwd: probeCwd, pathToClaudeCodeExecutable: claudeBinary, maxTurns: 0, permissionMode: 'default', persistSession: false },
    })
    try {
      log.info('[CONNECT_CLAUDE] Fetching models, account, commands...')
      let terminalSlashCommands: string[] | undefined
      const drainResult = (async (): Promise<SDKResultMessage | null> => {
        for await (const msg of q) {
          const tagged = readTerminalSlashCommandsFromInitMessage(msg)
          if (tagged) terminalSlashCommands = tagged
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
      const slashCommands = markTerminalBoundSlashCommands(
        commands.map((c) => ({
          name: c.name,
          description: c.description,
          argumentHint: c.argumentHint,
          isSkill: false,
        })),
        terminalSlashCommands,
      )

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

  ipcMain.handle(AgentIpcChannels.CONNECT_OPENCODE, async (_e, force?: boolean) => {
    try {
      return await connectWithHarnessResourceCache('opencode', {
        force,
        isUsable: (r) => (r.models?.length ?? 0) > 0 || (r.agents?.length ?? 0) > 0,
        probe: () => probeOpenCodeResources({ cwd: resolveProbeCwd() }),
        fallbackToCacheOnError: true,
        onCacheHit: (hit) => {
          log.info('[CONNECT_OPENCODE] cache fresh (ageMs=%d), skipping probe', hit.ageMs)
        },
        onProbeError: (error) => {
          log.warn('[CONNECT_OPENCODE] failed: %s', error instanceof Error ? error.message : String(error))
        },
      })
    } catch {
      return { models: [], agents: [] }
    }
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CURSOR, async (_e, force?: boolean) => {
    const resources = await connectWithHarnessResourceCache('cursor', {
      force,
      isUsable: (r) => (r.models?.length ?? 0) > 0,
      probe: async () => {
        let config: unknown = {}
        try {
          config = getBaseProvider('cursor').config
        } catch {
          // base provider may not exist until migrations run
        }
        // Must decrypt vault secrets — plaintext resolve skips enc:v1: blobs and looks "unauthed".
        return probeCursorResources({
          config,
          resolveApiKey: resolveCursorApiKey,
        })
      },
      fallbackToCacheOnError: true,
      onCacheHit: (hit) => {
        log.info('[CONNECT_CURSOR] cache fresh (ageMs=%d), skipping probe', hit.ageMs)
      },
      onProbeError: (error) => {
        log.warn('[CONNECT_CURSOR] failed: %s', error instanceof Error ? error.message : String(error))
      },
    })
    log.info('[CONNECT_CURSOR] %d models', resources.models.length)
    let disabledModelIds: string[] = []
    try {
      disabledModelIds = readCursorConfig(getBaseProvider('cursor').config).disabledModelIds ?? []
    } catch {
      /* base provider may not exist yet */
    }
    return { ...resources, probing: false, disabledModelIds }
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_DEEPSEEK, async () => {
    // Live in-process catalog (integration plan D7): the embedded dsh tree is
    // the source of truth, so there is no disk cache to go stale — the boot
    // paid here is the same boot the first DeepSeek session needs anyway.
    try {
      const { getDeepseekRuntime, DEEPSEEK_DEFAULT_MODEL } = await import('./deepseek/deepseek-runtime-host')
      const { superoneEffortsFromDsh } = await import('@superone/deepseek/reasoning-effort')
      const runtime = await getDeepseekRuntime()
      const models = await runtime.listModels()
      log.info('[CONNECT_DEEPSEEK] %d models', models.length)
      return {
        models: models.map((model) => {
          // dsh's effort ids only partly overlap SuperOne's vocabulary, so the
          // picker is offered the intersection — an empty one collapses it to a
          // model-only list, which is exactly right for a `thinking: disabled`
          // deployment (it advertises `off` and nothing else).
          const supportedEffortLevels = superoneEffortsFromDsh(model.reasoningEfforts)
          return {
            id: model.id,
            name: model.name,
            description: model.provider,
            isDefault: model.id === DEEPSEEK_DEFAULT_MODEL,
            ...(supportedEffortLevels.length > 0
              ? { supportsEffort: true, supportedEffortLevels }
              : {}),
          }
        }),
        probing: false,
      }
    } catch (error) {
      log.warn('[CONNECT_DEEPSEEK] failed: %s', error instanceof Error ? error.message : String(error))
      return { models: [] }
    }
  })

  ipcMain.handle(AgentIpcChannels.DEEPSEEK_PRESETS, async (_event, sessionId?: string) => {
    // The roster re-reads its roots on every call, so a preset authored while
    // the app runs shows up without a restart.
    try {
      const { getDeepseekRuntime } = await import('./deepseek/deepseek-runtime-host')
      const { listDeepseekPresets } = await import('@superone/deepseek/presets')
      const runtime = await getDeepseekRuntime()
      const presets = await listDeepseekPresets(runtime.context)
      const current = sessionId ? runtime.sessionPreset(sessionId) ?? null : null
      // A session that has no live agent yet has produced nothing by
      // definition, so its pick is still a draft the next creation reads.
      const switchable = sessionId === undefined || current === null || runtime.sessionIsBlank(sessionId)
      return { presets, current, switchable }
    } catch (error) {
      log.warn('[DEEPSEEK_PRESETS] failed: %s', error instanceof Error ? error.message : String(error))
      return { presets: [], current: null, switchable: false }
    }
  })

  ipcMain.handle(AgentIpcChannels.DEEPSEEK_SET_PRESET, async (_event, sessionId: string, presetId: string) => {
    try {
      const { getDeepseekRuntime } = await import('./deepseek/deepseek-runtime-host')
      const runtime = await getDeepseekRuntime()
      await runtime.switchPreset(sessionId, presetId)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('[DEEPSEEK_SET_PRESET] %s → %s failed: %s', sessionId, presetId, message)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(
    AgentIpcChannels.DEEPSEEK_TRAJECTORY,
    async (_event, sessionId: string, cursor?: number) => {
      // The fold runs here, not in the renderer: a real session's log is mostly
      // `assistant/chunk` frames, and none of them survive the projection. It is
      // also held open across calls, so a streaming turn ships what changed
      // rather than the whole history on every poll.
      try {
        const { runtime, dshSessionId } = await deepseekTrajectorySource(sessionId)
        const read = await runtime.trajectory(dshSessionId, cursor)
        // A session that has never run a turn has no dsh log — that is a state,
        // not a failure, and the panel says so in its own words.
        if (read === null) return { ok: false, reason: 'absent' }
        return read.kind === 'full'
          ? { ok: true, kind: 'full', trajectory: read.trajectory }
          : { ok: true, kind: 'delta', delta: read.delta }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn('[DEEPSEEK_TRAJECTORY] %s failed: %s', sessionId, message)
        return { ok: false, reason: 'error', error: message }
      }
    },
  )

  ipcMain.handle(
    AgentIpcChannels.DEEPSEEK_TRAJECTORY_WATCH,
    async (event, sessionId: string, watching: boolean) => {
      await setTrajectoryWatch(event.sender, sessionId, watching)
      return { ok: true }
    },
  )

  ipcMain.handle(
    AgentIpcChannels.DEEPSEEK_TRAJECTORY_PAGE,
    async (_event, sessionId: string, before: number, count: number) => {
      try {
        const { runtime, dshSessionId } = await deepseekTrajectorySource(sessionId)
        const page = await runtime.trajectoryPage(dshSessionId, before, count)
        return page === null ? { ok: false, reason: 'absent' } : { ok: true, page }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn('[DEEPSEEK_TRAJECTORY_PAGE] %s failed: %s', sessionId, message)
        return { ok: false, reason: 'error', error: message }
      }
    },
  )

  ipcMain.handle(
    AgentIpcChannels.DEEPSEEK_TRAJECTORY_PAYLOAD,
    async (_event, sessionId: string, ref: TrajectoryPayloadRef) => {
      try {
        const { runtime, dshSessionId } = await deepseekTrajectorySource(sessionId)
        if (ref.kind === 'image') {
          const image = await runtime.trajectoryImage(ref.image)
          if (image === null) return { ok: false, reason: 'absent' }
          const base64 = Buffer.from(image.data).toString('base64')
          return { ok: true, kind: 'image', dataUrl: `data:${image.mediaType};base64,${base64}` }
        }
        const text = await runtime.trajectoryText(dshSessionId, ref.recordId, ref.field)
        return text === null ? { ok: false, reason: 'absent' } : { ok: true, kind: 'text', text }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn('[DEEPSEEK_TRAJECTORY_PAYLOAD] %s failed: %s', sessionId, message)
        return { ok: false, reason: 'error', error: message }
      }
    },
  )

  ipcMain.handle(AgentIpcChannels.GET_CURSOR_AUTH_STATUS, async () => {
    try {
      const config = getBaseProvider('cursor').config
      const configured = Boolean(resolveCursorApiKey(config))
      const cached = getCachedHarnessResources('cursor')
      return {
        configured,
        apiKeyName: cached?.user?.apiKeyName ?? null,
        userEmail: cached?.user?.userEmail ?? null,
      }
    } catch {
      return { configured: false, apiKeyName: null, userEmail: null }
    }
  })

  ipcMain.handle(AgentIpcChannels.SET_CURSOR_API_KEY, async (_e, apiKey: string) => {
    const plain = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (!plain) throw new Error('API key is empty')
    const existing = (() => {
      try {
        return readCursorConfig(getBaseProvider('cursor').config)
      } catch {
        return {}
      }
    })()
    const provider = updateBaseProviderConfig('cursor', {
      ...existing,
      apiKey: encryptCursorApiKey(plain),
    })
    // Live sessions keep a snapshot of providerConfig from create time; refresh so the
    // next send picks up the newly saved key instead of the empty pre-auth config.
    sessionManager.markAllNeedsRebuild('cursor')
    try {
      const { probeDesktopHarness } = await import('./harness/service')
      probeDesktopHarness('cursor')
    } catch (error) {
      log.warn('[SET_CURSOR_API_KEY] probe failed: %s', error instanceof Error ? error.message : String(error))
    }
    return { ok: true as const, providerId: provider.id }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_UPDATE_BASE_CONFIG, async (_e, patch: Record<string, unknown>) => {
    const existing = (() => {
      try {
        return readCursorConfig(getBaseProvider('cursor').config)
      } catch {
        return {}
      }
    })()
    const patchParams = readCursorConfig({ modelParamsByModel: patch.modelParamsByModel }).modelParamsByModel
    const next = {
      ...existing,
      ...patch,
      // Deep-merge per-model params so one model update does not wipe others.
      modelParamsByModel: {
        ...(existing.modelParamsByModel ?? {}),
        ...(patchParams ?? {}),
      },
      // Replace (do not union) the disabled-model list when the patch includes it.
      disabledModelIds: Object.prototype.hasOwnProperty.call(patch, 'disabledModelIds')
        ? (readCursorConfig({ disabledModelIds: patch.disabledModelIds }).disabledModelIds ?? [])
        : existing.disabledModelIds,
    }
    if (typeof patch.apiKey === 'string' && patch.apiKey && !String(patch.apiKey).startsWith('enc:')) {
      next.apiKey = encryptCursorApiKey(String(patch.apiKey))
    }
    const provider = updateBaseProviderConfig('cursor', next)
    sessionManager.markAllNeedsRebuild('cursor')
    return { ok: true as const, config: readCursorConfig(provider.config) }
  })

  ipcMain.handle(AgentIpcChannels.GET_CURSOR_BASE_CONFIG, async () => {
    try {
      return readCursorConfig(getBaseProvider('cursor').config)
    } catch {
      return {}
    }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_LIST_SLASH_ITEMS, async (_e, projectPath: string) => {
    if (typeof projectPath !== 'string' || !projectPath || parseRemoteProjectKey(projectPath)) return []
    if (!isAbsolute(projectPath)) return []
    const knownProjects = getRecentFolders().map((f) => f.path)
    if (knownProjects.length > 0 && !isPathAtOrWithinAllowed(projectPath, knownProjects)) return []
    const { discoverCursorSkillsAndCommands } = await import('@superone/cursor')
    return discoverCursorSkillsAndCommands(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_LIST_AGENTS, async (_e, opts?: {
    runtime?: 'local' | 'cloud'
    cwd?: string
    limit?: number
    cursor?: string
    includeArchived?: boolean
  }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    if (opts?.runtime === 'local') {
      return listCursorLocalAgents({ cwd: opts.cwd ?? resolveProbeCwd(), limit: opts.limit, cursor: opts.cursor })
    }
    return listCursorCloudAgents({
      config,
      limit: opts?.limit,
      cursor: opts?.cursor,
      includeArchived: opts?.includeArchived,
    })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_LIST_RUNS, async (_e, agentId: string, opts?: {
    runtime?: 'local' | 'cloud'
    cwd?: string
    limit?: number
    cursor?: string
  }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    return listCursorRuns(agentId, { config, ...opts })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_ARCHIVE_AGENT, async (_e, agentId: string) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    await archiveCursorAgent(agentId, { config })
    return { ok: true as const }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_UNARCHIVE_AGENT, async (_e, agentId: string) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    await unarchiveCursorAgent(agentId, { config })
    return { ok: true as const }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_DELETE_AGENT, async (_e, agentId: string) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    await deleteCursorAgent(agentId, { config })
    return { ok: true as const }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_LIST_ARTIFACTS, async (_e, agentId: string, opts?: { cwd?: string; model?: string }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    return listCursorArtifacts(agentId, { config, cwd: opts?.cwd, model: opts?.model })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_DOWNLOAD_ARTIFACT, async (_e, agentId: string, path: string, opts?: { cwd?: string; model?: string }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    const buf = await downloadCursorArtifact(agentId, path, { config, cwd: opts?.cwd, model: opts?.model })
    return { path, base64: buf.toString('base64'), size: buf.length }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_LIST_REPOSITORIES, async () => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    return listCursorRepositories({ config })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_GET_AGENT, async (_e, agentId: string, opts?: { cwd?: string }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    return getCursorAgent(agentId, { config, cwd: opts?.cwd ?? resolveProbeCwd() })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_LIST_MESSAGES, async (_e, agentId: string, opts?: {
    cwd?: string
    limit?: number
    offset?: number
  }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    return listCursorAgentMessages(agentId, {
      config,
      cwd: opts?.cwd ?? resolveProbeCwd(),
      limit: opts?.limit,
      offset: opts?.offset,
    })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_GET_RUN, async (_e, runId: string, opts?: {
    agentId?: string
    cwd?: string
    runtime?: 'local' | 'cloud'
  }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    return getCursorRun(runId, {
      config,
      agentId: opts?.agentId,
      cwd: opts?.cwd ?? resolveProbeCwd(),
      runtime: opts?.runtime,
    })
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_CANCEL_RUN, async (_e, runId: string, opts?: {
    agentId?: string
    cwd?: string
    runtime?: 'local' | 'cloud'
  }) => {
    let config: unknown = {}
    try { config = getBaseProvider('cursor').config } catch { /* */ }
    await cancelCursorRun(runId, {
      config,
      agentId: opts?.agentId,
      cwd: opts?.cwd ?? resolveProbeCwd(),
      runtime: opts?.runtime,
    })
    return { ok: true as const }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_FORCE_RECOVER, async (_e, sessionId: string, message?: string) => {
    const session = sessionManager.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.snapshot.harnessId !== 'cursor') {
      throw new Error('Force recover is only available for Cursor local sessions')
    }
    // bc-* provider session ids are cloud agents — local.force is not applied.
    const providerSessionId = session.snapshot.providerSessionId
    if (typeof providerSessionId === 'string' && providerSessionId.startsWith('bc-')) {
      throw new Error(
        'Force recover is only available for Cursor local agents. Cloud runs use interrupt/cancel instead.',
      )
    }
    if (typeof session.forceRecoverRun !== 'function') {
      throw new Error('Force recover is not supported on this session')
    }
    await session.forceRecoverRun(message)
    return { ok: true as const }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_SDK_LOGIN, async () => {
    const { cursorSdkLogin } = await import('@superone/cursor')
    const result = await cursorSdkLogin({
      openBrowser: (url) => { void shell.openExternal(url) },
      apiKeyName: 'SuperOne',
    })
    // Mirror minted key into SuperOne vault (same path as paste-key).
    const existing = (() => {
      try {
        return readCursorConfig(getBaseProvider('cursor').config)
      } catch {
        return {}
      }
    })()
    updateBaseProviderConfig('cursor', {
      ...existing,
      apiKey: encryptCursorApiKey(result.apiKey),
    })
    sessionManager.markAllNeedsRebuild('cursor')
    try {
      const { probeDesktopHarness } = await import('./harness/service')
      probeDesktopHarness('cursor')
    } catch (error) {
      log.warn('[CURSOR_SDK_LOGIN] probe failed: %s', error instanceof Error ? error.message : String(error))
    }
    return {
      ok: true as const,
      email: result.email ?? null,
      apiKeyExpiresAtMs: result.apiKeyExpiresAtMs,
    }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_SDK_LOGOUT, async () => {
    const { cursorSdkLogout } = await import('@superone/cursor')
    await cursorSdkLogout()
    return { ok: true as const }
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_SDK_AUTH_STATUS, async () => {
    const { cursorSdkAuthStatus } = await import('@superone/cursor')
    return cursorSdkAuthStatus()
  })

  ipcMain.handle(AgentIpcChannels.CURSOR_GET_USAGE, async (_e, agentId: string, opts?: { runId?: string }) => {
    if (!agentId?.trim()) throw new Error('agentId required')
    const { getCursorAgentUsage } = await import('./cursor/cursor-cloud')
    const config = (() => {
      try {
        return getBaseProvider('cursor').config
      } catch {
        return {}
      }
    })()
    return getCursorAgentUsage(agentId.trim(), { config, runId: opts?.runId })
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
  setSessionCollaborationCallbacks({
    sessionsChanged: () => safeSend(AgentIpcChannels.SESSIONS_CHANGED),
  })
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
    const manifest = await readManifest(basePath)
    if (!manifest) throw new Error(`App not found: ${appId}`)
    const pluginEntry = validatePath(basePath, manifest.main)
    if (!pluginEntry) throw new Error(`Invalid plugin entry: ${manifest.main}`)
    const storagePaths = await resolveMiniAppStoragePaths(projectDir, appId)
    startMiniAppHost({ appId, projectDir, name: manifest.name, appPath: basePath, entryPath: pluginEntry, background: manifest.background === true, ...storagePaths })
    const projectAppKey = `${projectDir}::${appId}`
    let sessions = miniAppSessionRefs.get(projectAppKey)
    if (!sessions) {
      sessions = new Set()
      miniAppSessionRefs.set(projectAppKey, sessions)
    }
    const isFirstSessionForApp = sessions.size === 0
    sessions.add(sessionId)
    if (isFirstSessionForApp) {
      setAppMediaPermissions(appId, manifest)
      registerAppTemplates(projectDir, appId, manifest.templates)
    }
    registerAppTools(sessionId, projectDir, appId, manifest.tools ?? [])
    loadPreapprovedTools(appId, basePath)
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
      const manifest = await readManifest(basePath)
      if (!manifest) {
        log.warn('[MINIAPP_AUTHORIZE] no manifest for appId=%s basePath=%s', appId, basePath)
        continue
      }
      const pluginEntry = validatePath(basePath, manifest.main)
      if (!pluginEntry) {
        log.warn('[MINIAPP_AUTHORIZE] invalid plugin entry for appId=%s main=%s', appId, manifest.main)
        continue
      }
      const storagePaths = await resolveMiniAppStoragePaths(projectDir, appId)
      startMiniAppHost({ appId, projectDir, name: manifest.name, appPath: basePath, entryPath: pluginEntry, background: manifest.background === true, ...storagePaths })
      registerAppTemplates(projectDir, appId, manifest.templates)
      registerAppTools(sessionId, projectDir, appId, manifest.tools ?? [])
      loadPreapprovedTools(appId, basePath)
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
    // Tools and data services stay registered for the owning session, so the
    // host is only released once no session holds this app open — and even then
    // only if it did not declare `background`, in which case it keeps running.
    const projectAppKey = `${projectDir}::${appId}`
    const sessions = miniAppSessionRefs.get(projectAppKey)
    if (sessions) {
      sessions.delete(sessionId)
      if (sessions.size === 0) {
        miniAppSessionRefs.delete(projectAppKey)
        releaseMiniAppHost(projectDir, appId)
      }
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

  ipcMain.handle(AgentIpcChannels.MINIAPP_GET_PRELOAD_PATH, () => {
    return join(__dirname, '../preload/miniapp-preload.js')
  })

  ipcMain.on(AgentIpcChannels.MINIAPP_HOST_POST_MESSAGE, (_e, message: { projectDir: string; appId: string; payload: unknown }) => {
    if (!message || typeof message.projectDir !== 'string' || typeof message.appId !== 'string') return
    postMiniAppWebviewMessage(message.projectDir, message.appId, message.payload)
  })

  ipcMain.on(AgentIpcChannels.MINIAPP_HOST_ACTION_RESULT, (_e, message: { requestId: string; result?: unknown; error?: string }) => {
    if (!message || typeof message.requestId !== 'string') return
    settleMiniAppHostAction(message.requestId, message.result, message.error)
  })

  ipcMain.on(AgentIpcChannels.MINIAPP_CONTEXT_CONSUMED, (_e, appIds: string[]) => {
    if (!Array.isArray(appIds)) return
    for (const appId of appIds) {
      if (typeof appId === 'string') notifyMiniAppContextConsumed(appId)
    }
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_HOST_LIST, () => listMiniAppHosts())
  ipcMain.handle(AgentIpcChannels.MINIAPP_HOST_STOP, (_e, projectDir: string, appId: string) => {
    stopMiniAppHost(projectDir, appId)
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
    stopMiniAppHostsByAppId(appId)
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
    const created = dbCreateAutomation(projectPath, data)
    notifyAutomationsListChanged(projectPath)
    return created
  })

  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_UPDATE, (_e, id: string, data: UpdateAutomationRequest) => {
    const updated = dbUpdateAutomation(id, data)
    if (updated) notifyAutomationsListChanged(updated.projectPath)
    return updated
  })

  ipcMain.handle(AgentIpcChannels.AUTOMATIONS_DELETE, (_e, id: string) => {
    const existing = dbGetAutomation(id)
    const ok = dbDeleteAutomation(id)
    if (ok) notifyAutomationsListChanged(existing?.projectPath)
    return ok
  })

  ipcMain.handle(AgentIpcChannels.SCHEDULED_SEND_GET, (_e, sessionId: string) =>
    scheduledSendService.get(sessionId))

  ipcMain.handle(AgentIpcChannels.SCHEDULED_SEND_LIST, () => scheduledSendService.list())

  ipcMain.handle(
    AgentIpcChannels.SCHEDULED_SEND_SET,
    (_e, sessionId: string, patch: ScheduledSendPatch, init?: ScheduledSendSessionInit) =>
      scheduledSendService.set(sessionId, patch, init),
  )

  ipcMain.handle(AgentIpcChannels.SCHEDULED_SEND_CLEAR, (_e, sessionId: string) => {
    scheduledSendService.clear(sessionId)
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
    applyWindowAppearance()
    broadcastTheme()
  })
  registerBrowserPopupRedirect()
  registerBrowserDownloadCapture()

  if (process.platform === 'darwin') {
    if (is.dev) {
      // Dev keeps its repo-local helper warm; permission prompts remain explicit.
      void startComputerUseHelper({ requestPermissions: false })
    } else {
      // Installation does not launch or request permissions. The nested signed
      // bundle is only a source because TCC attributes nested apps to SuperOne.
      try {
        prepareComputerUseHelper()
      } catch (err) {
        log.warn(
          '[computer-use] failed to prepare release helper: %s',
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  }

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
  // Built-in browser webviews use partition "persist:browser"; register the same
  // local-file handler so HTML/CSS/asset previews work there (not only in the
  // main renderer session used by in-app iframes).
  registerMiniAppProtocolHandlers(session.fromPartition('persist:browser').protocol)

  fixPath()
  startMediaServer().catch((err) => log.error('[media-server] failed to start:', err))
  ipcMain.handle(AgentIpcChannels.MEDIA_SERVER_PORT, () => getMediaServerPort())

  // Warm environment host so desired remotes auto-connect without waiting for Settings.
  void import('./environment')
    .then(({ getEnvironmentHost }) => {
      const host = getEnvironmentHost()
      attachEnvironmentStatusBridge(host)
    })
    .catch((err) => {
      log.warn(
        '[environment] startup auto-connect init failed: %s',
        err instanceof Error ? err.message : String(err),
      )
    })
  try {
    getDb()
  } catch (err) {
    log.error(
      '[startup] database init failed: %s',
      err instanceof Error ? err.message : String(err),
    )
  }
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
  screen.on('display-added', pushComputerUseDisplaysChanged)
  screen.on('display-removed', pushComputerUseDisplaysChanged)
  screen.on('display-metrics-changed', pushComputerUseDisplaysChanged)
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

  app.on('child-process-gone', (_e, details) => {
    log.error(
      '[startup] child-process-gone type=%s reason=%s exitCode=%s service=%s',
      details.type,
      details.reason,
      details.exitCode,
      details.serviceName ?? '',
    )
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
            if (getUpdaterState() === 'harness-error') {
              retryUpdateHarnessPrefetch()
              return
            }
            if (getUpdaterState() === 'available') {
              downloadUpdate()
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
  rendererAgentEventTransport.dispose()
  destroyComputerUsePermissionFloat()
  if (terminalSweepTimer) clearInterval(terminalSweepTimer)
  stopComputerUseHelper()
  closeDevicePorts()
  shutdownAllProxies()
  terminalManager.killAll()
  remoteTerminalController.dispose()
  automationService.stop()
  scheduledSendService.stop()
  stopAllMiniAppHosts()
  stopWatching()
  stopSuperoneMcpStdioBridge()
  const remoteStop = Promise.race([
    remoteControlService.stop(),
    new Promise<void>((r) => setTimeout(r, 1500)),
  ]).catch(() => {})
  Promise.allSettled([
    remoteStop,
    disposeIosSimulatorManager(),
    // Shuts down only emulators SuperOne started. Without this they survive the app
    // as headless orphans — no window to find them by, and the next launch fights
    // them for the adb port.
    disposeAndroidDeviceManager(),
    disposeMirrorDeviceManager(),
    disposeAgentSessions(),
    closeAllOpenCodeServers(),
    // Unwinds the embedded dsh Cordis tree so JSONL persistence flushes;
    // resolves immediately when no DeepSeek session ever booted it. The
    // trajectory watches hold a listener on that runtime, so they go first.
    Promise.resolve(clearTrajectoryWatches())
      .then(() => import('./deepseek/deepseek-runtime-host'))
      .then((host) => host.disposeDeepseekRuntime()),
  ]).finally(() => {
    codexService.dispose()
    disposeGlobalWarmupManager()
    closeAllMiniAppState()
    closeDb()
    closeTraceDb()
    setTimeout(() => app.quit(), 500)
  })
}

let signalQuitting = false
const handleSignalQuit = (sig: NodeJS.Signals): void => {
  if (signalQuitting) return
  signalQuitting = true
  rendererAgentEventTransport.dispose()
  destroyComputerUsePermissionFloat()
  log.info(`[main] received ${sig}, shutting down`)
  if (terminalSweepTimer) clearInterval(terminalSweepTimer)
  stopComputerUseHelper()
  closeDevicePorts()
  terminalManager.killAll()
  remoteTerminalController.dispose()
  closeAllMiniAppState()
  Promise.allSettled([
    remoteControlService.stop(),
    disposeIosSimulatorManager(),
    // Shuts down only emulators SuperOne started. Without this they survive the app
    // as headless orphans — no window to find them by, and the next launch fights
    // them for the adb port.
    disposeAndroidDeviceManager(),
    disposeMirrorDeviceManager(),
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

  // Restart-to-update already confirmed the quit. Don't block Squirrel.Mac
  // behind the "running sessions" dialog — that looks like a hung Restart.
  if (isInstallingUpdate() || (!agentService.hasRunningSessions() && !hasActiveMiniAppHosts())) {
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
