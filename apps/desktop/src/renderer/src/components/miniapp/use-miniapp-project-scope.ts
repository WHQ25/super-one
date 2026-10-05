import { useMemo } from 'react'
import { useAppStore } from '@/stores/app'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { miniAppToolTargetId } from '@superone/shared/miniapp-automation-target'
import type { MiniAppTargetRegistration } from './miniapp-automation-targets'

type AppProjects = { currentFolder: string | null; currentProjectId: string | null; recentFolders: Array<{ id: string; path: string }> }

export function projectIdForDir(state: AppProjects, projectDir: string): string | null {
  if (projectDir === state.currentFolder) return state.currentProjectId
  return state.recentFolders.find((folder) => folder.path === projectDir)?.id ?? null
}

/**
 * The project of the chat pane rendering a tool UI. A side pane can show a
 * session of another project than the one selected in the app.
 */
export function useMiniAppProjectScope(): { projectDir: string; projectId: string | null; sessionId?: string } {
  const scope = useSessionScope()
  const scopedDir = scope?.projectPath
  const projectDir = useAppStore((s) => scopedDir ?? s.currentFolder) ?? ''
  const projectId = useAppStore((s) => projectIdForDir(s, projectDir))
  return { projectDir, projectId, ...(scope?.sessionId ? { sessionId: scope.sessionId } : {}) }
}

/** The `browser_*` target of a tool UI in chat, unless the caller supplies its own. */
export function useMiniAppToolTarget(
  appId: string,
  toolUseId: string,
  title: string,
  projectDir: string,
  override: Omit<MiniAppTargetRegistration, 'appId'> | undefined,
): Omit<MiniAppTargetRegistration, 'appId'> | undefined {
  return useMemo(
    () => override ?? (projectDir ? { targetId: miniAppToolTargetId(appId, toolUseId), projectDir, kind: 'tool', title } : undefined),
    [appId, override, projectDir, title, toolUseId],
  )
}
