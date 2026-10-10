import type { ProjectSnapshot } from '@superone/shared/environment'

/**
 * What the workspace services need of a host's projects: the CLI node's
 * `ProjectRegistry`, or a desktop's recent folders.
 */
export interface WorkspaceProjects {
  get(projectId: string): ProjectSnapshot | null
  /** The project was just used (recency ordering). */
  touch(projectId: string): void
}
