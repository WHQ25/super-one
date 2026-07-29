import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
  getPath: vi.fn<(name: string) => string>(),
}))

vi.mock('fs', () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { dropMiniAppOrderBucket, readAppSettings, saveAppSettings } from './app-settings-service'

function fileNotFound() {
  const err = new Error('ENOENT') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  throw err
}

describe('app-settings-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPath.mockReturnValue('/mock-user-data')
  })

  const defaultClaude = {
    defaultModel: '',
    defaultEffort: '',
    defaultPermissionMode: '',
    defaultSandboxMode: '',
    brandHue: null,
    tokenOverrides: {},
    disabledSkills: [],
    askUserQuestionPreviewFormat: 'markdown',
  }
  const defaultCodex = {
    defaultModel: '',
    defaultReasoningEffort: '',
    defaultPermissionPreset: '',
    brandHue: null,
    tokenOverrides: {},
  }
  const defaultAcp = {
    enabled: false,
    brandHue: null,
    tokenOverrides: {},
    selectedAgentId: null,
  }
  const defaultSettings = {
    analyticsEnabled: true,
    experimentalAgentsEnabled: false,
    experimentalAgentCollaborationEnabled: false,
    crispText: true,
    locale: '',
    updateChannel: null,
    themeMode: 'system',
    terminalLightPalette: null,
    terminalDarkPalette: null,
    terminalFontSize: 14,
    terminalFontFamily: null,
    uiFontFamily: null,
    liquidGlass: false,
    miniAppOrder: {},
    customAppIconPath: null,
    browserBookmarks: [],
    browserBookmarkGroups: [],
    cdpEnabled: false,
    computerUseEnabled: false,
    computerUseAllowAllApps: false,
    computerUseAlwaysAllowApps: [],
    computerUseVisualIndicators: true,
    cdpCookiesEnabled: false,
    cdpMockEnabled: false,
    cdpEmulateEnabled: false,
    agentPreference: {
      claude: defaultClaude,
      codex: defaultCodex,
      acp: defaultAcp,
    },
  }

  describe('readAppSettings', () => {
    it('returns defaults when file does not exist', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('reads saved settings for both agents', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: false,
        agentPreference: {
          claude: {
            defaultModel: 'claude-sonnet-4-6',
            defaultEffort: 'high',
            defaultPermissionMode: 'acceptEdits',
            defaultSandboxMode: 'off',
          },
          codex: {
            defaultModel: 'gpt-5.4',
            defaultReasoningEffort: 'high',
            defaultPermissionPreset: 'full-access',
          },
        },
      }))
      expect(readAppSettings()).toEqual({
        analyticsEnabled: false,
        experimentalAgentsEnabled: false,
        experimentalAgentCollaborationEnabled: false,
        crispText: true,
        locale: '',
        updateChannel: null,
        themeMode: 'system',
        terminalLightPalette: null,
        terminalDarkPalette: null,
        terminalFontSize: 14,
        terminalFontFamily: null,
        uiFontFamily: null,
        liquidGlass: false,
        miniAppOrder: {},
        customAppIconPath: null,
        browserBookmarks: [],
        browserBookmarkGroups: [],
        cdpEnabled: false,
    computerUseEnabled: false,
    computerUseAllowAllApps: false,
    computerUseAlwaysAllowApps: [],
    computerUseVisualIndicators: true,
        cdpCookiesEnabled: false,
        cdpMockEnabled: false,
        cdpEmulateEnabled: false,
        agentPreference: {
          claude: {
            defaultModel: 'claude-sonnet-4-6',
            defaultEffort: 'high',
            defaultPermissionMode: 'acceptEdits',
            defaultSandboxMode: 'off',
            brandHue: null,
            tokenOverrides: {},
            disabledSkills: [],
            askUserQuestionPreviewFormat: 'markdown',
          },
          codex: {
            defaultModel: 'gpt-5.4',
            defaultReasoningEffort: 'high',
            defaultPermissionPreset: 'full-access',
            brandHue: null,
            tokenOverrides: {},
          },
          acp: defaultAcp,
        },
      })
    })

    it('ignores invalid boolean values and falls back to default', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ analyticsEnabled: 'yes' }))
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('migrates the legacy ACP flag to experimental agents', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        agentPreference: { acp: { enabled: true } },
      }))
      expect(readAppSettings().experimentalAgentsEnabled).toBe(true)
    })

    it('prefers the experimental agents flag over the legacy ACP flag', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        experimentalAgentsEnabled: false,
        agentPreference: { acp: { enabled: true } },
      }))
      expect(readAppSettings().experimentalAgentsEnabled).toBe(false)
    })

    it('ignores invalid claude preference values and falls back to defaults', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          claude: {
            defaultModel: 123,
            defaultEffort: 'bogus',
            defaultPermissionMode: 'unknown',
            defaultSandboxMode: 'nope',
          },
        },
      }))
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('ignores invalid codex preference values and falls back to defaults', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          codex: {
            defaultModel: 123,
            defaultReasoningEffort: 'max',
            defaultPermissionPreset: 'unrestricted',
          },
        },
      }))
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('reads legacy flat codex preference fields for backward compatibility', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: false,
        codexDefaultModel: 'gpt-5.4',
        codexDefaultReasoningEffort: 'low',
      }))
      expect(readAppSettings()).toEqual({
        analyticsEnabled: false,
        experimentalAgentsEnabled: false,
        experimentalAgentCollaborationEnabled: false,
        crispText: true,
        locale: '',
        updateChannel: null,
        themeMode: 'system',
        terminalLightPalette: null,
        terminalDarkPalette: null,
        terminalFontSize: 14,
        terminalFontFamily: null,
        uiFontFamily: null,
        liquidGlass: false,
        miniAppOrder: {},
        customAppIconPath: null,
        browserBookmarks: [],
        browserBookmarkGroups: [],
        cdpEnabled: false,
    computerUseEnabled: false,
    computerUseAllowAllApps: false,
    computerUseAlwaysAllowApps: [],
    computerUseVisualIndicators: true,
        cdpCookiesEnabled: false,
        cdpMockEnabled: false,
        cdpEmulateEnabled: false,
        agentPreference: {
          claude: defaultClaude,
          codex: {
            defaultModel: 'gpt-5.4',
            defaultReasoningEffort: 'low',
            defaultPermissionPreset: '',
            brandHue: null,
            tokenOverrides: {},
          },
          acp: defaultAcp,
        },
      })
    })

    it('returns defaults on corrupt JSON', () => {
      mocks.readFileSync.mockReturnValue('not-json')
      expect(readAppSettings()).toEqual(defaultSettings)
    })
  })

  describe('saveAppSettings', () => {
    it('maps a legacy ACP patch to experimental agents', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      const result = saveAppSettings({ agentPreference: { acp: { enabled: true } } })
      expect(result.experimentalAgentsEnabled).toBe(true)
    })

    it('merges claude patch with existing settings', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          claude: defaultClaude,
          codex: defaultCodex,
        },
      }))

      const result = saveAppSettings({
        agentPreference: {
          claude: {
            defaultModel: 'claude-sonnet-4-6',
            defaultPermissionMode: 'plan',
          },
        },
      })
      expect(result.agentPreference.claude.defaultModel).toBe('claude-sonnet-4-6')
      expect(result.agentPreference.claude.defaultPermissionMode).toBe('plan')
      expect(result.agentPreference.claude.defaultEffort).toBe('')
      expect(result.agentPreference.claude.defaultSandboxMode).toBe('')
      expect(result.agentPreference.codex).toEqual(defaultCodex)
    })

    it('merges codex patch while preserving claude section', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          claude: {
            defaultModel: 'claude-opus-4-8',
            defaultEffort: 'max',
            defaultPermissionMode: 'default',
            defaultSandboxMode: 'on',
          },
          codex: defaultCodex,
        },
      }))

      const result = saveAppSettings({
        agentPreference: {
          codex: { defaultModel: 'gpt-5.4', defaultPermissionPreset: 'read-only' },
        },
      })
      expect(result.agentPreference.claude.defaultModel).toBe('claude-opus-4-8')
      expect(result.agentPreference.codex.defaultModel).toBe('gpt-5.4')
      expect(result.agentPreference.codex.defaultPermissionPreset).toBe('read-only')
    })

    it('creates file with defaults merged when file does not exist', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)

      const result = saveAppSettings({})
      expect(result).toEqual(defaultSettings)
      expect(mocks.writeFileSync).toHaveBeenCalledOnce()
    })

    it('persists disabledSkills round-trip', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)

      saveAppSettings({ agentPreference: { claude: { disabledSkills: ['release', 'loop'] } } })
      const written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)

      const reloaded = readAppSettings()
      expect(reloaded.agentPreference.claude.disabledSkills).toEqual(['release', 'loop'])
    })

    it('rejects non-string entries in disabledSkills on read', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        agentPreference: { claude: { disabledSkills: ['release', 42, null, 'loop'] } },
      }))
      const reloaded = readAppSettings()
      expect(reloaded.agentPreference.claude.disabledSkills).toEqual(['release', 'loop'])
    })

    it('persists per-project miniAppOrder round-trip', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)

      saveAppSettings({ miniAppOrder: { projA: ['weather', 'notes'] } })
      const written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)

      expect(readAppSettings().miniAppOrder).toEqual({ projA: ['weather', 'notes'] })
    })

    it('merges miniAppOrder per project bucket, leaving other projects intact', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ miniAppOrder: { projA: ['x'], projB: ['y'] } }))
      const result = saveAppSettings({ miniAppOrder: { projA: ['x', 'z'] } })
      expect(result.miniAppOrder).toEqual({ projA: ['x', 'z'], projB: ['y'] })
    })

    it('preserves miniAppOrder when an unrelated patch is saved', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ miniAppOrder: { projA: ['a', 'b'] } }))
      const result = saveAppSettings({ analyticsEnabled: false })
      expect(result.miniAppOrder).toEqual({ projA: ['a', 'b'] })
    })

    it('rejects non-string entries within a project bucket on read', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ miniAppOrder: { projA: ['a', 7, null, 'b'] } }))
      expect(readAppSettings().miniAppOrder).toEqual({ projA: ['a', 'b'] })
    })

    it('resets a legacy flat-array miniAppOrder to an empty map', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ miniAppOrder: ['weather', 'notes'] }))
      expect(readAppSettings().miniAppOrder).toEqual({})
    })

    it('dropMiniAppOrderBucket removes only the given project bucket', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ miniAppOrder: { projA: ['a'], projB: ['b'] } }))
      dropMiniAppOrderBucket('projA')
      const written = JSON.parse(mocks.writeFileSync.mock.calls[0][1] as string)
      expect(written.miniAppOrder).toEqual({ projB: ['b'] })
    })

    it('dropMiniAppOrderBucket is a no-op when the project has no bucket', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ miniAppOrder: { projB: ['b'] } }))
      dropMiniAppOrderBucket('projA')
      expect(mocks.writeFileSync).not.toHaveBeenCalled()
    })

    it('persists updateChannel round-trip and accepts each valid value', () => {
      for (const channel of ['alpha', 'beta', 'stable'] as const) {
        mocks.writeFileSync.mockClear()
        mocks.readFileSync.mockImplementation(fileNotFound)
        saveAppSettings({ updateChannel: channel })
        const written = mocks.writeFileSync.mock.calls[0][1] as string
        mocks.readFileSync.mockReturnValue(written)
        expect(readAppSettings().updateChannel).toBe(channel)
      }
    })

    it('falls back to null when stored updateChannel is invalid', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ updateChannel: 'nightly' }))
      expect(readAppSettings().updateChannel).toBeNull()
    })

    it('resets updateChannel back to null when patch passes null', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ updateChannel: 'alpha' }))
      const result = saveAppSettings({ updateChannel: null })
      expect(result.updateChannel).toBeNull()
    })

    it('persists light and dark terminal palettes independently', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      saveAppSettings({ terminalLightPalette: 'tokyo-day', terminalDarkPalette: 'dracula' })
      const written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)
      const reloaded = readAppSettings()
      expect(reloaded.terminalLightPalette).toBe('tokyo-day')
      expect(reloaded.terminalDarkPalette).toBe('dracula')
    })

    it('resets a terminal palette back to null when patch passes null', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ terminalDarkPalette: 'one-dark' }))
      const result = saveAppSettings({ terminalDarkPalette: null })
      expect(result.terminalDarkPalette).toBeNull()
    })

    it('falls back to null when a stored terminal palette is not a string', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ terminalDarkPalette: 42 }))
      expect(readAppSettings().terminalDarkPalette).toBeNull()
    })

    it('persists terminalFontSize round-trip and clamps out-of-range values', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      saveAppSettings({ terminalFontSize: 16 })
      let written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)
      expect(readAppSettings().terminalFontSize).toBe(16)

      mocks.writeFileSync.mockClear()
      saveAppSettings({ terminalFontSize: 200 })
      written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)
      expect(readAppSettings().terminalFontSize).toBe(22)
    })

    it('falls back to default 14 when stored terminalFontSize is invalid', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ terminalFontSize: 'large' }))
      expect(readAppSettings().terminalFontSize).toBe(14)
    })

    it('persists terminal and UI font families independently', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      saveAppSettings({ terminalFontFamily: 'Maple Mono', uiFontFamily: 'MiSans' })
      const written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)
      const reloaded = readAppSettings()
      expect(reloaded.terminalFontFamily).toBe('Maple Mono')
      expect(reloaded.uiFontFamily).toBe('MiSans')
    })

    it('resets a font family to null when patch passes null', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ uiFontFamily: 'MiSans' }))
      expect(saveAppSettings({ uiFontFamily: null }).uiFontFamily).toBeNull()
    })

    it('falls back to null when a stored font family is not a string', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ terminalFontFamily: 123 }))
      expect(readAppSettings().terminalFontFamily).toBeNull()
    })

    it('persists customAppIconPath round-trip', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      saveAppSettings({ customAppIconPath: '/mock-user-data/custom-app-icon.png' })
      const written = mocks.writeFileSync.mock.calls[0][1] as string
      mocks.readFileSync.mockReturnValue(written)
      expect(readAppSettings().customAppIconPath).toBe('/mock-user-data/custom-app-icon.png')
    })

    it('resets customAppIconPath back to null when patch passes null', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ customAppIconPath: '/some/icon.png' }))
      const result = saveAppSettings({ customAppIconPath: null })
      expect(result.customAppIconPath).toBeNull()
    })

    it('falls back to null when stored customAppIconPath is not a string', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ customAppIconPath: 123 }))
      expect(readAppSettings().customAppIconPath).toBeNull()
    })

    it('preserves customAppIconPath when an unrelated patch is saved', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ customAppIconPath: '/some/icon.png' }))
      const result = saveAppSettings({ analyticsEnabled: false })
      expect(result.customAppIconPath).toBe('/some/icon.png')
    })
  })
})
