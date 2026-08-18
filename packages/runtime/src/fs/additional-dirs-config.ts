import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'smol-toml'
import type { ResourceProvider } from '@superone/shared/environment'

export interface ScopedAdditionalDirs {
  user: string[]
  projectShared: string[]
  projectLocal: string[]
}

export interface AdditionalDirsConfigOptions {
  homeDir?: string
  codexHome?: string
}

function homeOf(opts?: AdditionalDirsConfigOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function codexHomeOf(opts?: AdditionalDirsConfigOptions): string {
  if (opts?.codexHome) return opts.codexHome
  return process.env.CODEX_HOME?.trim() || join(homeOf(opts), '.codex')
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readToml(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    return parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function cleanDirs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0)))
}

function claudeDirs(data: Record<string, unknown> | null): string[] {
  if (!data) return []
  const permissions = data.permissions
  const nested = permissions && typeof permissions === 'object' && !Array.isArray(permissions)
    ? (permissions as Record<string, unknown>).additionalDirectories
    : undefined
  return Array.from(new Set([
    ...cleanDirs(data.additionalDirectories),
    ...cleanDirs(nested),
  ]))
}

function codexDirs(data: Record<string, unknown> | null): string[] {
  if (!data) return []
  const workspaceWrite = data.sandbox_workspace_write
  if (!workspaceWrite || typeof workspaceWrite !== 'object' || Array.isArray(workspaceWrite)) return []
  return cleanDirs((workspaceWrite as Record<string, unknown>).writable_roots)
}

export function readScopedAdditionalDirs(
  provider: ResourceProvider,
  cwd: string,
  opts?: AdditionalDirsConfigOptions,
): ScopedAdditionalDirs {
  if (provider === 'codex') {
    return {
      user: codexDirs(readToml(join(codexHomeOf(opts), 'config.toml'))),
      projectShared: [],
      projectLocal: codexDirs(readToml(join(cwd, '.codex', 'config.toml'))),
    }
  }
  return {
    user: claudeDirs(readJson(join(homeOf(opts), '.claude', 'settings.json'))),
    projectShared: claudeDirs(readJson(join(cwd, '.claude', 'settings.json'))),
    projectLocal: claudeDirs(readJson(join(cwd, '.claude', 'settings.local.json'))),
  }
}

export function addProjectAdditionalDir(
  provider: ResourceProvider,
  cwd: string,
  dir: string,
  opts?: AdditionalDirsConfigOptions,
): void {
  if (provider === 'codex') {
    const filePath = join(cwd, '.codex', 'config.toml')
    const data = readToml(filePath) ?? {}
    const current = data.sandbox_workspace_write
    const workspaceWrite = current && typeof current === 'object' && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {}
    const existing = cleanDirs(workspaceWrite.writable_roots)
    if (existing.includes(dir)) return
    workspaceWrite.writable_roots = [...existing, dir]
    data.sandbox_workspace_write = workspaceWrite
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, stringify(data), 'utf8')
    return
  }

  const filePath = join(cwd, '.claude', 'settings.local.json')
  const data = readJson(filePath) ?? {}
  const current = data.permissions
  const permissions = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {}
  const existing = cleanDirs(permissions.additionalDirectories)
  if (existing.includes(dir)) return
  permissions.additionalDirectories = [...existing, dir]
  data.permissions = permissions
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function removeProjectAdditionalDir(
  provider: ResourceProvider,
  cwd: string,
  dir: string,
): void {
  if (provider === 'codex') {
    const filePath = join(cwd, '.codex', 'config.toml')
    const data = readToml(filePath)
    if (!data) return
    const current = data.sandbox_workspace_write
    if (!current || typeof current !== 'object' || Array.isArray(current)) return
    const workspaceWrite = current as Record<string, unknown>
    const existing = cleanDirs(workspaceWrite.writable_roots)
    const filtered = existing.filter((root) => root !== dir)
    if (filtered.length === existing.length) return
    if (filtered.length > 0) workspaceWrite.writable_roots = filtered
    else delete workspaceWrite.writable_roots
    if (Object.keys(workspaceWrite).length === 0) delete data.sandbox_workspace_write
    writeFileSync(filePath, stringify(data), 'utf8')
    return
  }

  const filePath = join(cwd, '.claude', 'settings.local.json')
  const data = readJson(filePath)
  if (!data) return
  const current = data.permissions
  if (!current || typeof current !== 'object' || Array.isArray(current)) return
  const permissions = current as Record<string, unknown>
  const existing = cleanDirs(permissions.additionalDirectories)
  const filtered = existing.filter((root) => root !== dir)
  if (filtered.length === existing.length) return
  permissions.additionalDirectories = filtered
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
