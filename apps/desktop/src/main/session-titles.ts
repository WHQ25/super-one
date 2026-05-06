import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

function getFilePath(): string {
  return join(app.getPath('userData'), 'session-titles.json')
}

export function getSessionTitles(): Record<string, string> {
  const filePath = getFilePath()
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

export function setSessionTitle(sessionId: string, title: string): void {
  const titles = getSessionTitles()
  titles[sessionId] = title
  writeFileSync(getFilePath(), JSON.stringify(titles, null, 2))
}

export function deleteSessionTitle(sessionId: string): void {
  const titles = getSessionTitles()
  delete titles[sessionId]
  writeFileSync(getFilePath(), JSON.stringify(titles, null, 2))
}
