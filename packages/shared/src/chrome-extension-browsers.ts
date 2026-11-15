/**
 * Browsers that receive the SuperOne native-messaging host and can load the
 * unpacked extension. `appName` is the macOS application name used to open
 * the extensions page. `appFile` is the usual .app name under Applications.
 */
export const EXTENSION_BROWSERS = [
  { id: 'chrome', label: 'Chrome', appName: 'Google Chrome', appFile: 'Google Chrome.app', extensionsUrl: 'chrome://extensions' },
  { id: 'chrome-beta', label: 'Chrome Beta', appName: 'Google Chrome Beta', appFile: 'Google Chrome Beta.app', extensionsUrl: 'chrome://extensions' },
  { id: 'chrome-canary', label: 'Canary', appName: 'Google Chrome Canary', appFile: 'Google Chrome Canary.app', extensionsUrl: 'chrome://extensions' },
  { id: 'chromium', label: 'Chromium', appName: 'Chromium', appFile: 'Chromium.app', extensionsUrl: 'chrome://extensions' },
  { id: 'edge', label: 'Edge', appName: 'Microsoft Edge', appFile: 'Microsoft Edge.app', extensionsUrl: 'edge://extensions' },
  { id: 'brave', label: 'Brave', appName: 'Brave Browser', appFile: 'Brave Browser.app', extensionsUrl: 'brave://extensions' },
  { id: 'arc', label: 'Arc', appName: 'Arc', appFile: 'Arc.app', extensionsUrl: 'chrome://extensions' },
] as const

export type ExtensionBrowserId = (typeof EXTENSION_BROWSERS)[number]['id']

export type ExtensionBrowser = (typeof EXTENSION_BROWSERS)[number]

export function extensionBrowserById(id: string): ExtensionBrowser | undefined {
  return EXTENSION_BROWSERS.find((browser) => browser.id === id)
}

export function isExtensionBrowserId(id: string): id is ExtensionBrowserId {
  return extensionBrowserById(id) !== undefined
}

/**
 * Which catalog browser a native-host parent process belongs to.
 * Matches the `.app` bundle name, so "Google Chrome Helper.app" does not
 * count as Chrome and "Microsoft Edge Beta.app" does not count as Edge.
 * Keep the names in sync with `browserIdFromAppPath` in
 * `apps/desktop/resources/chrome-native-host/host.mjs`.
 */
const APP_BUNDLE_IDS: ReadonlyArray<readonly [string, ExtensionBrowserId]> = [
  ['google chrome canary.app', 'chrome-canary'],
  ['google chrome beta.app', 'chrome-beta'],
  ['google chrome.app', 'chrome'],
  ['chromium.app', 'chromium'],
  ['microsoft edge.app', 'edge'],
  ['brave browser.app', 'brave'],
  ['arc.app', 'arc'],
]

export function browserIdFromAppPath(command: string): ExtensionBrowserId | undefined {
  const names: string[] = []
  const pattern = /([^/\\]+)\.app(?=[/\\]|$)/gi
  for (const match of command.matchAll(pattern)) {
    const name = match[1]
    if (name) names.push(`${name.toLowerCase()}.app`)
  }
  for (const name of names) {
    for (const [needle, id] of APP_BUNDLE_IDS) {
      if (name === needle) return id
    }
  }
  return undefined
}

/** Browser id from the native host's auth frame. Anything else stays off the Chrome slot. */
export function extensionConnectionBrowser(value: unknown): ExtensionBrowserId | 'unknown' {
  return typeof value === 'string' && isExtensionBrowserId(value) ? value : 'unknown'
}

/** AppleScript that opens one fixed extensions URL. Names come from the catalog, not user input. */
export function appleScriptOpenLocation(appName: string, url: string): string {
  return `tell application ${appleString(appName)} to open location ${appleString(url)}`
}

function appleString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
