/**
 * Resolve a local SuperOne project folder path/name from projectId.
 * Used by chat UI (archive tool blocks, cleanup confirm) so agent payloads
 * only need projectId — path/name come from recentFolders, not tool results.
 */
import type { RecentFolder } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export function resolveProjectPathFromFolders(
  projectId: string | null | undefined,
  folders: RecentFolder[],
): string | null {
  if (!projectId) return null
  return folders.find((f) => f.id === projectId)?.path ?? null
}

export function resolveProjectNameFromFolders(
  projectId: string | null | undefined,
  folders: RecentFolder[],
): string | null {
  if (!projectId) return null
  return folders.find((f) => f.id === projectId)?.name ?? null
}

/** Sync lookup against the in-memory recentFolders cache. */
export function resolveLocalProjectPath(projectId: string | null | undefined): string | null {
  return resolveProjectPathFromFolders(projectId, useAppStore.getState().recentFolders)
}

/**
 * Resolve the folder to open a session in.
 *
 * An explicit projectId that we cannot resolve returns null rather than falling back:
 * opening a foreign session under the active project would load it against the wrong
 * cwd (the "No conversation found" failure mode). The fallback chain only applies to
 * payloads that carry no projectId at all.
 */
export async function resolveProjectPathForOpen(
  projectId: string | null | undefined,
  fallbackPath?: string | null,
): Promise<string | null> {
  if (projectId) {
    const cached = resolveLocalProjectPath(projectId)
    if (cached) return cached
    try {
      await useAppStore.getState().fetchRecentFolders()
    } catch {
      // Fall through — the post-refresh lookup below still decides.
    }
    return resolveLocalProjectPath(projectId)
  }

  return (
    fallbackPath
    ?? useChatStore.getState().activeProject
    ?? useAppStore.getState().currentFolder
    ?? null
  )
}
