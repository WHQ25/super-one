import { app, BrowserWindow, dialog, ipcMain, Menu, net, powerMonitor, protocol, shell } from 'electron'
import { join, dirname, basename, resolve, extname, relative, isAbsolute, sep } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, readdir, rename, cp, rm, access, stat } from 'fs/promises'
import { homedir } from 'os'
import { resolveRealPath, isPathWithinAllowed, sanitizeGitRef } from './path-security'
import { execFile, execFileSync, spawn } from 'child_process'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { fixPath, resolveSdkCli } from './agent/resolve-cli'
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
import { initUpdater, installUpdate, checkForUpdates, simulateUpdate, simulateNotAvailable, getUpdaterState, getUpdateMenuState, setOnMenuChange } from './updater'
import { startWatching, stopWatching } from './file-watcher'
import { setBashOutputWindow, watchBashOutput, unwatchBashOutput, unwatchAll as unwatchAllBashOutputs, readBashOutputTail, getWatchedFilePath } from './bash-output-watcher'
import { parseGitStatusOutput, parseGitStatusFiles } from './git-status-utils'
import { mapModelInfo } from './agent/claude-models'
import { getRecentFolders, addRecentFolder, removeRecentFolder } from './recent-folders'
import { getDb, closeDb, getCachedResources, setCachedResources, upsertPairedDevice, listPairedDevices, deletePairedDevice, isPairedDevice } from './database'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'
import { trace, closeTraceDb } from './agent/event-trace'
import { RemoteControlService } from './remote-control-service'
import type { RemoteCommand, PairedDevice } from '../shared/agent-types'
import type { RemoteControlCallbacks } from './remote-control-service'

declare const __SUPABASE_URL__: string
declare const __SUPABASE_PUBLISHABLE_KEY__: string

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
])

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

// Isolate userData when running parallel instances (e.g. git worktrees)
if (process.env.SUPERONE_INSTANCE) {
  app.setPath('userData', join(app.getPath('userData'), `instance-${process.env.SUPERONE_INSTANCE}`))
}

const agentService = new AgentService()
const codexService = new CodexExperimentService()
const remoteCallbacks: RemoteControlCallbacks = {
  onCommand: (command) => {
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_COMMAND, command)
  },
  onClientRegistered: ({ deviceName, deviceId }) => {
    upsertPairedDevice(deviceId, deviceName)
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: deviceId, online: true })
  },
  onClientDisconnected: ({ deviceId }) => {
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: deviceId, online: false })
  },
  onPairingCodeReceived: ({ code, deviceName }) => {
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_PAIRING_CODE_RECEIVED, { code, deviceName })
  },
  onPairingExpired: () => {
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_PAIRING_EXPIRED)
  },
  onPairingConfirmed: ({ mobileDeviceId, deviceName }) => {
    upsertPairedDevice(mobileDeviceId, deviceName)
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_DEVICE_STATUS_CHANGED, { id: mobileDeviceId, online: false })
  },
  onPairingAlreadyPaired: ({ deviceName }) => {
    mainWindow?.webContents.send(AgentIpcChannels.REMOTE_PAIRING_ALREADY_PAIRED, { deviceName })
  },
  isPairedDevice: (deviceId) => isPairedDevice(deviceId),
}
const remoteControlService = new RemoteControlService(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__, remoteCallbacks)
let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('Main window not created yet')
  return mainWindow
}

function emitAgentEvent(event: AgentEvent): void {
  mainWindow?.webContents.send(AgentIpcChannels.EVENT, event)
}

const activeCodexEventTargets = new Map<string, {
  setMessageId: (messageId?: string) => void
  dispose: () => void
}>()

function createCodexCallbacks(messageId: string | undefined, sessionId: string, projectPath: string) {
  let currentMessageId = messageId
  const route = {
    setMessageId: (nextMessageId?: string) => {
      currentMessageId = nextMessageId
    },
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
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      zoomFactor: 1
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.control || input.meta) {
      if (input.key === '=' || input.key === '+' || input.key === '-') {
        _e.preventDefault()
      }
    }
  })

  // Update agentService's window reference for event forwarding
  agentService.setMainWindow(mainWindow)
  setBashOutputWindow(mainWindow)

  mainWindow.on('closed', () => {
    unwatchAllBashOutputs()
  })

  // Fullscreen state (window-specific, re-binds per window)
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', false)
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
function registerIpcHandlers(): void {
  // Setup agent IPC handlers (does NOT auto-initialize)
  agentService.setup()

  ipcMain.on('app:trace', (_e, source: string, type: string, data: unknown, tag?: string) => {
    trace(source, type, data, tag)
  })

  // App-level IPC handlers
  ipcMain.handle(AgentIpcChannels.SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory'],
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
    ) => {
      const { callbacks, route } = createCodexCallbacks(messageId, sessionId, projectPath)
      try {
        return await codexService.run(
          sessionId,
          projectPath,
          { prompt, model, reasoningEffort, permissionPreset, collaborationMode, threadId, messageId, images, cwd },
          callbacks,
        )
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

  ipcMain.handle(AgentIpcChannels.CODEX_STEER, (_event, sessionId: string, input: string, messageId?: string) => {
    if (messageId) {
      activeCodexEventTargets.get(sessionId)?.setMessageId(messageId)
    }
    return codexService.steer(sessionId, input)
  })

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
    ) => {
      const { callbacks, route } = createCodexCallbacks(messageId, sessionId, projectPath)
      try {
        return await codexService.review(
          sessionId,
          projectPath,
          { target, model, reasoningEffort, permissionPreset, threadId, messageId, cwd },
          callbacks,
        )
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
    ) => {
      const { callbacks, route } = createCodexCallbacks(messageId, sessionId, projectPath)
      try {
        return await codexService.compact(
          sessionId,
          projectPath,
          { model, permissionPreset, threadId, messageId, cwd },
          callbacks,
        )
      } finally {
        route.dispose()
      }
    },
  )

  const gitRun = (folderPath: string, args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile('git', args, { cwd: folderPath }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trimEnd())
      })
    })

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
        ? ['log', '--format=%H%x00%s%x00%an%x00%ai']
        : ['log', '--format=%H%x00%s%x00%an%x00%ai', '-50']
      const raw = await gitRun(folderPath, args)
      if (!raw) return []
      const entries = raw.split('\n').filter(Boolean).map((line) => {
        const [sha, message, author, date] = line.split('\0')
        return { sha, message, author, date }
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
      const mainDir = repoRoot.endsWith('/.git') ? dirname(repoRoot) : repoRoot
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
    const absPath = resolve(folderPath, relPath)
    if (!absPath.startsWith(folderPath + sep) && absPath !== folderPath) {
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
      if (!newAbs.startsWith(folderPath + sep)) {
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
      win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_output',
        data: data.toString(),
      })
    })

    child.stderr.on('data', (data: Buffer) => {
      win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_output',
        data: data.toString(),
      })
    })

    child.on('close', (code) => {
      fixPath()
      win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
        type: 'install_complete',
        code: code ?? 1,
      })
    })

    child.on('error', (err) => {
      win.webContents.send(AgentIpcChannels.SETUP_EVENT, {
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

  ipcMain.handle(AgentIpcChannels.GET_LOG_PATH, () => {
    return log.transports.file.getFile().path
  })

  const remoteConfigPath = join(app.getPath('userData'), 'remote-config.json')
  function readRemoteConfig(): { masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean } | null {
    try {
      const raw = JSON.parse(readFileSync(remoteConfigPath, 'utf-8'))
      return { preventSleep: false, ...raw }
    } catch {
      return null
    }
  }
  ipcMain.handle('remote:get-config', readRemoteConfig)
  ipcMain.handle('remote:save-config', (_, config: { masterSecret: string; deviceId: string; enabled: boolean; preventSleep: boolean }) => {
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
    const q = query({
      prompt: 'hi',
      options: { pathToClaudeCodeExecutable: cliPath, cwd: app.getPath('userData'), maxTurns: 0, permissionMode: 'default' },
    })
    try {
      log.info('[CONNECT_CLAUDE] Fetching models, account, commands...')
      const [modelInfos, accountInfo, commands] = await Promise.all([
        q.supportedModels(),
        q.accountInfo(),
        q.supportedCommands(),
      ])
      log.info('[CONNECT_CLAUDE] Fetch complete, closing query...')
      q.close()

      const userSkills = discoverUserSkills()
      const userCommands = discoverUserCommands()

      log.info('[CONNECT_CLAUDE] Models:', JSON.stringify(modelInfos, null, 2))
      log.info('[CONNECT_CLAUDE] Account:', JSON.stringify(accountInfo, null, 2))
      log.info('[CONNECT_CLAUDE] Commands:', JSON.stringify(commands, null, 2))
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

      return { models, account, slashCommands, userSkills, userCommands, userAgents }
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
      const filePath = decodeURIComponent(request.url.slice('local-file://'.length))
      const resolved = resolveRealPath(filePath)
      const folders = getRecentFolders()
      if (!isPathWithinAllowed(resolved, folders.map((f) => f.path))) {
        log.warn('[local-file] blocked path outside project folders:', resolved)
        return new Response('Forbidden', { status: 403 })
      }
      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const contentType = LOCAL_FILE_MIME[ext] ?? 'application/octet-stream'
      const data = await readFile(resolved)
      const total = data.byteLength
      const range = request.headers.get('Range')

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
  fixPath()
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
  stopWatching()
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
