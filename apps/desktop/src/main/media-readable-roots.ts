import { mediaGenRoot } from './media-gen/paths'
import { getReadableAssetRoots } from './path-security'
import { getRecentFolders } from './recent-folders'
import { listWorktreePaths } from './session/session-repo'

/**
 * Roots the chat gallery may stream: project folders, worktrees, Grok/Codex
 * asset dirs, and SuperOne media-gen output under userData.
 *
 * media-server and the local-file protocol must share this list — generated
 * videos live outside any project, and a fallback to local-file:// 403s if
 * userData/media-gen is missing.
 */
export function getMediaReadableRoots(): string[] {
  return getReadableAssetRoots([
    ...getRecentFolders().map((f) => f.path),
    ...listWorktreePaths(),
    mediaGenRoot(),
  ])
}
