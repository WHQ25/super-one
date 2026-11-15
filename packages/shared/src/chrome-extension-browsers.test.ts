import { describe, expect, it } from 'vitest'
import {
  EXTENSION_BROWSERS,
  appleScriptOpenLocation,
  browserIdFromAppPath,
  extensionBrowserById,
  extensionConnectionBrowser,
  isExtensionBrowserId,
} from './chrome-extension-browsers'

describe('extension browsers', () => {
  it('gives each browser the extensions page it actually serves', () => {
    expect(extensionBrowserById('chrome')?.extensionsUrl).toBe('chrome://extensions')
    expect(extensionBrowserById('edge')?.extensionsUrl).toBe('edge://extensions')
    expect(extensionBrowserById('brave')?.extensionsUrl).toBe('brave://extensions')
    expect(extensionBrowserById('arc')?.extensionsUrl).toBe('chrome://extensions')
    expect(extensionBrowserById('missing')).toBeUndefined()
  })

  it('quotes the application name and the url for AppleScript', () => {
    expect(appleScriptOpenLocation('Microsoft Edge', 'edge://extensions')).toBe(
      'tell application "Microsoft Edge" to open location "edge://extensions"',
    )
  })

  it('recognizes only catalog ids', () => {
    expect(isExtensionBrowserId('chrome-beta')).toBe(true)
    expect(isExtensionBrowserId('safari')).toBe(false)
    expect(EXTENSION_BROWSERS).toHaveLength(7)
  })

  it('names the browser from its .app path and leaves other channels unnamed', () => {
    expect(browserIdFromAppPath('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe('chrome')
    expect(browserIdFromAppPath('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary')).toBe('chrome-canary')
    expect(browserIdFromAppPath('/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta')).toBe('chrome-beta')
    expect(browserIdFromAppPath('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper')).toBe('chrome')
    expect(browserIdFromAppPath('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')).toBe('edge')
    expect(browserIdFromAppPath('/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta')).toBeUndefined()
    expect(browserIdFromAppPath('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')).toBe('brave')
    expect(browserIdFromAppPath('/Applications/Brave Browser Beta.app/Contents/MacOS/Brave Browser Beta')).toBeUndefined()
    expect(browserIdFromAppPath('/Applications/Arc.app/Contents/MacOS/Arc')).toBe('arc')
    expect(browserIdFromAppPath('/Applications/Chromium.app/Contents/MacOS/Chromium')).toBe('chromium')
    expect(browserIdFromAppPath('/Applications/Safari.app/Contents/MacOS/Safari')).toBeUndefined()
    expect(extensionConnectionBrowser('edge')).toBe('edge')
    expect(extensionConnectionBrowser('safari')).toBe('unknown')
    expect(extensionConnectionBrowser(undefined)).toBe('unknown')
  })
})
