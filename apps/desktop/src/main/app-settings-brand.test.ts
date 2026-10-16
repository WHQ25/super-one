import { beforeEach, describe, expect, it } from 'vitest'
import { settingsFile } from './app-settings.contract-fixtures'
import { readAppSettings, saveAppSettings } from './app-settings-service'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import type { HarnessId } from '@superone/shared/session-types'

beforeEach(() => { settingsFile.contents = '{}' })

describe('per-harness light and dark brand preferences', () => {
  it.each(Object.keys(HARNESS_DEFAULT_BRAND_HUE) as HarnessId[])(
    'persists only the allowed dark primary override for %s', harness => {
      settingsFile.contents = JSON.stringify({ agentPreference: { [harness]: {
        tokenOverrides: { '--background': { l: 0.9 } },
        darkTokenOverrides: { '--primary': { l: 0.7, c: 0.12, h: 130, a: 0.8 }, '--background': { l: 0.2 } },
      } } })
      const settings = readAppSettings()
      expect(settings.agentPreference[harness].darkTokenOverrides).toEqual({ '--primary': { l: 0.7, c: 0.12, h: 130, a: 0.8 } })
      saveAppSettings({ agentPreference: { [harness]: { darkTokenOverrides: {} } } })
      expect(readAppSettings().agentPreference[harness]).toMatchObject({
        tokenOverrides: { '--background': { l: 0.9 } }, darkTokenOverrides: {},
      })
    },
  )

  it.each(Object.keys(HARNESS_DEFAULT_BRAND_HUE) as HarnessId[])(
    'persists and resets the dark hue independently for %s', (harness) => {
      saveAppSettings({ agentPreference: { [harness]: { brandHue: 40, darkBrandHue: 130 } } })
      expect(readAppSettings().agentPreference[harness]).toMatchObject({ brandHue: 40, darkBrandHue: 130 })
      saveAppSettings({ agentPreference: { [harness]: { darkBrandHue: null } } })
      expect(readAppSettings().agentPreference[harness]).toMatchObject({ brandHue: 40, darkBrandHue: null })
    },
  )

  it('loads old settings without copying the light hue into dark mode', () => {
    settingsFile.contents = JSON.stringify({ agentPreference: { claude: { brandHue: 72 } } })
    expect(readAppSettings().agentPreference.claude).toMatchObject({ brandHue: 72, darkBrandHue: null })
  })

  it.each([[490, 130], [-30, 330], ['red', null], [null, null]])(
    'sanitizes the stored dark hue %s to %s', (value, expected) => {
      settingsFile.contents = JSON.stringify({ agentPreference: { codex: { darkBrandHue: value } } })
      expect(readAppSettings().agentPreference.codex.darkBrandHue).toBe(expected)
    },
  )
})
