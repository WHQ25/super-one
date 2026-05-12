import { readFile, writeFile, mkdir, rename, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { app } from 'electron'
import log from '../logger'
import { devRegistryFileSchema, type DevRegistryFile } from './miniapp-schema'
import type { DevRegistryEntry } from '@superone/shared/miniapp-types'

let testFileOverride: string | null = null

function registryFile(): string {
  if (testFileOverride) return testFileOverride
  return join(app.getPath('home'), '.superone', 'dev-registry.json')
}

const EMPTY: DevRegistryFile = { version: 1, apps: [] }

let cache: DevRegistryFile | null = null

async function readRaw(): Promise<DevRegistryFile> {
  let raw: string
  try {
    raw = await readFile(registryFile(), 'utf-8')
  } catch {
    return { ...EMPTY }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('[dev-registry] file is not valid JSON, treating as empty')
    return { ...EMPTY }
  }
  const result = devRegistryFileSchema.safeParse(parsed)
  if (!result.success) {
    log.warn('[dev-registry] schema validation failed: %s', result.error.issues.map((i) => i.message).join('; '))
    return { ...EMPTY }
  }
  return result.data
}

async function load(): Promise<DevRegistryFile> {
  if (cache) return cache
  cache = await readRaw()
  return cache
}

async function persist(file: DevRegistryFile): Promise<void> {
  const path = registryFile()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8')
  await rename(tmp, path)
  cache = file
}

export async function listEntries(): Promise<DevRegistryEntry[]> {
  const file = await load()
  return [...file.apps]
}

export async function lookupByAppId(appId: string): Promise<DevRegistryEntry | undefined> {
  const file = await load()
  return file.apps.find((a) => a.appId === appId)
}

export interface UpsertInput {
  appId: string
  sourceDir: string
  distDir: string
  name: string
}

export async function upsertEntry(input: UpsertInput): Promise<DevRegistryEntry> {
  const file = await load()
  const now = Date.now()
  const idx = file.apps.findIndex((a) => a.appId === input.appId)
  let entry: DevRegistryEntry
  if (idx >= 0) {
    entry = {
      ...file.apps[idx],
      sourceDir: input.sourceDir,
      distDir: input.distDir,
      name: input.name,
      lastSeenAt: now,
    }
    file.apps[idx] = entry
  } else {
    entry = {
      appId: input.appId,
      sourceDir: input.sourceDir,
      distDir: input.distDir,
      name: input.name,
      registeredAt: now,
      lastSeenAt: now,
    }
    file.apps.push(entry)
  }
  await persist(file)
  return entry
}

export async function removeEntry(appId: string): Promise<boolean> {
  const file = await load()
  const idx = file.apps.findIndex((a) => a.appId === appId)
  if (idx < 0) return false
  file.apps.splice(idx, 1)
  await persist(file)
  return true
}

export async function touchLastSeen(appId: string): Promise<void> {
  const file = await load()
  const idx = file.apps.findIndex((a) => a.appId === appId)
  if (idx < 0) return
  file.apps[idx] = { ...file.apps[idx], lastSeenAt: Date.now() }
  await persist(file)
}

export async function sourceDirExists(sourceDir: string): Promise<boolean> {
  try {
    await stat(sourceDir)
    return true
  } catch {
    return false
  }
}

export function _resetCacheForTests(): void {
  cache = null
}

export function _setRegistryFileForTests(absPath: string | null): void {
  testFileOverride = absPath
  cache = null
}
