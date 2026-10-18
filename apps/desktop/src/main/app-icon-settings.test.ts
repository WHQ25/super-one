import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dev: true, valid: true, size: 100, handlers: new Map<string, (...args: unknown[]) => unknown>(),
  save: vi.fn((patch: unknown) => patch), store: vi.fn(() => '/stored/icon.png'), clear: vi.fn(), apply: vi.fn(),
  png: Buffer.from('png'), windows: [{ id: 1 }],
}))
vi.mock('node:fs', () => ({ statSync: () => ({ size: mocks.size }) }))
vi.mock('@electron-toolkit/utils', () => ({ is: { get dev() { return mocks.dev } } }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mocks.windows },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (name: string, callback: (...args: unknown[]) => unknown) => mocks.handlers.set(name, callback) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => !mocks.valid, toPNG: () => mocks.png }), createFromBuffer: () => ({ isEmpty: () => !mocks.valid }) },
}))
vi.mock('./app-settings-service', () => ({ saveAppSettings: mocks.save }))
vi.mock('./app-icon', () => ({ storeCustomIcon: mocks.store, clearStoredCustomIcons: mocks.clear, applyAppIcon: mocks.apply }))
vi.mock('./i18n', () => ({ t: (key: string) => key }))

import { AgentIpcChannels } from '@superone/shared/agent-types'
import { registerAppIconIpc, setAppIconFile } from './app-icon-settings'

describe('custom icon settings effects', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.dev = true; mocks.valid = true; mocks.size = 100; mocks.handlers.clear() })
  it('shares persistence and native icon updates between the UI and file proposals', async () => {
    await setAppIconFile('/tmp/icon.jpg')
    expect(mocks.store).toHaveBeenCalledWith(mocks.png)
    expect(mocks.save).toHaveBeenCalledWith({ customAppIconPath: '/stored/icon.png' })
    expect(mocks.apply).toHaveBeenCalledWith('/stored/icon.png', mocks.windows)
    registerAppIconIpc(() => ({} as never))
    mocks.handlers.get(AgentIpcChannels.APP_ICON_RESET)!(undefined)
    expect(mocks.clear).toHaveBeenCalledTimes(1)
    expect(mocks.apply).toHaveBeenLastCalledWith(null, mocks.windows)
    mocks.handlers.get(AgentIpcChannels.APP_ICON_SET)!(undefined, 'data:image/png;base64,cG5n')
    expect(mocks.store).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid and oversized images before replacing a stored icon', async () => {
    mocks.valid = false
    await expect(setAppIconFile('/tmp/broken.png')).rejects.toThrow('Cannot decode')
    mocks.valid = true; mocks.size = 11 * 1024 * 1024
    await expect(setAppIconFile('/tmp/huge.png')).rejects.toThrow('10 MB')
    expect(mocks.store).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('fails closed in packaged builds, including direct calls', async () => {
    mocks.dev = false
    registerAppIconIpc(() => ({} as never))
    expect(mocks.handlers.size).toBe(0)
    await expect(setAppIconFile(null)).rejects.toThrow('development builds only')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
