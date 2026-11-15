import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ sessionChromeCookieBrowser: vi.fn(async () => null as string | null) }))
const chrome = vi.hoisted(() => ({
  chromeHostDownload: vi.fn(async () => ({
    path: '/Users/me/Downloads/a.txt',
    filename: 'a.txt',
    bytes: 1,
    mimeType: 'text/plain',
    state: 'completed' as const,
  })),
}))

vi.mock('./browser-automation-bridge', () => bridge)
vi.mock('./chrome-browser', () => chrome)

import { downloadThroughUserChrome } from './chrome-url-download'

describe('downloadThroughUserChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridge.sessionChromeCookieBrowser.mockResolvedValue(null)
  })

  it('leaves the built-in cookie jar alone when Chrome is not the only browser', async () => {
    await expect(downloadThroughUserChrome({
      sessionId: 'sess-1',
      url: 'https://x.test/a.txt',
      filename: 'a.txt',
    })).resolves.toBeNull()
    expect(chrome.chromeHostDownload).not.toHaveBeenCalled()
  })

  it('asks Chrome for the file and strips a directory from the name', async () => {
    bridge.sessionChromeCookieBrowser.mockResolvedValue('edge')
    await downloadThroughUserChrome({
      sessionId: 'sess-1',
      url: 'https://x.test/a.txt',
      filename: 'nested/../a.txt',
    })
    expect(chrome.chromeHostDownload).toHaveBeenCalledWith('https://x.test/a.txt', 'a.txt', 'edge')
  })
})
