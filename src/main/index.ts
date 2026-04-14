import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, powerMonitor, protocol, shell } from 'electron'
import { join, dirname, basename, resolve, extname, relative, isAbsolute, sep } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, readdir, rename, cp, rm, access, stat, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { resolveRealPath, isPathWithinAllowed, sanitizeGitRef } from './path-security'
import { execFileSync, spawn } from 'child_process'
import { gitRun } from './git-run'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { startMediaServer, getMediaServerPort } from './media-server'
import { getAppBasePath, cacheAppBasePath, generateCSP, readManifest, validatePath, discoverApps, setAllowedDirectories, clearAllowedDirectories, handleFsRequest, handleGitRequest, discoverProjectApps, detectStandaloneApp, startWatch, stopWatch, onFsWatchEvent, onGitHeadChangeEvent, getAllowedDirs, resolveSafePathMulti } from './miniapp/miniapp-service'
import { generateBridgeScript, generatePopoverBridgeScript } from './miniapp/miniapp-bridge'
import { previewApp, confirmInstall, cancelInstall, uninstallApp, packApp, getInstallMeta, getPreapproved, getPreapprovedByPath, setPreapproved, setPreapprovedByPath } from './miniapp/miniapp-packager'
import { initSuperoneMcpServer, registerAppTools, unregisterAppTools, resolveToolCall, rejectToolCall, notifyAppReady as notifyMiniAppReady, registerInChatApp, loadPreapprovedTools, updatePreapprovedTools } from './mcp/superone-mcp-server'
import { startMcpHttpServer, stopMcpHttpServer } from './mcp/superone-mcp-http'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { fixPath, getNodeRuntime, resolveSdkCli } from './agent/resolve-cli'
import { AgentService } from './agent/agent-service'
import {
  AgentIpcChannels,
  type CodexCollaborationMode,
  type CodexPermissionPreset,
  type CodexReasoningEffort,
  type CodexReviewTarget,
  type AgentEvent,
  type CodexThreadItem,
  type CodexUsageInfo,
  type CodexSetAuthRequest,
  type PermissionRequest,
  type AskUserQuestionRequest,
  type ImageAttachment,
  type ConnectResult,
  type StartupData,
  type FileTreeEntry,
  type GitFileStatus,
  type FileOpResult,
} from '../shared/agent-types'
import { initUpdater, installUpdate, checkForUpdates, simulateUpdate, simulateNotAvailable, getUpdaterState, getUpdateMenuState, setOnMenuChange, disposeUpdater } from './updater'
import { startWatching, stopWatching } from './file-watcher'
import { notifyWidgetReady } from './generative-ui/widget-gate'
import { setBashOutputWindow, watchBashOutput, unwatchBashOutput, unwatchAll as unwatchAllBashOutputs, readBashOutputTail, getWatchedFilePath } from './bash-output-watcher'
import { parseGitStatusOutput, parseGitStatusFiles } from './git-status-utils'
import { mapModelInfo } from './agent/claude-models'
import { getRecentFolders, addRecentFolder, removeRecentFolder } from './recent-folders'
import { getDb, closeDb, getCachedResources, setCachedResources, upsertPairedDevice, listPairedDevices, deletePairedDevice, isPairedDevice } from './database'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'
import { AutomationService } from './automation-service'
import { listAutomationsForProject, createAutomation as dbCreateAutomation, updateAutomation as dbUpdateAutomation, deleteAutomation as dbDeleteAutomation } from './db-automations'
import { trace, closeTraceDb } from './agent/event-trace'
import { RemoteControlService } from './remote-control-service'
import { readUserPreferences, saveUserPreferences, readProjectPreferences, saveProjectPreferences } from './claude-preferences-service'
import type { RemoteCommand, PairedDevice, CreateAutomationRequest, UpdateAutomationRequest } from '../shared/agent-types'
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
const automationService = new AutomationService()
const remoteCallbacks: RemoteControlCallbacks = {
  onCommand: async (command, respond) => {
    await agentService.handleRemoteCommand(command, respond)
    safeSend(AgentIpcChannels.REMOTE_COMMAND, command)
    if (command.type === 'add_project') {
      const folders = getRecentFolders()
      safeSend('app:recent-folders-changed', folders)
    }
  },
  onClientRegistered: ({ deviceName, deviceId }) => {
    upsertPairedDevice(deviceId, deviceName)
    safeSend(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: deviceId, online: true })
  },
  onClientDisconnected: ({ deviceId }) => {
    safeSend(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: deviceId, online: false })
  },
  onSessionUnsubscribed: (session) => {
    safeSend(AgentIpcChannels.EVENT, { type: 'remote_session_end', remoteProjectPath: session.projectPath, remoteSessionId: session.sessionId })
  },
  onRemoteFilterCleared: (filter) => {
    agentService.transferRemoteToLocal(filter.projectPath, filter.sessionId)
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

function emitAgentEvent(event: AgentEvent): void {
  agentService.recordCodexEvent(event)
  agentService.notifyEventSubscribers(event)
  safeSend(AgentIpcChannels.EVENT, event)
}

const activeCodexEventTargets = new Map<string, {
  setMessageId: (messageId?: string) => void
  getMessageId: () => string | undefined
  projectPath: string
  dispose: () => void
}>()

function createCodexCallbacks(messageId: string | undefined, sessionId: string, projectPath: string) {
  let currentMessageId = messageId
  const route = {
    setMessageId: (nextMessageId?: string) => {
      currentMessageId = nextMessageId
    },
    getMessageId: () => currentMessageId,
    projectPath,
    dispose: () => {
      if (activeCodexEventTargets.get(sessionId) === route) {
        activeCodexEventTargets.delete(sessionId)
      }
    },
  }
  activeCodexEventTargets.set(sessionId, route)

  if (!messageId) return { callbacks: undefined, route }
  return {
    callbacks: {
      onThreadStarted: (resolvedThreadId: string) => {
        if (!currentMessageId) return
        emitAgentEvent({ type: 'codex_thread_started', messageId: currentMessageId, threadId: resolvedThreadId, projectPath, sessionId })
      },
      onItemDelta: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => {
        if (!currentMessageId) return
        if (is.dev) {
          const collabTrace = item.type === 'collab_tool_call'
            ? {
                collabTool: item.tool,
                collabStatus: item.status,
                agentIds: Object.keys(item.agentsStates),
                agentStatuses: Object.fromEntries(Object.entries(item.agentsStates).map(([k, v]) => [k, v.status])),
                receiverThreadIds: item.receiverThreadIds,
                childThreadCount: item.childItems ? Object.keys(item.childItems).length : 0,
                childItemCounts: item.childItems
                  ? Object.fromEntries(Object.entries(item.childItems).map(([k, v]) => [k, v.length]))
                  : undefined,
                prompt: item.prompt?.slice(0, 200),
              }
            : {}
          trace('codex.emit', 'codex_item_delta', {
            messageId: currentMessageId,
            phase,
            itemId: item.id,
            itemType: item.type,
            textLength: 'text' in item && typeof item.text === 'string' ? item.text.length : undefined,
            textPreview: 'text' in item && typeof item.text === 'string' ? item.text.slice(0, 160) : undefined,
            ...collabTrace,
          }, currentMessageId)
        }
        emitAgentEvent({ type: 'codex_item_delta', messageId: currentMessageId, phase, item, projectPath, sessionId })
      },
      onUsageDelta: (usage: CodexUsageInfo) => {
        if (!currentMessageId) return
        if (is.dev) {
          trace('codex.emit', 'message_usage', {
            messageId: currentMessageId,
            totalInputTokens: usage.totalInputTokens,
            totalCachedInputTokens: usage.totalCachedInputTokens,
            totalOutputTokens: usage.totalOutputTokens,
            lastInputTokens: usage.lastInputTokens,
            lastCachedInputTokens: usage.lastCachedInputTokens,
            lastOutputTokens: usage.lastOutputTokens,
            reasoningOutputTokens: usage.reasoningOutputTokens,
            contextWindow: usage.contextWindow,
          }, currentMessageId)
        }
        emitAgentEvent({
          type: 'message_usage',
          messageId: currentMessageId,
          inputTokens: usage.lastInputTokens,
          outputTokens: usage.lastOutputTokens,
          codexUsage: usage,
          projectPath,
          sessionId,
        })
      },
      onPermissionRequest: (request: PermissionRequest) => {
        emitAgentEvent({ type: 'permission_request', request, projectPath, sessionId })
      },
      onAskUserQuestion: (request: AskUserQuestionRequest) => {
        emitAgentEvent({ type: 'ask_user_question', request, projectPath, sessionId })
      },
    },
    route,
  }
}

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
        mainWindow?.webContents.send('app:content-zoom', action)
      }
    }
  })

  // Update agentService's window reference for event forwarding
  agentService.setMainWindow(mainWindow)
  automationService.setMainWindow(mainWindow)
  automationService.setAgentService(agentService)
  automationService.start()
  setBashOutputWindow(mainWindow)

  mainWindow.on('closed', () => {
    unwatchAllBashOutputs()
  })

  // Fullscreen state (window-specific, re-binds per window)
  mainWindow.on('enter-full-screen', () => {
    safeSend('fullscreen-changed', true)
  })
  mainWindow.on('leave-full-screen', () => {
    safeSend('fullscreen-changed', false)
  })

  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Register all IPC handlers once at app startup. */
function setAppFsPermissions(appId: string, manifest: { permissions?: { fs?: Array<{ scope: string; path?: string; access?: string; reason: string }> } }, projectDir: string, basePath: string): void {
  const fsEntries = manifest.permissions?.fs ?? []
  if (fsEntries.length === 0) return
  const dirs = fsEntries.flatMap((entry) => {
    switch (entry.scope) {
      case 'project': return [{ path: join(projectDir, entry.path!), access: entry.access as 'read' | 'readwrite' } as const]
      case 'user': return [{ path: join(homedir(), entry.path!), access: entry.access as 'read' | 'readwrite' } as const]
      case 'app': return [{ path: join(basePath, 'data'), access: 'readwrite' as const }]
      default: return []
    }
  })
  setAllowedDirectories(appId, dirs)
}

function registerIpcHandlers(): void {
  // Setup agent IPC handlers (does NOT auto-initialize)
  agentService.setCodexListModels((projectPath) => codexService.listModels(projectPath))
  agentService.setCodexGetAuthStatus((projectPath) => codexService.getAuthStatus(projectPath))
  agentService.setCodexRun(async (sessionId, projectPath, opts) => {
    const messageId = opts.messageId ?? `remote-${Date.now()}`
    const { callbacks, route } = createCodexCallbacks(messageId, sessionId, projectPath)
    try {
      return await codexService.run(sessionId, projectPath, { ...opts, messageId } as Parameters<typeof codexService.run>[2], callbacks)
    } finally {
      route.dispose()
    }
  })
  agentService.setup()

  ipcMain.on('app:trace', (_e, source: string, type: string, data: unknown, tag?: string) => {
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
      execFileSync('git', ['init'], { cwd: folderPath })
    }
    addRecentFolder(folderPath)
    await agentService.openFolder(folderPath)
    return true
  })

  ipcMain.handle(AgentIpcChannels.OPEN_TMP_FOLDER, async () => {
    const tmpPath = join(app.getPath('userData'), 'tmp')
    if (!existsSync(tmpPath)) mkdirSync(tmpPath, { recursive: true })
    await agentService.openFolder(tmpPath) // Additive
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
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      const persistedUserMessageId = userMessageId ?? `user_${Date.now()}`
      agentService.beginCodexTurn(projectPath, sessionId, {
        userMessageId: persistedUserMessageId,
        userText: userMessageText ?? prompt,
        assistantMessageId,
        providerId: 'local',
        images,
        gitBranch: gitBranch ?? null,
        worktreePath: worktreePath ?? null,
        cwd,
      })
      const { callbacks, route } = createCodexCallbacks(assistantMessageId, sessionId, projectPath)
      const runStart = Date.now()
      try {
        const result = await codexService.run(
          sessionId,
          projectPath,
          { prompt, model, reasoningEffort, permissionPreset, collaborationMode, threadId, messageId: assistantMessageId, images, cwd },
          callbacks,
        )
        agentService.completeCodexTurn(sessionId, {
          messageId: route.getMessageId() ?? assistantMessageId,
          result,
          durationMs: Date.now() - runStart,
          fallbackText: 'Codex completed without returning text.',
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        agentService.failCodexTurn(sessionId, {
          messageId: route.getMessageId() ?? assistantMessageId,
          status: /interrupt|abort/i.test(message) ? 'interrupted' : 'error',
          text: /interrupt|abort/i.test(message) ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
        })
        throw error
      } finally {
        route.dispose()
      }
    },
  )

  ipcMain.handle(AgentIpcChannels.CODEX_LIST_MODELS, async (_event, projectPath: string) => {
    const models = await codexService.listModels(projectPath)
    const currentCached = getCachedResources()
    setCachedResources(
      currentCached?.models ?? [],
      models,
      currentCached?.account ?? {},
      currentCached?.slashCommands ?? [],
    )
    log.debug('[CODEX_LIST_MODELS] project=%s models=%s', projectPath, JSON.stringify(models))
    return models
  })

  ipcMain.handle(AgentIpcChannels.CODEX_RESET, (_event, sessionId: string) => {
    codexService.reset(sessionId)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_INTERRUPT, (_event, sessionId: string) => {
    return codexService.interrupt(sessionId)
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_PERMISSION_RESPONSE,
    (_event, sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, decision?: 'cancel') => {
      return codexService.respondToPermission(sessionId, requestId, allow, alwaysAllow, reason, decision)
    },
  )

  ipcMain.handle(
    AgentIpcChannels.CODEX_ANSWER_QUESTION,
    (_event, sessionId: string, requestId: string, answers: Record<string, string>) => {
      return codexService.respondToQuestion(sessionId, requestId, answers)
    },
  )

  ipcMain.handle(
    AgentIpcChannels.CODEX_DISMISS_QUESTION,
    (_event, sessionId: string, requestId: string) => {
      return codexService.dismissQuestion(sessionId, requestId)
    },
  )

  ipcMain.handle(AgentIpcChannels.CODEX_GET_AUTH_STATUS, (_event, projectPath: string) => {
    return codexService.getAuthStatus(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_SET_AUTH, (_event, projectPath: string, request: CodexSetAuthRequest) => {
    return codexService.setAuth(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_PLAN_APPROVAL, (_event, projectPath: string, sessionId: string, messageId: string, status: 'approved' | 'rejected', feedback?: string) => {
    agentService.updateCodexPlanApproval(sessionId, messageId, { status, ...(feedback ? { feedback } : {}) })
    emitAgentEvent({ type: 'codex_plan_approval', messageId, status, ...(feedback ? { feedback } : {}), projectPath, sessionId } as AgentEvent)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_COLLABORATION_MODE_CHANGE, (_event, projectPath: string, sessionId: string, mode: string) => {
    emitAgentEvent({ type: 'codex_collaboration_mode_change', mode, projectPath, sessionId } as AgentEvent)
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_STEER,
    (_event, sessionId: string, input: string, messageId?: string, userMessageId?: string, userMessageText?: string, gitBranch?: string, worktreePath?: string) => {
      const route = activeCodexEventTargets.get(sessionId)
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      if (route) {
        agentService.beginCodexTurn(route.projectPath, sessionId, {
          userMessageId: userMessageId ?? `user_${Date.now()}`,
          userText: userMessageText ?? input,
          assistantMessageId,
          providerId: 'local',
          gitBranch: gitBranch ?? null,
          worktreePath: worktreePath ?? null,
        })
        route.setMessageId(assistantMessageId)
      }
      return codexService.steer(sessionId, input).catch((error) => {
        agentService.rollbackCodexAssistantMessage(sessionId, assistantMessageId)
        throw error
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
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      agentService.beginCodexTurn(projectPath, sessionId, {
        userMessageId: userMessageId ?? `user_${Date.now()}`,
        userText: userMessageText ?? '/review',
        assistantMessageId,
        providerId: 'local',
        gitBranch: gitBranch ?? null,
        worktreePath: worktreePath ?? null,
        cwd,
      })
      const { callbacks, route } = createCodexCallbacks(assistantMessageId, sessionId, projectPath)
      const runStart = Date.now()
      try {
        const result = await codexService.review(
          sessionId,
          projectPath,
          { target, model, reasoningEffort, permissionPreset, threadId, messageId: assistantMessageId, cwd },
          callbacks,
        )
        agentService.completeCodexTurn(sessionId, {
          messageId: route.getMessageId() ?? assistantMessageId,
          result,
          durationMs: Date.now() - runStart,
          fallbackText: 'Codex completed without returning text.',
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        agentService.failCodexTurn(sessionId, {
          messageId: route.getMessageId() ?? assistantMessageId,
          status: /interrupt|abort/i.test(message) ? 'interrupted' : 'error',
          text: /interrupt|abort/i.test(message) ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
        })
        throw error
      } finally {
        route.dispose()
      }
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
    ) => {
      const assistantMessageId = messageId ?? `codex_${Date.now()}`
      agentService.beginCodexTurn(projectPath, sessionId, {
        userMessageId: userMessageId ?? `user_${Date.now()}`,
        userText: userMessageText ?? '/compact',
        assistantMessageId,
        providerId: 'local',
        gitBranch: gitBranch ?? null,
        worktreePath: worktreePath ?? null,
        cwd,
      })
      const { callbacks, route } = createCodexCallbacks(assistantMessageId, sessionId, projectPath)
      const runStart = Date.now()
      try {
        const result = await codexService.compact(
          sessionId,
          projectPath,
          { model, permissionPreset, threadId, messageId: assistantMessageId, cwd },
          callbacks,
        )
        agentService.completeCodexTurn(sessionId, {
          messageId: route.getMessageId() ?? assistantMessageId,
          result,
          durationMs: Date.now() - runStart,
          fallbackText: 'Conversation compacted.',
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        agentService.failCodexTurn(sessionId, {
          messageId: route.getMessageId() ?? assistantMessageId,
          status: /interrupt|abort/i.test(message) ? 'interrupted' : 'error',
          text: /interrupt|abort/i.test(message) ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
        })
        throw error
      } finally {
        route.dispose()
      }
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

  const gitErrorMessage = (err: unknown): string => {
    const stderr = (err as { stderr?: string })?.stderr?.trim()
    if (stderr) return stderr
    return (err as Error)?.message ?? 'Unknown git error'
  }

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
    try {
      const raw = await gitRun(folderPath, ['worktree', 'list', '--porcelain'])
      const entries: { path: string; branch: string; head: string; isMain: boolean; isCurrent: boolean }[] = []
      let first = true
      for (const block of raw.split('\n\n').filter(Boolean)) {
        const lines = block.split('\n')
        const pathLine = lines.find((l) => l.startsWith('worktree '))
        const branchLine = lines.find((l) => l.startsWith('branch '))
        const headLine = lines.find((l) => l.startsWith('HEAD '))
        if (!pathLine) continue
        const wtPath = pathLine.slice('worktree '.length)
        const head = headLine ? headLine.slice('HEAD '.length) : ''
        const branch = branchLine ? branchLine.slice('branch refs/heads/'.length) : ''
        entries.push({ path: wtPath, branch, head, isMain: first, isCurrent: wtPath === folderPath })
        first = false
      }
      const mainEntry = entries.find((e) => e.isMain)
      const isWorktree = mainEntry ? mainEntry.path !== folderPath : false
      const current = entries.find((e) => e.isCurrent)
      const currentBranch = current?.branch || (current?.head ? current.head.slice(0, 7) : '')
      return { isWorktree, currentBranch, entries }
    } catch {
      try {
        const ref = await gitRun(folderPath, ['symbolic-ref', 'HEAD'])
        const branch = ref.replace('refs/heads/', '')
        return {
          isWorktree: false,
          currentBranch: branch,
          entries: [{ path: folderPath, branch, head: '', isMain: true, isCurrent: true }],
        }
      } catch {
        return null
      }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_ACTIVATE_WORKTREE, async (_event, folderPath: string, baseBranch: string | null, carryLocalChanges?: boolean) => {
    try {
      if (baseBranch === null) {
        await agentService.switchCwd(folderPath, folderPath)
        return { ok: true as const, path: folderPath }
      }
      const repoRoot = resolve(folderPath, await gitRun(folderPath, ['rev-parse', '--git-common-dir']))
      const mainDir = repoRoot.endsWith(`${sep}.git`) ? dirname(repoRoot) : repoRoot
      const repoName = basename(mainDir)
      const safeRef = sanitizeGitRef(baseBranch)
      const commitHash = (await gitRun(folderPath, ['rev-parse', safeRef])).trim()
      const shortHash = commitHash.slice(0, 7)
      const wtDir = join(homedir(), '.worktrees', repoName)
      const wtPath = join(wtDir, shortHash)

      let stashSha: string | undefined
      if (carryLocalChanges) {
        stashSha = (await gitRun(folderPath, ['stash', 'create'])).trim() || undefined
      }

      if (!existsSync(wtPath)) {
        if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })
        await gitRun(folderPath, ['worktree', 'add', '--detach', wtPath, safeRef])
      }

      if (stashSha) {
        await gitRun(wtPath, ['stash', 'apply', stashSha])
      }

      await agentService.switchCwd(folderPath, wtPath)
      return { ok: true as const, path: wtPath }
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

  ipcMain.handle(AgentIpcChannels.FILE_SHOW_IN_FOLDER, (_event, folderPath: string, relPath: string) => {
    const absPath = validatePathInProject(folderPath, relPath)
    shell.showItemInFolder(absPath)
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

  ipcMain.handle(AgentIpcChannels.CLAUDE_USER_PREFERENCES_GET, () => {
    return readUserPreferences()
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_USER_PREFERENCES_SAVE, (_e, preferences) => {
    const result = saveUserPreferences(preferences)
    agentService.markAllNeedsRebuild()
    return result
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_PROJECT_PREFERENCES_GET, (_e, projectPath: string) => {
    return readProjectPreferences(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CLAUDE_PROJECT_PREFERENCES_SAVE, (_e, projectPath: string, preferences) => {
    const result = saveProjectPreferences(projectPath, preferences)
    agentService.markAllNeedsRebuild()
    return result
  })

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

  const remoteConfigPath = join(app.getPath('userData'), 'remote-config.json')
  function readRemoteConfig(): { masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean; relayUrl: string } | null {
    try {
      const raw = JSON.parse(readFileSync(remoteConfigPath, 'utf-8'))
      return { preventSleep: false, relayUrl: '', ...raw }
    } catch {
      return null
    }
  }
  ipcMain.handle('remote:get-config', readRemoteConfig)
  ipcMain.handle('remote:save-config', (_, config: { masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean; relayUrl: string }) => {
    writeFileSync(remoteConfigPath, JSON.stringify(config))
    remoteControlService.start(config)
  })
  ipcMain.handle(AgentIpcChannels.REMOTE_LIST_PAIRED, (): PairedDevice[] => {
    const onlineIds = remoteControlService.getOnlineDeviceIds()
    return listPairedDevices().map((row) => ({
      id: row.id,
      name: row.name,
      pairedAt: row.paired_at,
      lastSeenAt: row.last_seen_at,
      online: onlineIds.has(row.id),
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
  agentService.addEventSubscriber((event) => {
    remoteControlService.broadcastAgentEvent(event)
  })

  const savedRemoteConfig = readRemoteConfig()
  if (savedRemoteConfig) remoteControlService.start(savedRemoteConfig)

  powerMonitor.on('resume', () => {
    log.info('[RemoteControl] System resumed, restarting channel')
    remoteControlService.resume()
  })

  ipcMain.handle('get-fullscreen', () => getMainWindow().isFullScreen())

  ipcMain.handle(AgentIpcChannels.GET_STARTUP_DATA, (): StartupData => {
    const cached = getCachedResources() as StartupData['cached']
    log.info(
      '[GET_STARTUP_DATA] cached:',
      cached ? `${cached.models?.length ?? 0} models, ${cached.codexModels?.length ?? 0} codex models` : 'null',
    )
    const userSkills = discoverUserSkills()
    const userCommands = discoverUserCommands()
    const userAgents = discoverUserAgents()
    return { cached, userSkills, userCommands, userAgents }
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CLAUDE, async (): Promise<ConnectResult> => {
    log.info('[CONNECT_CLAUDE] cwd:', app.getPath('userData'))
    log.info('[CONNECT_CLAUDE] platform=%s arch=%s', process.platform, process.arch)
    const cliPath = resolveSdkCli()
    log.info('[CONNECT_CLAUDE] SDK CLI path=%s', cliPath ?? 'none')
    const runtime = getNodeRuntime()
    const q = query({
      prompt: 'hi',
      options: { pathToClaudeCodeExecutable: cliPath, executable: runtime.executable as any, env: runtime.env, cwd: app.getPath('userData'), maxTurns: 0, permissionMode: 'default' },
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

      const userSkills = discoverUserSkills()
      const userCommands = discoverUserCommands()

      log.info('[CONNECT_CLAUDE] Models:', JSON.stringify(modelInfos, null, 2))
      log.info('[CONNECT_CLAUDE] Account:', JSON.stringify(accountInfo, null, 2))
      log.info('[CONNECT_CLAUDE] Commands:', JSON.stringify(commands, null, 2))
      log.info('[CONNECT_CLAUDE] OutputStyle=%s AvailableStyles=%j', initResult.output_style, initResult.available_output_styles)
      log.info('[CONNECT_CLAUDE] User Skills:', JSON.stringify(userSkills, null, 2))
      log.info('[CONNECT_CLAUDE] User Commands:', JSON.stringify(userCommands, null, 2))

      const models = modelInfos.map(mapModelInfo)
      const account = {
        email: accountInfo.email,
        organization: accountInfo.organization,
        subscriptionType: accountInfo.subscriptionType,
        apiKeySource: accountInfo.apiKeySource,
      }
      const slashCommands = commands.map((c) => ({
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
        isSkill: false,
      }))

      const currentCached = getCachedResources()
      setCachedResources(models, currentCached?.codexModels ?? [], account, slashCommands)

      const userAgents = discoverUserAgents()

      const availableOutputStyles = initResult.available_output_styles ?? []

      return { models, account, slashCommands, userSkills, userCommands, userAgents, availableOutputStyles }
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

  ipcMain.handle(AgentIpcChannels.WIDGET_IFRAME_READY, (_e, widgetId: string) => {
    notifyWidgetReady(widgetId)
  })

  initSuperoneMcpServer(() => mainWindow)
  startMcpHttpServer(() => mainWindow).catch((err) => log.error('[mcp-http] failed to start:', err))

  ipcMain.handle(AgentIpcChannels.MINIAPP_LIST, async (_e, projectDir?: string) => {
    const apps = await discoverApps()
    if (projectDir) {
      const projectApps = await discoverProjectApps(projectDir)
      const standaloneApp = await detectStandaloneApp(projectDir)
      const existingIds = new Set(apps.map((a) => a.id))
      for (const app of projectApps) {
        if (!existingIds.has(app.id)) apps.push(app)
      }
      if (standaloneApp && !existingIds.has(standaloneApp.id)) apps.push(standaloneApp)
    }
    for (const app of apps) {
      cacheAppBasePath(app.id, app.basePath)
      if (app.manifest.type === 'in-chat') {
        registerInChatApp(app.manifest)
        if (projectDir) setAppFsPermissions(app.id, app.manifest, projectDir, app.basePath)
      }
    }
    return apps
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_OPEN, async (_e, appId: string, projectDir: string) => {
    const basePath = getAppBasePath(appId)
    const manifest = await readManifest(basePath)
    if (!manifest) throw new Error(`App not found: ${appId}`)
    setAppFsPermissions(appId, manifest, projectDir, basePath)
    const toolSlug = manifest.toolSlug ?? appId
    registerAppTools(appId, toolSlug, manifest.tools ?? [])
    loadPreapprovedTools(appId, toolSlug, basePath)
    if (manifest.tools?.length) agentService.markAllNeedsRebuild()
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_CLOSE, async (_e, appId: string) => {
    unregisterAppTools(appId)
    clearAllowedDirectories(appId)
    agentService.markAllNeedsRebuild()
  })

  ipcMain.handle(AgentIpcChannels.MINIAPP_TOOL_RESULT, (_e, callId: string, result: unknown, error?: string) => {
    if (error) {
      rejectToolCall(callId, error)
    } else {
      resolveToolCall(callId, result)
    }
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
    const standaloneApp = await detectStandaloneApp(projectDir)
    const allApps = [...projectApps, ...(standaloneApp ? [standaloneApp] : [])]
    for (const app of allApps) cacheAppBasePath(app.id, app.basePath)
    return allApps
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

app.whenReady().then(() => {
  log.info(
    '[startup] appVersion=%s electron=%s platform=%s arch=%s logPath=%s',
    app.getVersion(),
    process.versions.electron,
    process.platform,
    process.arch,
    log.transports.file.getFile().path,
  )
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
      const tmpDirs = [process.env.TMPDIR, '/tmp', '/private/tmp'].filter(Boolean) as string[]
      if (!isPathWithinAllowed(resolved, [...folders.map((f) => f.path), ...tmpDirs])) {
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
        const bridgeScript = popoverName
          ? generatePopoverBridgeScript(appId, app.getVersion(), JSON.parse(url.searchParams.get('_popoverData') || 'null'))
          : generateBridgeScript(appId, app.getVersion())
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
  ipcMain.handle('app:media-server-port', () => getMediaServerPort())
  getDb() // Initialize database
  registerIpcHandlers()
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
