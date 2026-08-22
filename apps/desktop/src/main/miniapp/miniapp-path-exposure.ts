import { isAbsolute } from 'path'
import { isPathAtOrWithinAllowed } from '../path-security'
import { getAppBasePath, getAppInstallDir, getUserAppDir } from './miniapp-service'
import { peekMiniAppStoragePaths } from './miniapp-state'

/**
 * Roots a mini-app WebView may hand to the OS (drag-out, reveal-in-folder).
 *
 * The MiniApp Host is trusted Node and can touch anything, but the WebView
 * renders app HTML that may load scripts from manifest-declared domains under
 * CSP. Without this gate a poisoned CDN script could drag `~/.ssh/id_rsa` into
 * another application.
 */
export function appExposableRoots(projectDir: string, appId: string): string[] {
  const roots = [getAppBasePath(appId), getAppInstallDir(appId), getUserAppDir(appId)]
  if (projectDir) roots.push(projectDir)
  const storage = peekMiniAppStoragePaths(projectDir, appId)
  // In a git worktree, workspace storage lives in the main worktree — outside projectDir.
  if (storage) roots.push(storage.workspaceStoragePath, storage.globalStoragePath)
  return [...new Set(roots.filter(Boolean))]
}

/** True when `path` is an absolute path the app is allowed to expose. */
export function isPathExposableByApp(projectDir: string, appId: string, path: string): boolean {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  try {
    return isPathAtOrWithinAllowed(path, appExposableRoots(projectDir, appId))
  } catch {
    return false
  }
}
