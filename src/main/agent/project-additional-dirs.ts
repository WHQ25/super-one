import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Read additionalDirectories from {cwd}/.claude/settings.json */
export function readProjectAdditionalDirs(cwd: string): string[] {
  try {
    const settingsPath = join(cwd, '.claude', 'settings.json')
    if (!existsSync(settingsPath)) return []
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    if (Array.isArray(data.additionalDirectories)) {
      return data.additionalDirectories.filter((d: unknown) => typeof d === 'string')
    }
    return []
  } catch {
    return []
  }
}

/** Write additionalDirectories to {cwd}/.claude/settings.json (merges with existing data) */
export function writeProjectAdditionalDirs(cwd: string, dirs: string[]): void {
  const settingsPath = join(cwd, '.claude', 'settings.json')
  let data: Record<string, unknown> = {}
  try {
    if (existsSync(settingsPath)) {
      data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    }
  } catch { /* start fresh */ }
  data.additionalDirectories = dirs

  mkdirSync(join(cwd, '.claude'), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(data, null, 2))
}
