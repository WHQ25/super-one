import { watch, type FSWatcher } from 'fs'
import { BrowserWindow } from 'electron'
import log from './logger'
import { AgentIpcChannels } from '../shared/agent-types'

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let gitHeadTimer: ReturnType<typeof setTimeout> | null = null
let currentFolder: string | null = null
let win: BrowserWindow | null = null
let invalidateCache: (() => void) | null = null

const IGNORED = /(?:^|[/\\])(?:\.git|node_modules|\.DS_Store|\.next|dist|\.cache)(?:[/\\]|$)|\.log$/
const GIT_HEAD = /(?:^|[/\\])\.git[/\\]HEAD$/
const GIT_INDEX = /(?:^|[/\\])\.git[/\\]index(?:\.lock)?$/

function send(): void {
  if (!win || !currentFolder) return
  win.webContents.send(AgentIpcChannels.FILE_CHANGE_EVENT, { folderPath: currentFolder })
}

function sendGitHeadChange(): void {
  if (!win || !currentFolder) return
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
