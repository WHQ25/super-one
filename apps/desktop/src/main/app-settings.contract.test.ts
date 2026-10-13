import { appSettingCases, readSetting, settingPatch, settingsFile } from './app-settings.contract-fixtures'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@superone/shared/agent-types'
import { dropMiniAppOrderBucket, onAppSettingsSaved, readAppSettings, saveAppSettings } from './app-settings-service'
import { interfaceSettingKeys } from '../test/fixtures/settings-contract-schema'

const defaults = readAppSettings()
const cases = appSettingCases(defaults)
beforeEach(() => { settingsFile.contents = '{}' })

describe('all global app settings', () => {
  it('includes every root settings field in the persistence contract', async () => {
    const source = await readFile(new URL('../../../../packages/shared/src/agent-types.ts', import.meta.url), 'utf8')
    expect(Object.keys(defaults).sort()).toEqual(interfaceSettingKeys(source, 'AppSettings'))
  })

  it.each(cases)('preserves $path through save response and a fresh authoritative read', ({ path, patch, value }) => {
    const saved = saveAppSettings(patch)
    expect.soft(readSetting(saved, path)).toEqual(value)
    expect.soft(readSetting(readAppSettings(), path)).toEqual(value)
    // An unrelated write must not roll the setting back to a default.
    saveAppSettings(path === 'terminalFontSize' ? { liquidGlass: true } : { terminalFontSize: 16 })
    expect.soft(readSetting(readAppSettings(), path)).toEqual(value)
  })

  it.each(cases.filter(row => row.initial === null || typeof row.initial === 'boolean' || Array.isArray(row.initial)))
    ('preserves explicit reset/false/empty for $path', ({ path, patch, initial }) => {
      saveAppSettings(patch)
      const saved = saveAppSettings(settingPatch(path, initial))
      expect.soft(readSetting(saved, path)).toEqual(initial)
      expect.soft(readSetting(readAppSettings(), path)).toEqual(initial)
    })
})

describe('global app settings notifications', () => {
  const stops: (() => void)[] = []
  afterEach(() => { for (const stop of stops.splice(0)) stop() })
  function observe(listener: (settings: AppSettings) => void = () => {}) {
    const seen = vi.fn(listener)
    stops.push(onAppSettingsSaved(seen))
    return seen
  }

  it.each(cases)('announces the committed $path to subscribers', ({ path, patch, value }) => {
    const seen = observe()
    saveAppSettings(patch)
    expect(seen).toHaveBeenCalledOnce()
    expect(readSetting(seen.mock.calls[0][0], path)).toEqual(value)
  })

  it('announces a write before the writer runs follow-up side effects that can fail', () => {
    const seen = observe()
    const applyWithFailingSideEffect = () => {
      saveAppSettings({ liquidGlass: true })
      throw new Error('side effect failed')
    }
    expect(applyWithFailingSideEffect).toThrow('side effect failed')
    expect(seen).toHaveBeenCalledOnce()
    expect(seen.mock.calls[0][0].liquidGlass).toBe(true)
  })

  it('keeps the write and later subscribers when one subscriber fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    observe(() => { throw new Error('subscriber failed') })
    const seen = observe()
    expect(saveAppSettings({ terminalFontSize: 18 }).terminalFontSize).toBe(18)
    expect(readAppSettings().terminalFontSize).toBe(18)
    expect(seen).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('announces bucket removal written outside the patch path', () => {
    saveAppSettings({ miniAppOrder: { contract: ['app-one'] } })
    const seen = observe()
    dropMiniAppOrderBucket('contract')
    expect(seen).toHaveBeenCalledOnce()
    expect(seen.mock.calls[0][0].miniAppOrder).toEqual({})
  })
})
