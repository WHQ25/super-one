import log from '../logger'
import type { MiniAppHostLaunch } from './miniapp-host-launch'

interface AuthorizationDeps {
  prepare(appId: string, projectDir: string): Promise<MiniAppHostLaunch>
  start(args: MiniAppHostLaunch['args']): unknown
  register(appId: string, launch: MiniAppHostLaunch): void
  markNeedsRebuild(): void
}

/** A receipt names only apps whose tools were actually registered on this session. */
export async function authorizeMiniAppTools(
  appIds: string[],
  projectDir: string,
  sessionId: string,
  deps: AuthorizationDeps,
): Promise<string[]> {
  if (!Array.isArray(appIds) || !sessionId) return []
  const granted: string[] = []
  for (const appId of new Set(appIds)) {
    if (typeof appId !== 'string' || !appId) continue
    try {
      const launch = await deps.prepare(appId, projectDir)
      deps.start(launch.args)
      deps.register(appId, launch)
      if (launch.manifest.tools?.length) granted.push(appId)
    } catch (error) {
      log.warn('[miniapp-authorize] cannot register appId=%s sid=%s: %s', appId, sessionId, error)
    }
  }
  if (granted.length) deps.markNeedsRebuild()
  return granted
}
