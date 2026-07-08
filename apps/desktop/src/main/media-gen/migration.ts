import { existsSync, readFileSync } from 'fs'
import { safeStorage } from 'electron'
import type { CustomMediaProvider } from './custom-providers'
import { mediaGenKeysPath } from './paths'
import { MEDIA_PROVIDER_PRESETS } from './presets'
import { join } from 'path'
import { mediaGenRoot } from './paths'

export interface MediaMigrationProvider {
  id: string
  name: string
  kind: string
  baseURL?: string
  models: string[]
  apiKey: string
  apiKeyEnv?: string
}

function readKeysSync(): Record<string, string> {
  const path = mediaGenKeysPath()
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return {}
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(path))) as { version: number; values: Record<string, string> }
    return parsed?.values && typeof parsed.values === 'object' ? parsed.values : {}
  } catch {
    return {}
  }
}

function readCustomSync(): CustomMediaProvider[] {
  const path = join(mediaGenRoot(), 'providers.json')
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CustomMediaProvider[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Synchronously collect legacy media-gen providers (built-in presets with a stored key + custom) for one-time migration into api_providers. */
export function readMediaGenForMigration(): MediaMigrationProvider[] {
  const keys = readKeysSync()
  const result: MediaMigrationProvider[] = []

  for (const preset of MEDIA_PROVIDER_PRESETS) {
    if (!keys[preset.id]) continue
    result.push({
      id: preset.id,
      name: preset.label,
      kind: preset.kind,
      baseURL: preset.defaultBaseURL,
      models: preset.models.map((m) => m.id),
      apiKey: keys[preset.id],
      apiKeyEnv: preset.apiKeyEnv,
    })
  }

  for (const custom of readCustomSync()) {
    result.push({
      id: custom.id,
      name: custom.label,
      kind: custom.kind,
      baseURL: custom.baseURL,
      models: custom.models,
      apiKey: keys[custom.id] ?? '',
    })
  }

  return result
}
