import type { ProjectRef } from '@superone/shared/environment'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'

/** How the sidebar splits projects. Project mode is the single-host default. */
export type SidebarGroupBy = 'project' | 'environment'

/** Same two orders the sidebar already offers. */
export type SidebarSort = 'recent' | 'added'

/**
 * `local-electron` on a remote connection is another SuperOne desktop.
 * Every other remote profile is a headless CLI node. Missing profile is a
 * CLI node: desktops set `local-electron` explicitly.
 */
export type EnvironmentKind = 'local' | 'cli-node' | 'remote-desktop'

/** What the environment header and the offline row need. Not the supervisor enum. */
export type EnvironmentConnection = 'connected' | 'connecting' | 'offline' | 'needs-upgrade'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** One checkout on one environment. Several of these can be one repository. */
export interface HostCheckout {
  ref: ProjectRef
  environmentId: string
  connectionId: string
  projectId: string
  name: string
  /**
   * Legacy renderer route (`/abs/path` or `remote:<connectionId>:<hostPath>`).
   * `selectProject` still takes this. New code keys off `ref`.
   */
  pathKey: string
  hostPath: string
  repoIdentity: string | null
  addedAt: number
  lastOpened: number
  missing?: boolean
  extraDirs?: string[]
}

/** Projects loaded (or refused) for one environment. */
export interface EnvironmentBucket {
  environmentId: string
  connectionId: string
  label: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  /** How a connected remote is reached right now. Absent for local and while not connected. */
  path?: NodeLinkPath
  projectsStatus: LoadStatus
  projectsError: string | null
  checkouts: HostCheckout[]
}

export interface SidebarSettings {
  groupBy: SidebarGroupBy
  sort: SidebarSort
  /** Path keys and merged `group:` keys the user left open. */
  expandedProjectKeys: string[]
  /**
   * Environments the user collapsed. Empty means every environment is open,
   * which is the default the first time environment mode is shown.
   */
  collapsedEnvironmentIds: string[]
}

export const DEFAULT_SIDEBAR_SETTINGS: SidebarSettings = {
  groupBy: 'project',
  sort: 'recent',
  expandedProjectKeys: [],
  collapsedEnvironmentIds: [],
}
