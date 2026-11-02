import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useSidebarFocusStore, type SidebarFocus } from '@/components/sidebar/sidebar-focus'
import { writeFocusedSelection } from '@/components/chat/composer-location'
import { parseRemoteProjectKey, projectBelongsToHost } from '@/lib/remote-project-key'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { selectionForNewSession } from '@superone/shared/session-location'

/** Enough of a checkout to open it. The sidebar catalog satisfies this. */
export interface NewSessionCheckoutRef {
  pathKey: string
  projectId: string
}

export interface NewSessionEnvironmentRef {
  environmentId: string
  connectionId: string
  checkouts: NewSessionCheckoutRef[]
}

/**
 * What the new-session page should open from the sidebar focus.
 * No focus keeps the project that is already open.
 */
export interface NewSessionPlan {
  /** Open this project before minting the session. */
  select?: { folderPath: string; connectionId: string; projectId?: string }
  /**
   * The open project is on another machine. Switch to this host first; its
   * default project is where the new session lands.
   */
  hostConnectionId?: string
  /** Execution environment to record on the fresh session. */
  environmentId?: string
}

function checkoutFor(environments: NewSessionEnvironmentRef[], folderPath: string): NewSessionCheckoutRef | undefined {
  for (const bucket of environments) {
    const checkout = bucket.checkouts.find((item) => item.pathKey === folderPath)
    if (checkout) return checkout
  }
  return undefined
}

/**
 * Sidebar focus decides the new session.
 * A project or a session inside one uses that project and its environment.
 * An environment alone uses that machine. The project stays when it already
 * runs there; otherwise the host switch picks that machine's default project.
 */
export function planNewSessionFromFocus(input: {
  focus: SidebarFocus | null
  environments: NewSessionEnvironmentRef[]
  currentFolder: string | null
}): NewSessionPlan {
  const { focus, environments, currentFolder } = input
  if (!focus) return {}

  if (focus.kind === 'environment') {
    const bucket = environments.find((item) => item.environmentId === focus.environmentId)
    if (!bucket) return {}
    if (currentFolder && projectBelongsToHost(currentFolder, bucket.connectionId)) {
      return { environmentId: bucket.environmentId }
    }
    return { hostConnectionId: bucket.connectionId, environmentId: bucket.environmentId }
  }

  const remote = parseRemoteProjectKey(focus.folderPath)
  const bucket = focus.environmentId
    ? environments.find((item) => item.environmentId === focus.environmentId)
    : undefined
  const connectionId = remote?.connectionId ?? bucket?.connectionId ?? 'local'
  const checkout = checkoutFor(environments, focus.folderPath)
  const environmentId = focus.environmentId ?? bucket?.environmentId
  return {
    ...(currentFolder === focus.folderPath ? {} : {
      select: {
        folderPath: focus.folderPath,
        connectionId,
        ...(checkout ? { projectId: checkout.projectId } : {}),
      },
    }),
    ...(environmentId ? { environmentId } : {}),
  }
}

/** True when the fresh session does not already run on `environmentId` at its root. */
export function shouldStampEnvironment(
  owned: { environmentId: string; selection: { kind: string } } | null | undefined,
  environmentId: string | undefined,
  enabled: boolean,
): boolean {
  if (!enabled || !environmentId) return false
  return !owned || owned.environmentId !== environmentId || owned.selection.kind !== 'local'
}

async function resetActiveSessionPane(): Promise<void> {
  const projectPath = useChatStore.getState().activeProject
  const previousSessionId = projectPath
    ? useChatStore.getState().projectSessions[projectPath]?._activeSessionId ?? null
    : null
  await useChatStore.getState().resetSession()
  const afterPath = useChatStore.getState().activeProject
  if (!afterPath) return
  const sessionId = useChatStore.getState().projectSessions[afterPath]?._activeSessionId
  if (sessionId && sessionId !== previousSessionId) {
    useMosaicStore.getState().focusOrReplaceFocused(afterPath, sessionId)
  }
}

function stampFocusedEnvironment(environmentId: string | undefined): void {
  const projectPath = useChatStore.getState().activeProject
  if (!projectPath) return
  const sessionId = useChatStore.getState().projectSessions[projectPath]?._activeSessionId
  const session = sessionId
    ? useChatStore.getState().projectSessions[projectPath]?._sessions[sessionId]
    : undefined
  if (!shouldStampEnvironment(
    session?.environmentSelection,
    environmentId,
    useAppStore.getState().experimentalRemoteNodesEnabled,
  )) return
  writeFocusedSelection(projectPath, selectionForNewSession(environmentId!), {
    cwd: projectPath,
    worktreePath: null,
    gitBranch: null,
  })
}

/** Resolves once the host switch finishes, or once the user has moved to another host. */
function waitForHost(connectionId: string): Promise<void> {
  const settled = (): boolean => {
    const state = useAppStore.getState()
    return state.selectedHostConnectionId !== connectionId || !state.isSwitchingHostProject
  }
  if (settled()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useAppStore.subscribe(() => {
      if (!settled()) return
      unsubscribe()
      resolve()
    })
  })
}

/**
 * Open a new session from the sidebar focus.
 * The project-row button does not use this: that click already names a project.
 */
export async function startNewSessionFromFocus(): Promise<void> {
  const plan = planNewSessionFromFocus({
    focus: useSidebarFocusStore.getState().target,
    environments: useMultiHostSidebarStore.getState().environments,
    currentFolder: useAppStore.getState().currentFolder,
  })

  if (plan.select) {
    await useAppStore.getState().selectProject(plan.select.folderPath, {
      connectionId: plan.select.connectionId,
      projectId: plan.select.projectId,
    })
    if (useAppStore.getState().currentFolder !== plan.select.folderPath) return
  } else if (
    plan.hostConnectionId
    && useAppStore.getState().selectedHostConnectionId !== plan.hostConnectionId
  ) {
    useAppStore.getState().setSelectedHostConnectionId(plan.hostConnectionId)
    await waitForHost(plan.hostConnectionId)
    if (useAppStore.getState().selectedHostConnectionId !== plan.hostConnectionId) return
  }

  await resetActiveSessionPane()
  stampFocusedEnvironment(plan.environmentId)
}
