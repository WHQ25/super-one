import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface ClaudePreferences {
  outputStyle: string
  defaultPermissionMode: string
  defaultSandboxMode: string
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function readPreferencesFromFile(filePath: string): ClaudePreferences {
  const data = readJsonFile(filePath)
  return {
    outputStyle: typeof data.outputStyle === 'string' ? data.outputStyle : '',
    defaultPermissionMode: typeof data.defaultPermissionMode === 'string' ? data.defaultPermissionMode : '',
    defaultSandboxMode: typeof data.defaultSandboxMode === 'string' ? data.defaultSandboxMode : '',
  }
}

function savePreferencesToFile(filePath: string, preferences: Partial<ClaudePreferences>): ClaudePreferences {
  const data = readJsonFile(filePath)

  for (const key of ['outputStyle', 'defaultPermissionMode', 'defaultSandboxMode'] as const) {
    if (key in preferences) {
      const val = (preferences[key] ?? '').trim()
      if (val) {
        data[key] = val
      } else {
        delete data[key]
      }
    }
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))

  return {
    outputStyle: typeof data.outputStyle === 'string' ? data.outputStyle : '',
    defaultPermissionMode: typeof data.defaultPermissionMode === 'string' ? data.defaultPermissionMode : '',
    defaultSandboxMode: typeof data.defaultSandboxMode === 'string' ? data.defaultSandboxMode : '',
  }
}

export function readUserPreferences(): ClaudePreferences {
  return readPreferencesFromFile(join(homedir(), '.claude', 'settings.json'))
}

export function saveUserPreferences(preferences: Partial<ClaudePreferences>): ClaudePreferences {
  return savePreferencesToFile(join(homedir(), '.claude', 'settings.json'), preferences)
}

export function readProjectPreferences(cwd: string): ClaudePreferences {
  return readPreferencesFromFile(join(cwd, '.claude', 'settings.local.json'))
}

export function saveProjectPreferences(cwd: string, preferences: Partial<ClaudePreferences>): ClaudePreferences {
  return savePreferencesToFile(join(cwd, '.claude', 'settings.local.json'), preferences)
}
