/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../app', () => ({
  useAppStore: {
    getState: () => ({ sandboxCapability: null }),
  },
}))

const getAppSettings = vi.fn()

vi.stubGlobal('window', {
  app: { getAppSettings },
})

function settings(defaultPermissionPreset: 'default' | 'full-access') {
  return {
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset },
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
