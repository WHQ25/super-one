import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface ClaudePreferences {
  outputStyle: string
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
  }
}

function savePreferencesToFile(filePath: string, preferences: ClaudePreferences): ClaudePreferences {
  const data = readJsonFile(filePath)
  const outputStyle = preferences.outputStyle.trim()

  if (outputStyle) {
    data.outputStyle = outputStyle
  } else {
    delete data.outputStyle
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))

  return { outputStyle }
}

export function readUserPreferences(): ClaudePreferences {
  return readPreferencesFromFile(join(homedir(), '.claude', 'settings.json'))
}

export function saveUserPreferences(preferences: ClaudePreferences): ClaudePreferences {
  return savePreferencesToFile(join(homedir(), '.claude', 'settings.json'), preferences)
}

export function readProjectPreferences(cwd: string): ClaudePreferences {
  return readPreferencesFromFile(join(cwd, '.claude', 'settings.local.json'))
}

export function saveProjectPreferences(cwd: string, preferences: ClaudePreferences): ClaudePreferences {
  return savePreferencesToFile(join(cwd, '.claude', 'settings.local.json'), preferences)
}
