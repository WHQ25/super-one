import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface ScopedAdditionalDirs {
  user: string[]
  projectShared: string[]
  projectLocal: string[]
}

const userSettingsPath = (): string => join(homedir(), '.claude', 'settings.json')
const projectSharedPath = (cwd: string): string => join(cwd, '.claude', 'settings.json')
const projectLocalPath = (cwd: string): string => join(cwd, '.claude', 'settings.local.json')

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractAdditionalDirs(data: Record<string, unknown> | null): string[] {
  if (!data) return []
  const out: string[] = []
  const top = data.additionalDirectories
  if (Array.isArray(top)) {
    for (const d of top) if (typeof d === 'string') out.push(d)
  }
  const perms = data.permissions
  if (perms && typeof perms === 'object') {
    const nested = (perms as Record<string, unknown>).additionalDirectories
    if (Array.isArray(nested)) {
      for (const d of nested) if (typeof d === 'string') out.push(d)
    }
  }
  return Array.from(new Set(out))
}

export function readScopedAdditionalDirs(cwd: string): ScopedAdditionalDirs {
  return {
    user: extractAdditionalDirs(readJsonFile(userSettingsPath())),
    projectShared: extractAdditionalDirs(readJsonFile(projectSharedPath(cwd))),
    projectLocal: extractAdditionalDirs(readJsonFile(projectLocalPath(cwd))),
  }
}

export function readProjectAdditionalDirs(cwd: string): string[] {
  const s = readScopedAdditionalDirs(cwd)
  return Array.from(new Set([...s.user, ...s.projectShared, ...s.projectLocal]))
}

export function addProjectAdditionalDir(cwd: string, dir: string): void {
  const path = projectLocalPath(cwd)
  const data = readJsonFile(path) ?? {}
  const perms = (data.permissions as Record<string, unknown> | undefined) ?? {}
  const existing = Array.isArray(perms.additionalDirectories)
    ? (perms.additionalDirectories as unknown[]).filter((d): d is string => typeof d === 'string')
    : []
  if (existing.includes(dir)) return
  perms.additionalDirectories = [...existing, dir]
  data.permissions = perms
  mkdirSync(join(cwd, '.claude'), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export function removeProjectAdditionalDir(cwd: string, dir: string): void {
  const path = projectLocalPath(cwd)
  const data = readJsonFile(path)
  if (!data) return
  const perms = data.permissions as Record<string, unknown> | undefined
  if (!perms || !Array.isArray(perms.additionalDirectories)) return
  const original = (perms.additionalDirectories as unknown[]).filter(
    (d): d is string => typeof d === 'string',
  )
  const filtered = original.filter((d) => d !== dir)
  if (filtered.length === original.length) return
  perms.additionalDirectories = filtered
  writeFileSync(path, JSON.stringify(data, null, 2))
}
