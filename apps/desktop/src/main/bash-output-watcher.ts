import { readFile, stat } from 'fs/promises'
import { watch as fsWatch, type FSWatcher } from 'fs'
import type { BrowserWindow } from 'electron'
import log from './logger'
import { AgentIpcChannels, type BashOutputEvent } from '@superone/shared/agent-types'

const DEFAULT_TAIL_LINES = 50
const STABLE_TIMEOUT_MS = 5000

interface WatchEntry {
  filePath: string
  tailLines: number
  watcher: FSWatcher | null
  lastSize: number
  finished: boolean
  stableTimer: ReturnType<typeof setTimeout> | null
  pollTimer: ReturnType<typeof setInterval> | null
}

const watchers = new Map<string, WatchEntry>()
const filePaths = new Map<string, string>()
let win: BrowserWindow | null = null

export function setBashOutputWindow(mainWindow: BrowserWindow): void {
  win = mainWindow
}

export function tailLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(-maxLines).join('\n')
}

export function watchBashOutput(toolUseId: string, filePath: string, tailLinesCount: number = DEFAULT_TAIL_LINES): void {
  unwatchBashOutput(toolUseId)

  const entry: WatchEntry = {
    filePath,
    tailLines: tailLinesCount,
    watcher: null,
    lastSize: -1,
    finished: false,
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
      const content = tailLines(raw, entry.tailLines)
      entry.finished = false
      send(toolUseId, content, false)

      if (!entry.watcher) {
        try {
          entry.watcher = fsWatch(filePath, () => { readAndEmit() })
          entry.watcher.on('error', () => {})
        } catch (err) { log.warn('[bash-output] failed to watch file:', err) }
      }

      if (entry.stableTimer) clearTimeout(entry.stableTimer)
      entry.stableTimer = setTimeout(() => {
        if (!watchers.has(toolUseId)) return
        if (entry.finished) return
        entry.finished = true
        send(toolUseId, content, true)
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

export async function readBashOutputTail(filePath: string, lines: number): Promise<string> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const all = raw.split('\n')
    if (all.length <= lines) return raw
    return all.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

function send(toolUseId: string, content: string, finished: boolean, outputPath?: string): void {
  if (!win || win.isDestroyed()) return
  const event: BashOutputEvent = { toolUseId, content, finished, ...(outputPath ? { outputPath } : {}) }
  win.webContents.send(AgentIpcChannels.BASH_OUTPUT_EVENT, event)
}

/** Push live bash/terminal output without a file watcher (ACP terminals). */
export function pushBashOutput(toolUseId: string, content: string, finished: boolean, outputPath?: string): void {
  send(toolUseId, content, finished, outputPath)
}
