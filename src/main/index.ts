import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, dirname, basename, resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { execFile, execFileSync, spawn } from 'child_process'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { AgentService } from './agent/agent-service'
import {
  AgentIpcChannels,
  type CodexPermissionPreset,
  type CodexReasoningEffort,
  type CodexReviewTarget,
  type AgentEvent,
  type CodexThreadItem,
  type CodexUsageInfo,
  type CodexSetAuthRequest,
  type PermissionRequest,
  type ImageAttachment,
  type ConnectResult,
  type StartupData,
} from '../shared/agent-types'
import { initUpdater, installUpdate, checkForUpdates } from './updater'
import { mapModelInfo } from './agent/claude-models'
import { getRecentFolders, addRecentFolder, removeRecentFolder } from './recent-folders'
import { getDb, closeDb, getCachedResources, setCachedResources } from './database'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'

// Isolate userData when running parallel instances (e.g. git worktrees)
if (process.env.SUPERONE_INSTANCE) {
  app.setPath('userData', join(app.getPath('userData'), `instance-${process.env.SUPERONE_INSTANCE}`))
}

const agentService = new AgentService()
const codexService = new CodexExperimentService()
let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('Main window not created yet')
  return mainWindow
}

function emitAgentEvent(event: AgentEvent): void {
  mainWindow?.webContents.send(AgentIpcChannels.EVENT, event)
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
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Update agentService's window reference for event forwarding
  agentService.setMainWindow(mainWindow)

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
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_RUN,
    async (
      _event,
      projectPath: string,
      prompt: string,
      model?: string,
      reasoningEffort?: CodexReasoningEffort,
      permissionPreset?: CodexPermissionPreset,
      threadId?: string,
      messageId?: string,
      images?: ImageAttachment[],
    ) => {
      const runCallbacks = messageId
        ? {
            onThreadStarted: (resolvedThreadId: string) => {
              emitAgentEvent({
                type: 'codex_thread_started',
                messageId,
                threadId: resolvedThreadId,
                projectPath,
              })
            },
            onItemDelta: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => {
              emitAgentEvent({
                type: 'codex_item_delta',
                messageId,
                phase,
                item,
                projectPath,
              })
            },
            onUsageDelta: (usage: CodexUsageInfo) => {
              emitAgentEvent({
                type: 'message_usage',
                messageId,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                projectPath,
              })
            },
            onPermissionRequest: (request: PermissionRequest) => {
              emitAgentEvent({
                type: 'permission_request',
                request,
                projectPath,
              })
            },
          }
        : undefined

      return codexService.run(
        projectPath,
        { prompt, model, reasoningEffort, permissionPreset, threadId, messageId, images },
        runCallbacks,
      )
    },
  )

  ipcMain.handle(AgentIpcChannels.CODEX_LIST_MODELS, (_event, projectPath: string) => {
    return codexService.listModels(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_RESET, (_event, projectPath: string) => {
    codexService.reset(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_INTERRUPT, (_event, projectPath: string) => {
    return codexService.interrupt(projectPath)
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_PERMISSION_RESPONSE,
    (_event, projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string) => {
      return codexService.respondToPermission(projectPath, requestId, allow, alwaysAllow, reason)
    },
  )

  ipcMain.handle(AgentIpcChannels.CODEX_GET_AUTH_STATUS, (_event, projectPath: string) => {
    return codexService.getAuthStatus(projectPath)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_SET_AUTH, (_event, projectPath: string, request: CodexSetAuthRequest) => {
    return codexService.setAuth(projectPath, request)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_STEER, (_event, projectPath: string, input: string) => {
    return codexService.steer(projectPath, input)
  })

  ipcMain.handle(
    AgentIpcChannels.CODEX_REVIEW,
    async (
      _event,
      projectPath: string,
      target: CodexReviewTarget,
      model?: string,
      reasoningEffort?: CodexReasoningEffort,
      permissionPreset?: CodexPermissionPreset,
      threadId?: string,
      messageId?: string,
    ) => {
      const runCallbacks = messageId
        ? {
            onThreadStarted: (resolvedThreadId: string) => {
              emitAgentEvent({
                type: 'codex_thread_started',
                messageId,
                threadId: resolvedThreadId,
                projectPath,
              })
            },
            onItemDelta: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => {
              emitAgentEvent({
                type: 'codex_item_delta',
                messageId,
                phase,
                item,
                projectPath,
              })
            },
            onUsageDelta: (usage: CodexUsageInfo) => {
              emitAgentEvent({
                type: 'message_usage',
                messageId,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                projectPath,
              })
            },
            onPermissionRequest: (request: PermissionRequest) => {
              emitAgentEvent({
                type: 'permission_request',
                request,
                projectPath,
              })
            },
          }
        : undefined

      return codexService.review(
        projectPath,
        { target, model, reasoningEffort, permissionPreset, threadId, messageId },
        runCallbacks,
      )
    },
  )

  ipcMain.handle(
    AgentIpcChannels.CODEX_COMPACT,
    async (
      _event,
      projectPath: string,
      model?: string,
      permissionPreset?: CodexPermissionPreset,
      threadId?: string,
      messageId?: string,
    ) => {
      const runCallbacks = messageId
        ? {
            onThreadStarted: (resolvedThreadId: string) => {
              emitAgentEvent({
                type: 'codex_thread_started',
                messageId,
                threadId: resolvedThreadId,
                projectPath,
              })
            },
            onItemDelta: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => {
              emitAgentEvent({
                type: 'codex_item_delta',
                messageId,
                phase,
                item,
                projectPath,
              })
            },
            onUsageDelta: (usage: CodexUsageInfo) => {
              emitAgentEvent({
                type: 'message_usage',
                messageId,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                projectPath,
              })
            },
            onPermissionRequest: (request: PermissionRequest) => {
              emitAgentEvent({
                type: 'permission_request',
                request,
                projectPath,
              })
            },
          }
        : undefined

      return codexService.compact(
        projectPath,
        { model, permissionPreset, threadId, messageId },
        runCallbacks,
      )
    },
  )

  const gitRun = (folderPath: string, args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile('git', args, { cwd: folderPath }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trim())
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

  const gitErrorMessage = (err: unknown): string => {
    const stderr = (err as { stderr?: string })?.stderr?.trim()
    if (stderr) return stderr
    return (err as Error)?.message ?? 'Unknown git error'
  }

  ipcMain.handle(AgentIpcChannels.GIT_SWITCH_BRANCH, async (_event, folderPath: string, branch: string) => {
    try {
      await gitRun(folderPath, ['checkout', branch])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
  })

  ipcMain.handle(AgentIpcChannels.GIT_CREATE_BRANCH, async (_event, folderPath: string, branch: string) => {
    try {
      await gitRun(folderPath, ['checkout', '-b', branch])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
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
      const commitHash = (await gitRun(folderPath, ['rev-parse', baseBranch])).trim()
      const shortHash = commitHash.slice(0, 7)
      const wtDir = join(homedir(), '.worktrees', repoName)
      const wtPath = join(wtDir, shortHash)

      let stashSha: string | undefined
      if (carryLocalChanges) {
        stashSha = (await gitRun(folderPath, ['stash', 'create'])).trim() || undefined
      }

      if (!existsSync(wtPath)) {
        if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })
        await gitRun(folderPath, ['worktree', 'add', '--detach', wtPath, baseBranch])
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

  const testInstall = process.env.TEST_INSTALL_CLAUDE === '1'

  ipcMain.handle(AgentIpcChannels.SETUP_CHECK_CLAUDE, () => {
    if (testInstall) return false
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    return new Promise<boolean>((resolve) => {
      execFile(cmd, ['claude'], (error) => {
        resolve(!error)
      })
    })
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

  ipcMain.handle(AgentIpcChannels.GET_LOG_PATH, () => {
    return log.transports.file.getFile().path
  })

  ipcMain.handle('get-fullscreen', () => getMainWindow().isFullScreen())

  ipcMain.handle(AgentIpcChannels.GET_STARTUP_DATA, (): StartupData => {
    const cached = getCachedResources() as StartupData['cached']
    const userSkills = discoverUserSkills()
    const userCommands = discoverUserCommands()
    const userAgents = discoverUserAgents()
    return { cached, userSkills, userCommands, userAgents }
  })

  ipcMain.handle(AgentIpcChannels.CONNECT_CLAUDE, async (): Promise<ConnectResult> => {
    const q = query({
      prompt: 'hi',
      options: { cwd: homedir(), maxTurns: 0, permissionMode: 'default' },
    })
    const [modelInfos, accountInfo, commands] = await Promise.all([
      q.supportedModels(),
      q.accountInfo(),
      q.supportedCommands(),
    ])
    q.close()

    // Scan user-level resources from filesystem
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
    }
    const slashCommands = commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
      isSkill: false, // per-project isSkill tagging happens in createSession
    }))

    // Write to cache for next startup
    setCachedResources(models, account, slashCommands)

    const userAgents = discoverUserAgents()

    return { models, account, slashCommands, userSkills, userCommands, userAgents }
  })
}

app.whenReady().then(() => {
  getDb() // Initialize database
  registerIpcHandlers()
  createWindow()
  initUpdater(mainWindow!)

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
  agentService
    .dispose()
    .catch(() => {})
    .finally(() => {
      codexService.dispose()
      closeDb()
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
