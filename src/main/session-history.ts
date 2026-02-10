import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { SessionHistoryEntry } from '../shared/agent-types'

const MAX_SESSIONS = 50

function getFilePath(): string {
  return join(app.getPath('userData'), 'session-history.json')
}

function load(): SessionHistoryEntry[] {
  const filePath = getFilePath()
  if (!existsSync(filePath)) return []
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

function save(entries: SessionHistoryEntry[]): void {
  writeFileSync(getFilePath(), JSON.stringify(entries, null, 2))
}

export function getSessionHistory(): SessionHistoryEntry[] {
  return load()
}

export function saveSession(entry: SessionHistoryEntry): void {
  const entries = load()
  const idx = entries.findIndex((e) => e.sessionId === entry.sessionId)
  if (idx !== -1) {
    entries[idx] = entry
  } else {
    entries.unshift(entry)
  }
  save(entries.slice(0, MAX_SESSIONS))
}

export function deleteSession(sessionId: string): void {
  save(load().filter((e) => e.sessionId !== sessionId))
}

export function renameSession(sessionId: string, name: string): void {
  const entries = load()
  const entry = entries.find((e) => e.sessionId === sessionId)
  if (entry) {
    entry.name = name
    save(entries)
  }
}
