import { useCallback, useState } from 'react'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { parseRemoteProjectKey, projectBelongsToHost } from '@superone/shared/remote-resource-key'
import { projectFocusPaths } from '@/lib/multi-host/project-focus'
import type { HostCheckout } from '@/lib/multi-host/types'
import type { SidebarFocus } from './sidebar-focus'

interface FocusEnvironment {
  environmentId: string
  connectionId: string
  connection: string
  checkouts?: HostCheckout[]
}

/** Pinned and drafts stay with an environment or project. A session focus hides both. */
export function focusContextKey(focus: SidebarFocus | null): string | null {
  if (!focus || focus.kind === 'session') return null
  if (focus.kind === 'project') return `project:${focus.folderPath}`
  return `environment:${focus.environmentId}`
}

export function pinnedSessionsForFocus(
  sessions: PinnedSessionEntry[],
  focus: SidebarFocus,
  environments: FocusEnvironment[],
): PinnedSessionEntry[] {
  if (focus.kind === 'session') return []
  if (focus.kind === 'project') {
    const paths = new Set(projectFocusPaths(focus.folderPath, environments))
    return sessions.filter((session) => paths.has(session.folderPath))
  }
  const bucket = environments.find((item) => item.environmentId === focus.environmentId)
  if (!bucket) return []
  return sessions.filter((session) => projectBelongsToHost(session.folderPath, bucket.connectionId))
}

export function draftScopeForFocus(
  focus: SidebarFocus,
  environments: FocusEnvironment[],
): { connectionIds: string[]; projectKey?: string; projectKeys?: string[]; offlineConnectionIds: string[] } | null {
  if (focus.kind === 'session') return null
  if (focus.kind === 'project') {
    const paths = projectFocusPaths(focus.folderPath, environments)
    if (paths.length > 1) {
      const connectionIds = [...new Set(paths.map((path) => parseRemoteProjectKey(path)?.connectionId ?? 'local'))]
      return {
        connectionIds,
        projectKeys: paths,
        offlineConnectionIds: environments.filter((item) => connectionIds.includes(item.connectionId) && item.connection === 'offline').map((item) => item.connectionId),
      }
    }
    const remote = parseRemoteProjectKey(focus.folderPath)
    const connectionId = remote?.connectionId
      ?? environments.find((item) => item.environmentId === focus.environmentId)?.connectionId
      ?? 'local'
    const offline = environments.some((item) => item.connectionId === connectionId && item.connection === 'offline')
    return {
      connectionIds: [connectionId],
      projectKey: focus.folderPath,
      offlineConnectionIds: offline ? [connectionId] : [],
    }
  }
  const bucket = environments.find((item) => item.environmentId === focus.environmentId)
  if (!bucket) return { connectionIds: [], offlineConnectionIds: [] }
  return {
    connectionIds: [bucket.connectionId],
    offlineConnectionIds: bucket.connection === 'offline' ? [bucket.connectionId] : [],
  }
}

/** Focus groups start folded, and fold again when the focused object changes. */
export function useFocusContextCollapsed(key: string | null): {
  pinned: boolean
  drafts: boolean
  togglePinned: () => void
  toggleDrafts: () => void
} {
  const [state, setState] = useState({ key, pinned: true, drafts: true })
  if (state.key !== key) setState({ key, pinned: true, drafts: true })
  const togglePinned = useCallback(() => {
    setState((current) => ({ ...current, pinned: !current.pinned }))
  }, [])
  const toggleDrafts = useCallback(() => {
    setState((current) => ({ ...current, drafts: !current.drafts }))
  }, [])
  return { pinned: state.pinned, drafts: state.drafts, togglePinned, toggleDrafts }
}
