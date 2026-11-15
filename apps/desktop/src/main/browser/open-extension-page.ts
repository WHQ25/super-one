import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  EXTENSION_BROWSERS,
  appleScriptOpenLocation,
  extensionBrowserById,
  type ExtensionBrowserId,
} from '@superone/shared/chrome-extension-browsers'

const execFileAsync = promisify(execFile)

export interface OpenExtensionPageResult {
  opened: boolean
  url: string
}

/**
 * Launch Services will not open chrome://, edge://, or brave:// URLs, and
 * `open -a --args` drops the URL when the browser is already running.
 * AppleScript `open location` reaches a running browser. The first success
 * may ask the user to let SuperOne control that browser.
 */
async function runOsascript(script: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Opening an extensions page is only supported on macOS')
  await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 20_000 })
}

export async function openExtensionBrowserPage(
  browserId: string,
  run: (script: string) => Promise<void> = runOsascript,
): Promise<OpenExtensionPageResult> {
  const browser = extensionBrowserById(browserId)
  if (!browser) return { opened: false, url: '' }
  try {
    await run(appleScriptOpenLocation(browser.appName, browser.extensionsUrl))
    return { opened: true, url: browser.extensionsUrl }
  } catch {
    return { opened: false, url: browser.extensionsUrl }
  }
}

/** Browsers whose .app is in /Applications or the user's Applications folder. */
export function installedExtensionBrowserIds(
  home = homedir(),
  exists: (path: string) => boolean = existsSync,
): ExtensionBrowserId[] {
  return EXTENSION_BROWSERS.filter((browser) =>
    [`/Applications/${browser.appFile}`, join(home, 'Applications', browser.appFile)].some((path) => exists(path)),
  ).map((browser) => browser.id)
}
