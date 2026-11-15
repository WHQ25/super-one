/**
 * macOS Chromium apps. A mentioned app is driven with browser tools
 * (`host: "chrome"`) only when that browser's own extension is connected.
 * Channels without a native host (Chrome Dev, Edge Beta/Dev/Canary, Brave
 * beta/nightly) stay on Computer Use.
 *
 * Chrome, Chrome Beta/Dev/Canary, Chromium, Edge (+ channels), Brave (+ channels), Arc.
 */
import type { ExtensionBrowserId } from './chrome-extension-browsers'

const CHROMIUM_BROWSER_BUNDLE_IDS = new Set([
  'com.google.Chrome',
  'com.google.chrome.beta',
  'com.google.chrome.dev',
  'com.google.chrome.canary',
  'org.chromium.Chromium',
  'com.microsoft.edgemac',
  'com.microsoft.edgemac.Beta',
  'com.microsoft.edgemac.Dev',
  'com.microsoft.edgemac.Canary',
  'com.brave.Browser',
  'com.brave.Browser.beta',
  'com.brave.Browser.nightly',
  'company.thebrowser.Browser',
])

export function isChromiumBrowserBundle(bundleId: string): boolean {
  return CHROMIUM_BROWSER_BUNDLE_IDS.has(bundleId)
}

/** Bundle ids that have a native-messaging host. Other Chromium channels do not. */
const EXTENSION_BROWSER_BY_BUNDLE: Record<string, ExtensionBrowserId> = {
  'com.google.Chrome': 'chrome',
  'com.google.chrome.beta': 'chrome-beta',
  'com.google.chrome.canary': 'chrome-canary',
  'org.chromium.Chromium': 'chromium',
  'com.microsoft.edgemac': 'edge',
  'com.brave.Browser': 'brave',
  'company.thebrowser.Browser': 'arc',
}

export function extensionBrowserForBundle(bundleId: string): ExtensionBrowserId | undefined {
  return EXTENSION_BROWSER_BY_BUNDLE[bundleId]
}

/** Which installed apps the @ menu may offer. */
export type DesktopMentionScope = 'all' | 'chromium' | 'none'

function anyExtensionConnected(chromeBridgeConnected: boolean | readonly string[]): boolean {
  return typeof chromeBridgeConnected === 'boolean' ? chromeBridgeConnected : chromeBridgeConnected.length > 0
}

export function desktopMentionScope(
  computerUseEnabled: boolean,
  chromeBridgeConnected: boolean | readonly string[],
): DesktopMentionScope {
  if (computerUseEnabled) return 'all'
  if (anyExtensionConnected(chromeBridgeConnected)) return 'chromium'
  return 'none'
}

/**
 * `connectedBrowsers` limits scope `chromium` to browsers whose extension is
 * actually connected. Omit it for an older catalog that only has the boolean:
 * any Chromium bundle stays visible.
 */
export function includeDesktopMention(
  bundleId: string,
  scope: DesktopMentionScope,
  connectedBrowsers?: readonly string[],
): boolean {
  if (scope === 'all') return true
  if (scope === 'none') return false
  if (!connectedBrowsers) return isChromiumBrowserBundle(bundleId)
  const browser = extensionBrowserForBundle(bundleId)
  return browser != null && connectedBrowsers.includes(browser)
}

export function formatChromiumBrowserMentionReminder(
  apps: Array<{ name: string; bundleId: string }>,
  provider: string,
): string {
  const prefix = provider === 'codex' ? 'mcp__superone.browser_' : 'mcp__superone__browser_'
  const lines = [
    'User @-mentioned these Chromium browsers. Each one has the SuperOne extension connected, so drive that browser with browser tools and host "chrome". Pass browser set to the id below, or a tab id like "chrome:<browser>:<id>". Do not use computer_* tools for these apps.',
    'Only tabs the user shared from that browser\'s extension, or tabs opened with browser_tabs host:"chrome" for that browser, can be controlled.',
  ]
  const seen = new Set<string>()
  for (const app of apps) {
    if (!app.bundleId || seen.has(app.bundleId)) continue
    seen.add(app.bundleId)
    const browser = extensionBrowserForBundle(app.bundleId)
    const id = browser ? `, browser: "${browser}"` : ''
    lines.push(`- "${app.name || app.bundleId}" (bundleId: ${app.bundleId}${id})`)
  }
  lines.push(`Tools start with "${prefix}".`)
  return `\n\n<superone-chrome-browser-reminder>\n${lines.join('\n')}\n</superone-chrome-browser-reminder>`
}
