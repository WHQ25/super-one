import { actionRecordingDir } from './agent/action-recording-store'
import { mediaGenRoot } from './media-gen/paths'
import { getReadableAssetRoots } from './path-security'
import { getRecentFolders } from './recent-folders'
import { listWorktreePaths } from './session/session-repo'

/**
 * Roots the chat gallery may stream: project folders, worktrees, Grok/Codex
 * asset dirs, and SuperOne-owned media under userData.
 *
 * media-server and the local-file protocol must share this list — generated
 * media and action recordings live outside any project, and a fallback to
 * local-file:// 403s if either root is missing.
 */
export function getMediaReadableRoots(): string[] {
  return getReadableAssetRoots([
    // Workspace folders too: a generated image living under one is otherwise
    // 403'd by both the media server and the local-file protocol.
    ...getRecentFolders().flatMap((f) => [f.path, ...(f.extraDirs ?? [])]),
    ...listWorktreePaths(),
    mediaGenRoot(),
    actionRecordingDir(),
  ])
}
