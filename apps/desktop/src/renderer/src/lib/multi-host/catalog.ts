import type { EnvironmentListItem, ProjectSnapshot } from '@superone/shared/environment'
import { projectRef } from '@superone/shared/environment'
import { remoteProjectKey } from '@superone/shared/remote-resource-key'
import { connectionOf, environmentKindOf } from './environment-kind'
import type { EnvironmentBucket, HostCheckout } from './types'

export interface RecentFolderLike {
  id: string
  path: string
  name: string
  addedAt?: string
  lastOpened?: string
  missing?: boolean
  extraDirs?: string[]
}

export interface LoadCatalogInput {
  remoteEnabled: boolean
  localLabel: string
  localFolders: RecentFolderLike[]
  listItems: () => Promise<EnvironmentListItem[]>
  listProjects: (connectionId: string, options?: { refresh?: boolean }) => Promise<ProjectSnapshot[]>
}

function timeOf(iso: string | undefined): number {
  if (!iso) return 0
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : 0
}

export function checkoutFromSnapshot(
  environmentId: string,
  connectionId: string,
  project: ProjectSnapshot,
): HostCheckout {
  const hostPath = project.path
  return {
    ref: projectRef(environmentId, project.projectId),
    environmentId,
    connectionId,
    projectId: project.projectId,
    name: project.name,
    pathKey: connectionId === 'local' ? hostPath : remoteProjectKey(connectionId, hostPath),
    hostPath,
    repoIdentity: project.repoIdentity ?? null,
    addedAt: project.openedAt ?? project.lastActiveAt ?? 0,
    lastOpened: project.lastActiveAt ?? project.openedAt ?? 0,
    missing: project.missing,
    extraDirs: project.extraDirs,
  }
}

export function checkoutsFromRecent(folders: RecentFolderLike[], environmentId: string): HostCheckout[] {
  return folders.map((folder) => ({
    ref: projectRef(environmentId, folder.id),
    environmentId,
    connectionId: 'local',
    projectId: folder.id,
    name: folder.name,
    pathKey: folder.path,
    hostPath: folder.path,
    repoIdentity: null,
    addedAt: timeOf(folder.addedAt),
    lastOpened: timeOf(folder.lastOpened),
    missing: folder.missing,
    extraDirs: folder.extraDirs,
  }))
}

function bucketBase(
  item: Pick<EnvironmentListItem, 'environmentId' | 'connectionId' | 'label' | 'kind' | 'installationProfile' | 'state' | 'desired' | 'nodeUpgrade'>,
): Omit<EnvironmentBucket, 'projectsStatus' | 'projectsError' | 'checkouts'> {
  return {
    environmentId: item.environmentId || item.connectionId,
    connectionId: item.connectionId,
    label: item.label,
    kind: environmentKindOf(item),
    connection: item.connectionId === 'local' ? 'connected' : connectionOf(item),
  }
}

async function loadProjects(
  base: Omit<EnvironmentBucket, 'projectsStatus' | 'projectsError' | 'checkouts'>,
  load: () => Promise<ProjectSnapshot[]>,
  fallback: HostCheckout[] | null,
): Promise<EnvironmentBucket> {
  try {
    const projects = await load()
    return {
      ...base,
      projectsStatus: 'ready',
      projectsError: null,
      checkouts: projects.map((project) => checkoutFromSnapshot(base.environmentId, base.connectionId, project)),
    }
  } catch (err) {
    if (fallback) {
      return { ...base, projectsStatus: 'ready', projectsError: null, checkouts: fallback }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ...base, projectsStatus: 'error', projectsError: message, checkouts: [] }
  }
}

/**
 * One bucket per environment. Remote hosts that are offline or explicitly
 * disconnected are not dialed. A local `listProjects` failure falls back to
 * the recent-folder list so the sidebar still has rows, without a repo identity.
 */
export async function loadEnvironmentCatalog(input: LoadCatalogInput): Promise<EnvironmentBucket[]> {
  const items = input.remoteEnabled
    ? await input.listItems().catch(() => [] as EnvironmentListItem[])
    : []
  const localItem = items.find((item) => item.connectionId === 'local' || item.kind === 'local')
  const localId = localItem?.environmentId || 'local'
  const localBase = {
    environmentId: localId,
    connectionId: 'local',
    label: localItem?.label || input.localLabel,
    kind: 'local' as const,
    connection: 'connected' as const,
  }
  const local = await loadProjects(
    localBase,
    () => input.listProjects('local'),
    checkoutsFromRecent(input.localFolders, localId),
  )
  if (!input.remoteEnabled) return [local]

  const remote: EnvironmentBucket[] = []
  for (const item of items) {
    if (item.connectionId === 'local' || item.kind === 'local') continue
    const base = bucketBase(item)
    if (base.connection === 'offline') {
      remote.push({ ...base, projectsStatus: 'idle', projectsError: null, checkouts: [] })
      continue
    }
    remote.push(await loadProjects(
      base,
      () => input.listProjects(item.connectionId),
      null,
    ))
  }
  return [local, ...remote]
}
