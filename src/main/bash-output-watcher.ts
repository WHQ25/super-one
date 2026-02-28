import { readFile, stat } from 'fs/promises'
import { watch as fsWatch, type FSWatcher } from 'fs'
import type { BrowserWindow } from 'electron'
import log from './logger'
import { AgentIpcChannels, type BashOutputEvent } from '../shared/agent-types'

const MAX_TAIL_LINES = 50
const STABLE_TIMEOUT_MS = 5000

interface WatchEntry {
  filePath: string
  watcher: FSWatcher | null
  lastSize: number
  stableTimer: ReturnType<typeof setTimeout> | null
  pollTimer: ReturnType<typeof setInterval> | null
}

const watchers = new Map<string, WatchEntry>()
const filePaths = new Map<string, string>()
let win: BrowserWindow | null = null

export function setBashOutputWindow(mainWindow: BrowserWindow): void {
  win = mainWindow
}

function tailLines(text: string): string {
  const lines = text.split('\n')
  if (lines.length <= MAX_TAIL_LINES) return text
  return lines.slice(-MAX_TAIL_LINES).join('\n')
}

export function watchBashOutput(toolUseId: string, filePath: string): void {
  unwatchBashOutput(toolUseId)

  const entry: WatchEntry = {
    filePath,
    watcher: null,
    lastSize: -1,
    stableTimer: null,
    pollTimer: null,
  }

  const readAndEmit = async (): Promise<void> => {
    if (!watchers.has(toolUseId)) return
    try {
      const info = await stat(filePath)
      if (!watchers.has(toolUseId)) return
      if (info.size === entry.lastSize) return
      entry.lastSize = info.size
      const raw = await readFile(filePath, 'utf-8')
      if (!watchers.has(toolUseId)) return
      const content = tailLines(raw)
      send(toolUseId, content, false)

      if (!entry.watcher) {
        try {
          entry.watcher = fsWatch(filePath, () => { readAndEmit() })
          entry.watcher.on('error', () => {})
        } catch {}
      }

      if (entry.stableTimer) clearTimeout(entry.stableTimer)
      entry.stableTimer = setTimeout(() => {
        if (!watchers.has(toolUseId)) return
        send(toolUseId, content, true)
        unwatchBashOutput(toolUseId)
      }, STABLE_TIMEOUT_MS)
    } catch {
      // file may not exist yet
    }
  }

  try {
    entry.watcher = fsWatch(filePath, () => { readAndEmit() })
    entry.watcher.on('error', () => {})
  } catch {
    // file may not exist yet, polling will retry
  }

  entry.pollTimer = setInterval(() => { readAndEmit() }, 500)
  watchers.set(toolUseId, entry)
  filePaths.set(toolUseId, filePath)
  readAndEmit()

  log.debug(`[bash-output-watcher] watching ${filePath} for ${toolUseId}`)
}

export function unwatchBashOutput(toolUseId: string): void {
  const entry = watchers.get(toolUseId)
  if (!entry) return
  entry.watcher?.close()
  if (entry.pollTimer) clearInterval(entry.pollTimer)
  if (entry.stableTimer) clearTimeout(entry.stableTimer)
  watchers.delete(toolUseId)
  filePaths.delete(toolUseId)
}

export function unwatchAll(): void {
  for (const id of [...watchers.keys()]) unwatchBashOutput(id)
  filePaths.clear()
}

export function getWatchedFilePath(toolUseId: string): string | undefined {
  return filePaths.get(toolUseId)
}

function isValidBashOutputPath(filePath: string): boolean {
  if (filePath.includes('..')) return false
  if (!filePath.endsWith('.output')) return false
  return true
}

export async function readBashOutputTail(filePath: string, lines: number): Promise<string> {
  if (!isValidBashOutputPath(filePath)) return ''
  try {
    const raw = await readFile(filePath, 'utf-8')
    const all = raw.split('\n')
    if (all.length <= lines) return raw
    return all.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

function send(toolUseId: string, content: string, finished: boolean): void {
  if (!win || win.isDestroyed()) return
  const event: BashOutputEvent = { toolUseId, content, finished }
  win.webContents.send(AgentIpcChannels.BASH_OUTPUT_EVENT, event)
}
