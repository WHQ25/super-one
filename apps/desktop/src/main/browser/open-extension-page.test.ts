import { join } from 'node:path'
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
    expect(installedExtensionBrowserIds('/Users/dev', (path) => present.has(path), 'darwin')).toEqual(['chrome', 'arc'])
  })

  it('detects installed browsers and opens extensions page on Windows', async () => {
    const localAppData = 'C:\\Users\\dev\\AppData\\Local'
    const programFilesX86 = 'C:\\Program Files (x86)'
    const chromeExe = join(localAppData, 'Google\\Chrome\\Application\\chrome.exe')
    const edgeExe = join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe')
    const present = new Set([chromeExe, edgeExe])
    const winRoots = [localAppData, 'C:\\Program Files', programFilesX86]

    expect(installedExtensionBrowserIds('C:\\Users\\dev', (p) => present.has(p), 'win32', winRoots)).toEqual(['chrome', 'edge'])

    const launch = vi.fn(async () => undefined)
    await expect(
      openExtensionBrowserPage('edge', undefined, {
        platform: 'win32',
        exists: (p) => present.has(p),
        winRoots,
        launch,
      }),
    ).resolves.toEqual({ opened: true, url: 'edge://extensions' })
    expect(launch).toHaveBeenCalledWith(edgeExe, 'edge://extensions')
  })
})