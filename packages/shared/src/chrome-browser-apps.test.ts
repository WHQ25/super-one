import { describe, expect, it } from 'vitest'
import {
  desktopMentionScope,
  extensionBrowserForBundle,
  formatChromiumBrowserMentionReminder,
  includeDesktopMention,
  isChromiumBrowserBundle,
} from './chrome-browser-apps'
import { parseUserMentions } from './user-mention-parser'

describe('chromium browser mentions', () => {
  it('recognizes the browsers the native host is installed for', () => {
    expect(isChromiumBrowserBundle('com.google.Chrome')).toBe(true)
    expect(isChromiumBrowserBundle('com.microsoft.edgemac')).toBe(true)
    expect(isChromiumBrowserBundle('com.brave.Browser')).toBe(true)
    expect(isChromiumBrowserBundle('company.thebrowser.Browser')).toBe(true)
    expect(isChromiumBrowserBundle('org.chromium.Chromium')).toBe(true)
    expect(isChromiumBrowserBundle('com.apple.Safari')).toBe(false)
  })

  it('offers every desktop app when Computer Use is on, and only Chromium browsers when the extension is connected', () => {
    expect(desktopMentionScope(true, true)).toBe('all')
    expect(desktopMentionScope(true, false)).toBe('all')
    expect(desktopMentionScope(false, true)).toBe('chromium')
    expect(desktopMentionScope(false, false)).toBe('none')
    expect(desktopMentionScope(false, ['edge'])).toBe('chromium')
    expect(desktopMentionScope(false, [])).toBe('none')
    expect(includeDesktopMention('com.apple.Safari', 'chromium')).toBe(false)
    expect(includeDesktopMention('com.google.Chrome', 'chromium')).toBe(true)
    expect(includeDesktopMention('com.google.Chrome', 'chromium', ['chrome'])).toBe(true)
    expect(includeDesktopMention('company.thebrowser.Browser', 'chromium', ['chrome'])).toBe(false)
    expect(includeDesktopMention('com.microsoft.edgemac.Beta', 'chromium', ['edge'])).toBe(false)
    expect(includeDesktopMention('com.apple.Safari', 'none')).toBe(false)
    expect(extensionBrowserForBundle('com.microsoft.edgemac')).toBe('edge')
    expect(extensionBrowserForBundle('com.google.chrome.dev')).toBeUndefined()
  })

  it('tells the agent to use browser tools and stays out of the user bubble', () => {
    const reminder = formatChromiumBrowserMentionReminder(
      [{ name: 'Google Chrome', bundleId: 'com.google.Chrome' }],
      'claude',
    )
    expect(reminder).toContain('host "chrome"')
    expect(reminder).toContain('browser: "chrome"')
    expect(reminder).toContain('mcp__superone__browser_')
    expect(reminder).toContain('com.google.Chrome')
    const stored = `open this${reminder}`
    expect(parseUserMentions(stored).map((segment) => segment.type === 'text' ? segment.text : segment.kind).join('')).toBe('open this')
  })
})
