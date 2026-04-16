import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AppSettings } from '../shared/agent-types'

export type { AppSettings }

const defaults: AppSettings = {
  analyticsEnabled: true,
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

export function readAppSettings(): AppSettings {
  try {
    const data = JSON.parse(readFileSync(getSettingsPath(), 'utf-8'))
    return {
      analyticsEnabled: typeof data.analyticsEnabled === 'boolean' ? data.analyticsEnabled : defaults.analyticsEnabled,
    }
  } catch {
    return { ...defaults }
  }
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const current = readAppSettings()
  const merged = { ...current, ...patch }
  writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2))
  return merged
}
