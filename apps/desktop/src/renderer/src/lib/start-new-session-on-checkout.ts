import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { writeFocusedSelection } from '@/components/chat/composer-location'
import { shouldStampEnvironment } from '@/lib/new-session-from-focus'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { useAppStore } from '@/stores/app'
import { isRemoteSession, useChatStore } from '@/stores/chat'
import { isUnsentSession } from '@/stores/chat-store/helpers/session-liveness'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { selectionForNewSession } from '@superone/shared/session-location'

/** Catalog fields needed to open the checkout a sidebar button named. */
export interface NewSessionCatalog {
  environmentId: string
  connectionId: string
  checkouts?: readonly {
    pathKey: string
    projectId?: string
    environmentId?: string
    connectionId?: string
  }[]
}

/** Where a sidebar New Session click should land. */
export interface NewSessionCheckoutTarget {
  pathKey: string
  connectionId: string
  projectId?: string
  /** Catalog environment id, not the connection id embedded in a remote path. */
  environmentId: string
}

/**
 * The checkout a New Session button named.
 * A local path stays on this machine even when another host is selected.
 * The catalog environment id wins over the connection id inside a remote key.
 */
export function checkoutTargetForNewSession(
  folderPath: string,
  environments: readonly NewSessionCatalog[],
  knownProjectId?: string,
): NewSessionCheckoutTarget {
  for (const bucket of environments) {
    const checkout = bucket.checkouts?.find((item) => item.pathKey === folderPath)
    if (!checkout) continue
    const projectId = checkout.projectId || knownProjectId
    return {
      pathKey: checkout.pathKey,
      connectionId: checkout.connectionId || bucket.connectionId,
      ...(projectId ? { projectId } : {}),
      environmentId: checkout.environmentId || bucket.environmentId,
    }
  }
  const remote = parseRemoteProjectKey(folderPath)
  if (remote) {
    const bucket = environments.find((item) => item.connectionId === remote.connectionId)
    return {
      pathKey: folderPath,
      connectionId: remote.connectionId,
      ...(knownProjectId ? { projectId: knownProjectId } : {}),
      environmentId: bucket?.environmentId ?? remote.connectionId,
    }
  }
  const local = environments.find((item) => item.connectionId === 'local')
  return {
    pathKey: folderPath,
    connectionId: 'local',
    ...(knownProjectId ? { projectId: knownProjectId } : {}),
    environmentId: local?.environmentId ?? 'local',
  }
}

function activeSessionId(projectPath: string | null): string | null {
  if (!projectPath) return null
  return useChatStore.getState().projectSessions[projectPath]?._activeSessionId ?? null
}

/** True when the open composer is still a new-session page, typed text included. */
function isNewSessionPage(projectPath: string | null, sessionId: string | null): boolean {
  if (!projectPath || !sessionId) return false
  const chat = useChatStore.getState()
  const session = chat.projectSessions[projectPath]?._sessions[sessionId]
  if (!isUnsentSession(session) || session.hostSessionOwned) return false
  if (isRemoteSession(chat, projectPath, sessionId)) return false
  return useCodexRealtimeViewStore.getState().sessions[sessionId]?.hasTimeline !== true
}

function stampCheckoutEnvironment(environmentId: string): void {
  const projectPath = useChatStore.getState().activeProject
  if (!projectPath) return
  const sessionId = activeSessionId(projectPath)
  const session = sessionId
    ? useChatStore.getState().projectSessions[projectPath]?._sessions[sessionId]
    : undefined
  if (!shouldStampEnvironment(
    session?.environmentSelection,
    environmentId,
    useAppStore.getState().experimentalRemoteNodesEnabled,
  )) return
  writeFocusedSelection(projectPath, selectionForNewSession(environmentId), {
    cwd: projectPath,
    worktreePath: null,
    gitBranch: null,
  })
  useAppStore.getState().setActiveWorktree(projectPath, null)
}

/**
 * Create a session on the checkout a sidebar button named.
 * An open new-session page switches onto that project and environment.
 * A started conversation gets a fresh session there instead.
 */
export async function startNewSessionOnCheckout(
  folderPath: string,
  knownProjectId?: string,
): Promise<void> {
  const target = checkoutTargetForNewSession(
    folderPath,
    useMultiHostSidebarStore.getState().environments,
    knownProjectId,
  )
  const fromPath = useChatStore.getState().activeProject
  const fromSessionId = activeSessionId(fromPath)
  const retarget = isNewSessionPage(fromPath, fromSessionId) && fromPath !== target.pathKey

  await useAppStore.getState().selectProject(target.pathKey, {
    connectionId: target.connectionId,
    ...(target.projectId ? { projectId: target.projectId } : {}),
    ...(retarget ? { carryOpenDraft: true } : {}),
  })
  if (useChatStore.getState().activeProject !== target.pathKey) return

  const path = target.pathKey
  const landedSessionId = activeSessionId(path)
  if (!isNewSessionPage(path, landedSessionId)) {
    await useChatStore.getState().resetSession()
  }
  stampCheckoutEnvironment(target.environmentId)

  const sessionId = activeSessionId(path)
  if (sessionId && (sessionId !== fromSessionId || path !== fromPath)) {
    useMosaicStore.getState().focusOrReplaceFocused(path, sessionId)
  }
}
