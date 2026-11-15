import { extensionBrowserForBundle } from '@superone/shared/chrome-browser-apps'
import type { SessionOperationMethods } from '@superone/shared/environment/session-operations'
import { chromeBridgeHub } from '../browser/chrome-bridge-hub'

type Operation = SessionOperationMethods['session.authorizeMentionApps']

/** Grants stay on the host that owns the admitted session. */
export async function authorizeMentionApps(
  sessionId: string, projectPath: string, input: Record<string, unknown>, assertControl: () => void,
): Promise<Operation['result']> {
  const { miniappIds, desktopApps } = input
  if (!Array.isArray(miniappIds) || miniappIds.length > 16 || miniappIds.some(id => typeof id !== 'string' || !id)
    || !Array.isArray(desktopApps) || desktopApps.length > 16
    || desktopApps.some(app => !app || typeof app.bundleId !== 'string' || typeof app.app !== 'string')) {
    throw Object.assign(new Error('Invalid mentioned apps'), { code: 'invalid_argument' })
  }
  assertControl()
  const granted = miniappIds.length
    ? await (await import('../mcp/superone-mcp-server')).authorizeMentionedMiniApps(miniappIds, projectPath, sessionId, assertControl)
    : []
  assertControl()
  const connectedBrowsers = new Set(chromeBridgeHub.browsers())
  const chromeBrowserBundleIds = desktopApps.filter((app) => {
    const browser = extensionBrowserForBundle(app.bundleId)
    return browser != null && connectedBrowsers.has(browser)
  }).map((app) => app.bundleId)
  const computerApps = chromeBrowserBundleIds.length
    ? desktopApps.filter((app) => !chromeBrowserBundleIds.includes(app.bundleId))
    : desktopApps
  let desktopAppsGranted = false
  if (computerApps.length && process.platform === 'darwin') {
    const { grantComputerUseSessionApps } = await import('../computer-use/tools')
    assertControl()
    desktopAppsGranted = grantComputerUseSessionApps(sessionId, computerApps) > 0
  }
  return { miniappIds: granted, desktopAppsGranted, chromeBrowserBundleIds }
}
