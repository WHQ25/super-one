import { projectKey, type ProjectRef } from '@superone/shared/environment'
import { repoIdentityRemote } from '@superone/shared/git-remote-url'
import type { EnvironmentBucket, HostCheckout, SidebarSort } from './types'

export interface ProjectGroup {
  /** Normalized origin, or one checkout's project key when there is no remote. */
  key: string
  name: string
  repoIdentity: string | null
  checkouts: HostCheckout[]
  lastOpened: number
  addedAt: number
}

/** Merge key. Forks stay apart because their origins differ. */
export function checkoutMergeKey(checkout: HostCheckout): string {
  const remote = repoIdentityRemote(checkout.repoIdentity)
  if (remote) return `repo:${remote}`
  return `checkout:${projectKey(checkout.ref)}`
}

function groupName(list: HostCheckout[]): string {
  const local = list.filter((checkout) => checkout.connectionId === 'local')
  const pool = local.length > 0 ? local : list
  return pool.slice().sort((a, b) => b.lastOpened - a.lastOpened || a.name.localeCompare(b.name))[0]!.name
}

/**
 * One row per repository. Checkouts without a git remote, and folders that
 * are not repositories, stay one row per `(environment, path)`.
 */
export function groupCheckoutsByRepo(checkouts: HostCheckout[]): ProjectGroup[] {
  const groups = new Map<string, HostCheckout[]>()
  for (const checkout of checkouts) {
    const key = checkoutMergeKey(checkout)
    const list = groups.get(key)
    if (list) list.push(checkout)
    else groups.set(key, [checkout])
  }
  const result: ProjectGroup[] = []
  for (const [key, list] of groups) {
    const named = list.slice().sort((a, b) => b.lastOpened - a.lastOpened)[0]!
    result.push({
      key,
      name: groupName(list),
      repoIdentity: repoIdentityRemote(named.repoIdentity) ? named.repoIdentity : null,
      checkouts: list,
      lastOpened: Math.max(...list.map((checkout) => checkout.lastOpened)),
      addedAt: Math.min(...list.map((checkout) => checkout.addedAt)),
    })
  }
  return result
}

export function sortProjectGroups(groups: ProjectGroup[], sort: SidebarSort): ProjectGroup[] {
  const copy = groups.slice()
  copy.sort((a, b) => {
    const delta = sort === 'added' ? a.addedAt - b.addedAt : b.lastOpened - a.lastOpened
    if (delta !== 0) return delta
    return a.name.localeCompare(b.name)
  })
  return copy
}

export function sortCheckouts(checkouts: HostCheckout[], sort: SidebarSort): HostCheckout[] {
  const copy = checkouts.slice()
  copy.sort((a, b) => {
    const delta = sort === 'added' ? a.addedAt - b.addedAt : b.lastOpened - a.lastOpened
    if (delta !== 0) return delta
    return a.name.localeCompare(b.name)
  })
  return copy
}

export interface EnvironmentSection {
  bucket: EnvironmentBucket
  checkouts: HostCheckout[]
}

/** Environment mode does not merge across machines. An empty bucket stays visible. */
export function environmentSections(buckets: EnvironmentBucket[], sort: SidebarSort): EnvironmentSection[] {
  return buckets.map((bucket) => ({
    bucket,
    checkouts: sortCheckouts(bucket.checkouts, sort),
  }))
}

export function projectRefKey(ref: ProjectRef): string {
  return projectKey(ref)
}
