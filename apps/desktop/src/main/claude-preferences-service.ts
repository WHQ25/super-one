import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { ClaudePreferences } from '@superone/shared/agent-types'

export type { ClaudePreferences }

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
  }
}

function savePreferencesToFile(filePath: string, preferences: Partial<ClaudePreferences>): ClaudePreferences {
  const data = readJsonFile(filePath)

  if ('outputStyle' in preferences) {
    const val = (preferences.outputStyle ?? '').trim()
    if (val) {
      data.outputStyle = val
    } else {
      delete data.outputStyle
    }
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))

  return {
    outputStyle: typeof data.outputStyle === 'string' ? data.outputStyle : '',
  }
}

export function readProjectPreferences(cwd: string): ClaudePreferences {
  return readPreferencesFromFile(join(cwd, '.claude', 'settings.local.json'))
}

export function saveProjectPreferences(cwd: string, preferences: Partial<ClaudePreferences>): ClaudePreferences {
  return savePreferencesToFile(join(cwd, '.claude', 'settings.local.json'), preferences)
}
