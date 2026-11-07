import type { SessionOperationMethods } from '@superone/shared/environment/session-operations'

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
  let desktopAppsGranted = false
  if (desktopApps.length && process.platform === 'darwin') {
    const { grantComputerUseSessionApps } = await import('../computer-use/tools')
    assertControl()
    desktopAppsGranted = grantComputerUseSessionApps(sessionId, desktopApps) > 0
  }
  return { miniappIds: granted, desktopAppsGranted }
}
