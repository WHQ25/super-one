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

/** A stuck node must not hold the rest of the sidebar. Tests pass a shorter value. */
export const ENVIRONMENT_CATALOG_TIMEOUT_MS = 12_000

export interface LoadCatalogInput {
  remoteEnabled: boolean
  localLabel: string
  localFolders: RecentFolderLike[]
  listItems: () => Promise<EnvironmentListItem[]>
  listProjects: (connectionId: string, options?: { refresh?: boolean }) => Promise<ProjectSnapshot[]>
  timeoutMs?: number
  /** Fired as each environment starts loading and again when it settles. */
  onBucket?: (bucket: EnvironmentBucket) => void
}

/**
 * One load at a time. A newer `next()` makes every older ticket report stale,
 * so a slow list cannot overwrite a newer catalog.
 */
export function createCatalogGeneration() {
  let generation = 0
  return {
    next(): { id: number; current: () => boolean } {
      const id = ++generation
      return { id, current: () => id === generation }
    },
    /** Becomes stale when `next()` runs. Does not start a load. */
    watch(): { current: () => boolean } {
      const id = generation
      return { current: () => id === generation }
    },
  }
}

/** The sidebar's one catalog generation. Manual refresh watches this too. */
export const catalogLoads = createCatalogGeneration()

const inflightProjects = new Map<string, Promise<ProjectSnapshot[]>>()

/**
 * One `listProjects` per environment. A reload that arrives while the first
 * call is still pending shares it instead of stacking another RPC on a stuck node.
 */
export function shareProjectLoad(
  connectionId: string,
  load: () => Promise<ProjectSnapshot[]>,
): Promise<ProjectSnapshot[]> {
  const existing = inflightProjects.get(connectionId)
  if (existing) return existing
  const work = load().finally(() => {
    if (inflightProjects.get(connectionId) === work) inflightProjects.delete(connectionId)
  })
  inflightProjects.set(connectionId, work)
  return work
}

/**
 * Write one bucket into the catalog. A loading write keeps the previous
 * checkouts so a reload does not blank the sidebar until the RPC returns.
 */
export function applyCatalogBucket(previous: EnvironmentBucket[], bucket: EnvironmentBucket): EnvironmentBucket[] {
  const index = previous.findIndex((item) => item.environmentId === bucket.environmentId)
  const prior = index >= 0 ? previous[index] : undefined
  const nextBucket = bucket.projectsStatus === 'loading' && prior
    ? { ...bucket, checkouts: prior.checkouts }
    : bucket
  if (index < 0) return [...previous, nextBucket]
  return previous.map((item, i) => (i === index ? nextBucket : item))
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

function acceptsProjectList(connection: EnvironmentBucket['connection']): boolean {
  return connection === 'connected' || connection === 'needs-upgrade'
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('timed out'))
    }, timeoutMs)
    work.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function loadProjects(
  base: Omit<EnvironmentBucket, 'projectsStatus' | 'projectsError' | 'checkouts'>,
  load: () => Promise<ProjectSnapshot[]>,
  fallback: HostCheckout[] | null,
  timeoutMs: number,
  onBucket: LoadCatalogInput['onBucket'],
): Promise<EnvironmentBucket> {
  const loading: EnvironmentBucket = { ...base, projectsStatus: 'loading', projectsError: null, checkouts: [] }
  onBucket?.(loading)
  try {
    const projects = await withTimeout(load(), timeoutMs)
    const ready: EnvironmentBucket = {
      ...base,
      projectsStatus: 'ready',
      projectsError: null,
      checkouts: projects.map((project) => checkoutFromSnapshot(base.environmentId, base.connectionId, project)),
    }
    onBucket?.(ready)
    return ready
  } catch (err) {
    if (fallback) {
      const ready: EnvironmentBucket = { ...base, projectsStatus: 'ready', projectsError: null, checkouts: fallback }
      onBucket?.(ready)
      return ready
    }
    const message = err instanceof Error ? err.message : String(err)
    const failed: EnvironmentBucket = { ...base, projectsStatus: 'error', projectsError: message, checkouts: [] }
    onBucket?.(failed)
    return failed
  }
}

/**
 * One bucket per environment. Only a connected or needs-upgrade host is dialed;
 * offline, disconnected, and connecting stay empty. Remotes load together, each
 * with its own timeout. A local `listProjects` failure falls back to the
 * recent-folder list so the sidebar still has rows, without a repo identity.
 */
export async function loadEnvironmentCatalog(input: LoadCatalogInput): Promise<EnvironmentBucket[]> {
  const timeoutMs = input.timeoutMs ?? ENVIRONMENT_CATALOG_TIMEOUT_MS
  const items = input.remoteEnabled
    ? await withTimeout(input.listItems(), timeoutMs).catch(() => [] as EnvironmentListItem[])
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
    timeoutMs,
    input.onBucket,
  )
  if (!input.remoteEnabled) return [local]

  const remote = await Promise.all(items.filter((item) => item.connectionId !== 'local' && item.kind !== 'local').map(async (item) => {
    const base = bucketBase(item)
    if (!acceptsProjectList(base.connection)) {
      const idle: EnvironmentBucket = { ...base, projectsStatus: 'idle', projectsError: null, checkouts: [] }
      input.onBucket?.(idle)
      return idle
    }
    return loadProjects(base, () => input.listProjects(item.connectionId), null, timeoutMs, input.onBucket)
  }))
  return [local, ...remote]
}
