import { execFile, spawn } from 'node:child_process'
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

const WIN32_BROWSER_RELATIVES: Record<ExtensionBrowserId, readonly string[]> = {
  chrome: ['Google\\Chrome\\Application\\chrome.exe'],
  'chrome-beta': ['Google\\Chrome Beta\\Application\\chrome.exe'],
  'chrome-canary': ['Google\\Chrome SxS\\Application\\chrome.exe'],
  chromium: ['Chromium\\Application\\chrome.exe'],
  edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
  brave: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
  arc: ['Microsoft\\WindowsApps\\Arc.exe'],
}

export function windowsBrowserRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
}

export function findWindowsBrowserExecutable(
  id: ExtensionBrowserId,
  exists: (path: string) => boolean = existsSync,
  roots: string[] = windowsBrowserRoots(),
): string | undefined {
  for (const root of roots) {
    for (const rel of WIN32_BROWSER_RELATIVES[id]) {
      const candidate = join(root, rel)
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

async function runOsascript(script: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Opening an extensions page is only supported on macOS')
  await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 20_000 })
}

async function launchDetached(exe: string, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, [url], { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function openExtensionBrowserPage(
  browserId: string,
  run?: (script: string) => Promise<void>,
  opts?: {
    platform?: NodeJS.Platform
    exists?: (path: string) => boolean
    winRoots?: string[]
    launch?: (exe: string, url: string) => Promise<void>
  },
): Promise<OpenExtensionPageResult> {
  const browser = extensionBrowserById(browserId)
  if (!browser) return { opened: false, url: '' }
  const platform = opts?.platform ?? process.platform
  try {
    if (run) {
      await run(appleScriptOpenLocation(browser.appName, browser.extensionsUrl))
      return { opened: true, url: browser.extensionsUrl }
    }
    if (platform === 'darwin') {
      await runOsascript(appleScriptOpenLocation(browser.appName, browser.extensionsUrl))
      return { opened: true, url: browser.extensionsUrl }
    }
    if (platform === 'win32') {
      const exe = findWindowsBrowserExecutable(browser.id, opts?.exists, opts?.winRoots)
      if (!exe) return { opened: false, url: browser.extensionsUrl }
      await (opts?.launch ?? launchDetached)(exe, browser.extensionsUrl)
      return { opened: true, url: browser.extensionsUrl }
    }
    return { opened: false, url: browser.extensionsUrl }
  } catch {
    return { opened: false, url: browser.extensionsUrl }
  }
}

export function installedExtensionBrowserIds(
  home = homedir(),
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
  winRoots: string[] = windowsBrowserRoots(),
): ExtensionBrowserId[] {
  if (platform === 'win32') {
    return EXTENSION_BROWSERS.filter((browser) => findWindowsBrowserExecutable(browser.id, exists, winRoots) !== undefined)
      .map((browser) => browser.id)
  }
  return EXTENSION_BROWSERS.filter((browser) =>
    [`/Applications/${browser.appFile}`, join(home, 'Applications', browser.appFile)].some((path) => exists(path)),
  ).map((browser) => browser.id)
}
