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

import { readAppSettings, saveAppSettings } from './app-settings-service'

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

  describe('readAppSettings', () => {
    it('returns defaults when file does not exist', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      expect(readAppSettings()).toEqual({ analyticsEnabled: true })
    })

    it('reads saved settings', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ analyticsEnabled: false }))
      expect(readAppSettings()).toEqual({ analyticsEnabled: false })
    })

    it('ignores invalid boolean values and falls back to default', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ analyticsEnabled: 'yes' }))
      expect(readAppSettings()).toEqual({ analyticsEnabled: true })
    })

    it('returns defaults on corrupt JSON', () => {
      mocks.readFileSync.mockReturnValue('not-json')
      expect(readAppSettings()).toEqual({ analyticsEnabled: true })
    })
  })

  describe('saveAppSettings', () => {
    it('merges patch with existing settings', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ analyticsEnabled: true }))

      const result = saveAppSettings({ analyticsEnabled: false })
      expect(result).toEqual({ analyticsEnabled: false })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/mock-user-data/app-settings.json',
        JSON.stringify({ analyticsEnabled: false }, null, 2),
      )
    })

    it('creates file with defaults merged when file does not exist', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)

      const result = saveAppSettings({})
      expect(result).toEqual({ analyticsEnabled: true })
      expect(mocks.writeFileSync).toHaveBeenCalledOnce()
    })
  })
})
