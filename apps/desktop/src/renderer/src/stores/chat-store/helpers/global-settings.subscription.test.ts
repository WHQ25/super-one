/** @vitest-environment jsdom */

import { appSettingCases, readSetting, settingPatch, settingsFile } from '../../../../../main/app-settings.contract-fixtures'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@superone/shared/agent-types'
import { readAppSettings, saveAppSettings } from '../../../../../main/app-settings-service'

const listeners = new Set<(settings: AppSettings) => void>()
let prefs: typeof import('./prefs-cache')
let app: typeof import('../../../stores/app')
const defaults = readAppSettings()
const cases = appSettingCases(defaults)
const mirroredKeys: readonly (keyof AppSettings)[] = [
  'experimentalAgentsEnabled', 'enabledExperimentalAgents', 'experimentalClaudeOpenAiChatEnabled',
  'experimentalRemoteNodesEnabled', 'terminalLightPalette', 'terminalDarkPalette', 'terminalFontSize',
  'terminalFontFamily', 'mermaidLightTheme', 'mermaidDarkTheme', 'uiFontFamily', 'liquidGlass',
  'autoExpandFileDiffs', 'detailChatMode', 'sessionContinuationHint',
]

beforeAll(async () => {
  window.app.onAppSettingsChange = vi.fn((callback) => { listeners.add(callback); return () => listeners.delete(callback) })
  window.app.getAppSettings = vi.fn(async () => readAppSettings())
  app = await import('../../../stores/app')
  prefs = await import('./prefs-cache')
})

beforeEach(async () => {
  settingsFile.contents = '{}'
  await prefs._loadDefaultSessionPrefs()
  for (const listener of listeners) listener(readAppSettings())
})

function publish(settings: AppSettings) {
  // The native IPC boundary delivers the already committed settings snapshot.
  for (const listener of listeners) listener(settings)
}

describe('global settings subscribers', () => {
  it('classifies every global setting also cached by the app store', () => {
    const state = app.useAppStore.getState()
    const cached = Object.keys(defaults).filter(key => Object.hasOwn(state, key) && typeof state[key as keyof typeof state] !== 'function')
    expect(cached.sort()).toEqual([...mirroredKeys].sort())
  })

  it.each(cases.filter(row => row.path.startsWith('agentPreference.')))
    ('updates defaults/theming from $path without reloading preferences', ({ path, patch, value }) => {
      const saved = saveAppSettings(patch)
      publish(saved)
      expect.soft(readSetting(prefs.defaultPrefsCache, path)).toEqual(value)
      const [, harness, key] = path.split('.')
      if (harness === 'claude' && key === 'defaultModel') expect.soft(prefs.defaultPrefsCache.claudeSelection?.modelId).toBe(value)
      if (harness === 'claude' && key === 'defaultEffort') expect.soft(prefs.defaultPrefsCache.claudeSelection?.effort).toBe(value)
      if (harness === 'codex' && key === 'defaultModel') expect.soft(prefs.defaultPrefsCache.codexSelection?.modelId).toBe(value)
      if (harness === 'codex' && key === 'defaultReasoningEffort') expect.soft(prefs.defaultPrefsCache.codexSelection?.reasoningEffort).toBe(value)
      if (harness === 'codex' && key === 'defaultFastMode') expect.soft(prefs.defaultPrefsCache.codexSelection?.fastMode).toBe(value)
      if (key === 'brandHue') expect.soft(app.useAppStore.getState().brandHues[harness as keyof AppSettings['agentPreference']]).toBe(value)
      if (key === 'darkBrandHue') expect.soft(app.useAppStore.getState().darkBrandHues[harness as keyof AppSettings['agentPreference']]).toBe(value)
      if (key === 'darkTokenOverrides') expect.soft(app.useAppStore.getState().darkTokenOverrides[harness as keyof AppSettings['agentPreference']]).toEqual(value)
      if (key === 'tokenOverrides') expect.soft(app.useAppStore.getState().tokenOverrides[harness as keyof AppSettings['agentPreference']]).toEqual(value)
    })

  it.each(cases.filter(row => mirroredKeys.includes(row.path as keyof AppSettings)))
    ('updates mirrored app-store setting $path when its broadcast arrives', ({ path, patch, value }) => {
      publish(saveAppSettings(patch))
      expect(readSetting(app.useAppStore.getState(), path)).toEqual(value)
    })

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    ('keeps supported Codex default effort %s in the subscriber cache', (effort) => {
      const saved = saveAppSettings(settingPatch('agentPreference.codex.defaultReasoningEffort', effort))
      expect(readSetting(readAppSettings(), 'agentPreference.codex.defaultReasoningEffort')).toBe(effort)
      publish(saved)
      expect(prefs.defaultPrefsCache.codexSelection?.reasoningEffort).toBe(effort)
    })
})
