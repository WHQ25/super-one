import { app } from 'electron'
import { join } from 'node:path'
import { builtInCaptureRoots } from './media-output-paths'
import { mediaFileGrants } from './media-file-grants'
import { mediaGenOutputRoot } from './media-gen/paths'
import { getReadableAssetRoots, isPathWithinAllowed } from './path-security'
import { getRecentFolders } from './recent-folders'
import { listWorktreePaths } from './session/session-repo'

/**
 * Roots the chat gallery may stream: project folders, worktrees, Grok/Codex
 * asset dirs, generated media under userData, and the temp capture roots.
 *
 * media-server and the local-file protocol must share this list — generated
 * media, screenshots and action recordings live outside any project, and a
 * fallback to local-file:// 403s if any root is missing.
 */
export function getMediaReadableRoots(): string[] {
  return getReadableAssetRoots([
    // Workspace folders too: a generated image living under one is otherwise
    // 403'd by both the media server and the local-file protocol.
    ...getRecentFolders().flatMap((f) => [f.path, ...(f.extraDirs ?? [])]),
    ...listWorktreePaths(),
    mediaGenOutputRoot(),
    ...builtInCaptureRoots(),
    // Read-only: recordings were written here before they moved to the temp
    // root, and saved transcripts still link them by absolute path.
    legacyActionRecordingRoot(),
  ])
}

export function isMediaPathReadable(path: string): boolean {
  return isPathWithinAllowed(path, getMediaReadableRoots()) || mediaFileGrants().has(path)
}

/** Where `adoptActionRecording` wrote until 2026-09; nothing writes here any more. */
export function legacyActionRecordingRoot(): string {
  return join(app.getPath('userData'), 'recordings')
}
