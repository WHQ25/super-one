import type { RecentFolder } from '@superone/shared/agent-types'
import type { HostCheckout } from './types'

const folders = new WeakMap<HostCheckout, RecentFolder>()

/**
 * Legacy `RecentFolder` shape `ProjectSidebarRow` and `selectProject` still take.
 * The same checkout and name return the same object, so a memoized row does not
 * render again for a catalog write that left its checkout alone.
 */
export function checkoutToRecentFolder(checkout: HostCheckout, name = checkout.name): RecentFolder {
  const cached = folders.get(checkout)
  if (cached?.name === name) return cached
  const stamp = (value: number) => new Date(value > 0 ? value : 0).toISOString()
  const folder: RecentFolder = {
    id: checkout.projectId,
    path: checkout.pathKey,
    name,
    addedAt: stamp(checkout.addedAt),
    lastOpened: stamp(checkout.lastOpened),
    missing: checkout.missing,
    extraDirs: checkout.extraDirs,
  }
  folders.set(checkout, folder)
  return folder
}
