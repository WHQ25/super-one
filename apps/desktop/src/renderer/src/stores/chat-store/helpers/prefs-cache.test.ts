/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../app', () => ({
  useAppStore: {
    getState: () => ({ sandboxCapability: null }),
  },
}))

const getAppSettings = vi.fn()
let appSettingsChange: ((data: ReturnType<typeof settings>) => void) | undefined

vi.stubGlobal('window', {
  app: {
    getAppSettings,
    onAppSettingsChange: vi.fn((callback) => {
      appSettingsChange = callback
      return () => { appSettingsChange = undefined }
    }),
  },
})

function settings(defaultPermissionPreset: '' | 'default' | 'full-access', defaultFastMode?: boolean) {
  return {
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset, defaultFastMode },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

getAppSettings.mockResolvedValue(settings('default'))

const { _loadDefaultSessionPrefs, defaultPrefsCache } = await import('./prefs-cache')

beforeEach(async () => {
  await Promise.resolve()
  getAppSettings.mockReset()
  getAppSettings.mockResolvedValue(settings('default'))
  defaultPrefsCache.codexPermissionPreset = 'default'
})

describe('_loadDefaultSessionPrefs', () => {
  it('uses auto-review when no explicit Codex permission preference is stored', async () => {
    getAppSettings.mockResolvedValue(settings(''))

    await _loadDefaultSessionPrefs()

    expect(defaultPrefsCache.codexPermissionPreset).toBe('auto-review')
  })

  it('defaults Codex Fast mode off and reads an explicit enabled preference', async () => {
    getAppSettings.mockResolvedValue(settings('default'))
    await _loadDefaultSessionPrefs()
    expect(defaultPrefsCache.codexSelection?.fastMode).toBe(false)

    getAppSettings.mockResolvedValue(settings('default', true))
    await _loadDefaultSessionPrefs()
    expect(defaultPrefsCache.codexSelection?.fastMode).toBe(true)
  })

  it('refreshes Codex defaults after an agent-applied settings broadcast', () => {
    appSettingsChange?.(settings('full-access', true))

    expect(defaultPrefsCache.codexSelection?.fastMode).toBe(true)
    expect(defaultPrefsCache.codexPermissionPreset).toBe('full-access')
  })

  it('ignores an older settings read that resolves after the latest read', async () => {
    const older = deferred<ReturnType<typeof settings>>()
    const latest = deferred<ReturnType<typeof settings>>()
    getAppSettings
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => latest.promise)

    const olderLoad = _loadDefaultSessionPrefs()
    const latestLoad = _loadDefaultSessionPrefs()

    latest.resolve(settings('full-access'))
    await latestLoad
    older.resolve(settings('default'))
    await olderLoad
    expect(defaultPrefsCache.codexPermissionPreset).toBe('full-access')
  })
})
