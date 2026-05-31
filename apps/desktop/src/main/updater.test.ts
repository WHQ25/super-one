import { describe, it, expect, vi, beforeEach } from 'vitest'

let downgradeDuringCheck: boolean | undefined

const autoUpdater = {
  channel: '',
  allowDowngrade: false,
  checkForUpdates: vi.fn(() => {
    downgradeDuringCheck = autoUpdater.allowDowngrade
    return Promise.resolve(null)
  }),
}

vi.mock('electron-updater', () => ({ default: { autoUpdater } }))
vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const { setUpdateChannel } = await import('./updater')

describe('manual update channel switching', () => {
  beforeEach(() => {
    autoUpdater.channel = ''
    autoUpdater.allowDowngrade = false
    downgradeDuringCheck = undefined
    autoUpdater.checkForUpdates.mockClear()
  })

  it('maps the user channel to its electron-builder yml track', () => {
    setUpdateChannel('stable')
    expect(autoUpdater.channel).toBe('latest')
    setUpdateChannel('beta')
    expect(autoUpdater.channel).toBe('beta')
    setUpdateChannel('alpha')
    expect(autoUpdater.channel).toBe('alpha')
  })

  it('allows downgrade during the switch check then resets it afterwards', async () => {
    setUpdateChannel('stable')
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(downgradeDuringCheck).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(autoUpdater.allowDowngrade).toBe(false)
  })
})
