import { watch, type FSWatcher } from 'fs'
import { execFile } from 'child_process'
import { basename, dirname, resolve } from 'path'
import { promisify } from 'util'
import { BrowserWindow } from 'electron'
import log from './logger'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const execFileAsync = promisify(execFile)

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let gitHeadTimer: ReturnType<typeof setTimeout> | null = null
let currentFolder: string | null = null
let win: BrowserWindow | null = null
let invalidateCache: (() => void) | null = null

let headWatcher: FSWatcher | null = null
let headDebounceTimer: ReturnType<typeof setTimeout> | null = null
let headWatchFolder: string | null = null
let headWatchWin: BrowserWindow | null = null
let headWatchInvalidate: (() => void) | null = null
let headWatchSeq = 0

const IGNORED = /(?:^|[/\\])(?:\.git|node_modules|\.DS_Store|\.next|dist|\.cache)(?:[/\\]|$)|\.log$/
const GIT_HEAD = /(?:^|[/\\])\.git[/\\]HEAD$/
const GIT_INDEX = /(?:^|[/\\])\.git[/\\]index(?:\.lock)?$/
const GIT_WORKTREES = /(?:^|[/\\])\.git[/\\]worktrees(?:[/\\]|$)/

function send(): void {
  if (!win || win.isDestroyed() || !currentFolder) return
  win.webContents.send(AgentIpcChannels.FILE_CHANGE_EVENT, { folderPath: currentFolder })
}

function sendGitHeadChange(): void {
  if (!win || win.isDestroyed() || !currentFolder) return
  win.webContents.send(AgentIpcChannels.GIT_HEAD_CHANGE, { folderPath: currentFolder })
}

function handleChange(_eventType: string, filename: string | null): void {
  if (!filename) return
  if (GIT_HEAD.test(filename)) {
    invalidateCache?.()
    if (gitHeadTimer) clearTimeout(gitHeadTimer)
    gitHeadTimer = setTimeout(sendGitHeadChange, 100)
    return
  }
  if (GIT_INDEX.test(filename)) {
    invalidateCache?.()
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(send, 300)
    return
  }
  // `.git/` is ignored below. A worktree add/remove still has to drop the list cache.
  if (GIT_WORKTREES.test(filename)) {
    invalidateCache?.()
    return
  }
  if (IGNORED.test(filename)) return
  invalidateCache?.()
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(send, 300)
}

export function startWatching(mainWindow: BrowserWindow, folderPath: string, onInvalidate?: () => void): void {
  if (currentFolder === folderPath && watcher) return
  stopWatching()
  win = mainWindow
  currentFolder = folderPath
  invalidateCache = onInvalidate ?? null
  try {
    watcher = watch(folderPath, { recursive: true }, handleChange)
    watcher.on('error', (err) => {
      log.warn('[file-watcher] Error:', err.message)
    })
    log.info('[file-watcher] Watching:', folderPath)
  } catch (err) {
    log.warn('[file-watcher] Failed to start:', (err as Error).message)
  }
}

export function stopWatching(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (gitHeadTimer) {
    clearTimeout(gitHeadTimer)
    gitHeadTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
    if (currentFolder) log.info('[file-watcher] Stopped:', currentFolder)
    currentFolder = null
    invalidateCache = null
  }
}

export async function resolveGitHeadDir(folderPath: string): Promise<{ dir: string; file: string } | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', folderPath, 'rev-parse', '--git-path', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const raw = stdout.trim()
    if (!raw) return null
    const full = resolve(folderPath, raw)
    return { dir: dirname(full), file: basename(full) }
  } catch {
    return null
  }
}

export function stopGitHeadWatching(): void {
  headWatchSeq += 1
  if (headDebounceTimer) {
    clearTimeout(headDebounceTimer)
    headDebounceTimer = null
  }
  if (headWatcher) {
    headWatcher.close()
    headWatcher = null
  }
  headWatchFolder = null
  headWatchWin = null
  headWatchInvalidate = null
}

export async function startGitHeadWatching(
  mainWindow: BrowserWindow | null,
  folderPath: string,
  onInvalidate?: () => void,
): Promise<void> {
  if (headWatchFolder === folderPath && headWatcher) {
    headWatchWin = mainWindow
    headWatchInvalidate = onInvalidate ?? null
    return
  }
  stopGitHeadWatching()
  const seq = headWatchSeq
  headWatchWin = mainWindow
  headWatchFolder = folderPath
  headWatchInvalidate = onInvalidate ?? null

  const target = await resolveGitHeadDir(folderPath)
  if (!target || seq !== headWatchSeq) {
    if (seq === headWatchSeq) stopGitHeadWatching()
    return
  }

  try {
    headWatcher = watch(target.dir, { recursive: false }, (_eventType, filename) => {
      if (filename && String(filename) !== target.file) return
      headWatchInvalidate?.()
      if (headDebounceTimer) clearTimeout(headDebounceTimer)
      headDebounceTimer = setTimeout(() => {
        if (!headWatchWin || headWatchWin.isDestroyed() || !headWatchFolder) return
        headWatchWin.webContents.send(AgentIpcChannels.GIT_HEAD_CHANGE, { folderPath: headWatchFolder })
      }, 100)
    })
    headWatcher.on('error', (err) => {
      log.warn('[git-head-watcher] Error:', err.message)
    })
  } catch (err) {
    log.warn('[git-head-watcher] Failed to start:', (err as Error).message)
    stopGitHeadWatching()
  }
}
