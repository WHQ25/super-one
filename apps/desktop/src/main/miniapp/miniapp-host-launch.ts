import type { MiniAppManifest } from '@superone/shared/miniapp-types'
import { ensureShellPath } from '../shell-path'
import { getAppBasePath, readManifest, validatePath } from './miniapp-service'
import { resolveMiniAppStoragePaths } from './miniapp-state'
import type { MiniAppHostStartArgs } from './miniapp-host'

export interface MiniAppHostLaunch {
  manifest: MiniAppManifest
  basePath: string
  args: MiniAppHostStartArgs
}

/** Read the app's current manifest and build the args its MiniApp Host starts with. */
export async function prepareMiniAppHostLaunch(appId: string, projectDir: string): Promise<MiniAppHostLaunch> {
  const basePath = getAppBasePath(appId)
  const manifest = await readManifest(basePath)
  if (!manifest) throw new Error(`App not found: ${appId}`)
  const entryPath = validatePath(basePath, manifest.main)
  if (!entryPath) throw new Error(`Invalid plugin entry: ${manifest.main}`)
  const storagePaths = await resolveMiniAppStoragePaths(projectDir, appId)
  // The host is long-lived and copies process.env when it forks.
  await ensureShellPath()
  return {
    manifest,
    basePath,
    args: {
      appId,
      projectDir,
      name: manifest.name,
      appPath: basePath,
      entryPath,
      background: manifest.background === true,
      devLogs: manifest.isDev === true,
      ...storagePaths,
    },
  }
}
