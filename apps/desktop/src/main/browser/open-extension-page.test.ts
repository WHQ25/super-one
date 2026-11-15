import { describe, expect, it, vi } from 'vitest'
import { installedExtensionBrowserIds, openExtensionBrowserPage } from './open-extension-page'

describe('open extension page', () => {
  it('asks Edge to open edge://extensions', async () => {
    const run = vi.fn(async () => undefined)
    await expect(openExtensionBrowserPage('edge', run)).resolves.toEqual({
      opened: true,
      url: 'edge://extensions',
    })
    expect(run).toHaveBeenCalledWith('tell application "Microsoft Edge" to open location "edge://extensions"')
  })

  it('keeps the address when the browser does not open', async () => {
    await expect(openExtensionBrowserPage('brave', async () => {
      throw new Error('not allowed')
    })).resolves.toEqual({ opened: false, url: 'brave://extensions' })
  })

  it('rejects an unknown browser without a url', async () => {
    const run = vi.fn(async () => undefined)
    await expect(openExtensionBrowserPage('safari', run)).resolves.toEqual({ opened: false, url: '' })
    expect(run).not.toHaveBeenCalled()
  })

  it('reports browsers installed in the usual Applications folders', () => {
    const present = new Set([
      '/Applications/Google Chrome.app',
      '/Users/dev/Applications/Arc.app',
    ])
    expect(installedExtensionBrowserIds('/Users/dev', (path) => present.has(path))).toEqual(['chrome', 'arc'])
  })
})