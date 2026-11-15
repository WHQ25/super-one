import { chromeHostDownload, type ChromeHostDownload } from './chrome-browser'
import { sessionChromeCookieBrowser } from './browser-automation-bridge'

function chromeRelativeName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const base = name.split(/[/\\]/).pop()?.replace(/^\.+/, '').slice(0, 180)
  return base || undefined
}

/**
 * Fetch a URL with the user's Chrome cookies when that is the only browser
 * this session is driving. Returns null so the caller keeps the built-in
 * browser's cookie jar.
 */
export async function downloadThroughUserChrome(opts: {
  sessionId?: string | null
  url: string
  filename?: string
}): Promise<ChromeHostDownload | null> {
  if (!opts.sessionId) return null
  const browser = await sessionChromeCookieBrowser(opts.sessionId)
  if (!browser) return null
  return chromeHostDownload(opts.url, chromeRelativeName(opts.filename), browser)
}
