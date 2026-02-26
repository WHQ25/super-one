import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { join, dirname, basename, resolve, extname, relative } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { homedir } from 'os'
import { execFile, execFileSync, spawn } from 'child_process'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { getClaudeCliPath } from './agent/resolve-cli'
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
  type FileTreeEntry,
  type GitFileStatus,
} from '../shared/agent-types'
import { initUpdater, installUpdate, checkForUpdates } from './updater'
import { startWatching, stopWatching } from './file-watcher'
import { mapModelInfo } from './agent/claude-models'
import { getRecentFolders, addRecentFolder, removeRecentFolder } from './recent-folders'
import { getDb, closeDb, getCachedResources, setCachedResources } from './database'
import { discoverUserSkills, discoverUserCommands, discoverUserAgents } from './agent/discover-resources'
import { CodexExperimentService } from './codex/codex-experiment-service'

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
])

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
      sandbox: false,
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
      return raw.split('\n').filter(Boolean).map((line) => {
        const x = line[0]
        const y = line[1]
        const path = line.slice(3)
        const staged = x !== ' ' && x !== '?'
        let status: string
        if (x === '?' || y === '?') status = '?'
        else if (x === 'D' || y === 'D') status = 'D'
        else if (x === 'A') status = 'A'
        else if (x === 'R' || y === 'R') status = 'R'
        else if (x === 'C' || y === 'C') status = 'C'
        else if (x === 'U' || y === 'U') status = 'U'
        else status = 'M'
        return { path, status, staged }
      })
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

  ipcMain.handle(AgentIpcChannels.GIT_READ_FILE, async (_event, folderPath: string, filePath: string) => {
    try {
      const fullPath = join(folderPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      const ext = extname(filePath).toLowerCase()
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
      const statusMap = new Map<string, GitFileStatus>()
      const ignoredDirs = new Set<string>()
      try {
        const raw = await gitRun(folderPath, ['status', '--porcelain=v1', '--ignored'])
        if (raw) {
          for (const line of raw.split('\n').filter(Boolean)) {
            const x = line[0]
            const y = line[1]
            const filePath = line.slice(3)
            if (x === '!' && y === '!') {
              const p = filePath.replace(/\/$/, '')
              statusMap.set(p, '!')
              if (filePath.endsWith('/')) ignoredDirs.add(p)
            } else {
              let status: GitFileStatus
              if (x === '?' || y === '?') status = '?'
              else if (x === 'D' || y === 'D') status = 'D'
              else if (x === 'A') status = 'A'
              else if (x === 'R' || y === 'R') status = 'R'
              else status = 'M'
              statusMap.set(filePath, status)
            }
          }
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
      const statusMap = new Map<string, GitFileStatus>()
      const ignoredDirs = new Set<string>()
      try {
        const raw = await gitRun(folderPath, ['status', '--porcelain=v1', '--ignored'])
        if (raw) {
          for (const line of raw.split('\n').filter(Boolean)) {
            const x = line[0]
            const y = line[1]
            const filePath = line.slice(3)
            if (x === '!' && y === '!') {
              const p = filePath.replace(/\/$/, '')
              statusMap.set(p, '!')
              if (filePath.endsWith('/')) ignoredDirs.add(p)
            } else {
              let status: GitFileStatus
              if (x === '?' || y === '?') status = '?'
              else if (x === 'D' || y === 'D') status = 'D'
              else if (x === 'A') status = 'A'
              else if (x === 'R' || y === 'R') status = 'R'
              else status = 'M'
              statusMap.set(filePath, status)
            }
          }
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
    } catch {
      return []
    }
  })

  const testInstall = process.env.TEST_INSTALL_CLAUDE === '1'

  ipcMain.handle(AgentIpcChannels.SETUP_CHECK_CLAUDE, () => {
    if (testInstall) return false
    if (process.platform === 'win32') {
      return new Promise<boolean>((resolve) => {
        execFile('where', ['claude'], (error) => resolve(!error))
      })
    }
    return new Promise<boolean>((resolve) => {
      execFile(process.env.SHELL || '/bin/zsh', ['-l', '-c', 'which claude'], (error) => {
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

  ipcMain.handle(AgentIpcChannels.FILE_WATCH_START, (_e, folderPath: string) => {
    startWatching(getMainWindow(), folderPath)
  })

  ipcMain.handle(AgentIpcChannels.FILE_WATCH_STOP, () => {
    stopWatching()
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
      options: { pathToClaudeCodeExecutable: getClaudeCliPath(), cwd: app.getPath('userData'), maxTurns: 0, permissionMode: 'default' },
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
      apiKeySource: accountInfo.apiKeySource,
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
  protocol.handle('local-file', async (request) => {
    try {
      const filePath = decodeURIComponent(request.url.slice('local-file://'.length))
      log.info('[local-file]', request.url, '->', filePath)
      const data = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const mime: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
      }
      return new Response(data, {
        headers: { 'Content-Type': mime[ext] ?? 'application/octet-stream' },
      })
    } catch (err) {
      log.error('[local-file] failed:', err)
      return new Response('Not found', { status: 404 })
    }
  })
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
  stopWatching()
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
