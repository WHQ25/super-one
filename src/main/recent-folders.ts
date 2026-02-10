import { app } from 'electron'
import { join, basename } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { RecentFolder } from '../shared/agent-types'

const MAX_RECENT = 10

function getFilePath(): string {
  return join(app.getPath('userData'), 'recent-folders.json')
}

export function getRecentFolders(): RecentFolder[] {
  const filePath = getFilePath()
  if (!existsSync(filePath)) return []
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

function save(folders: RecentFolder[]): void {
  writeFileSync(getFilePath(), JSON.stringify(folders, null, 2))
}

export function addRecentFolder(folderPath: string): void {
  const folders = getRecentFolders().filter((f) => f.path !== folderPath)
  folders.unshift({
    path: folderPath,
    name: basename(folderPath),
    lastOpened: new Date().toISOString(),
  })
  save(folders.slice(0, MAX_RECENT))
}

export function removeRecentFolder(folderPath: string): void {
  save(getRecentFolders().filter((f) => f.path !== folderPath))
}
