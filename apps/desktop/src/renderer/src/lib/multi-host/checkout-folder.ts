import type { RecentFolder } from '@superone/shared/agent-types'
import type { HostCheckout } from './types'

/** Legacy `RecentFolder` shape `ProjectSidebarRow` and `selectProject` still take. */
export function checkoutToRecentFolder(checkout: HostCheckout, name = checkout.name): RecentFolder {
  const stamp = (value: number) => new Date(value > 0 ? value : 0).toISOString()
  return {
    id: checkout.projectId,
    path: checkout.pathKey,
    name,
    addedAt: stamp(checkout.addedAt),
    lastOpened: stamp(checkout.lastOpened),
    missing: checkout.missing,
    extraDirs: checkout.extraDirs,
  }
}
