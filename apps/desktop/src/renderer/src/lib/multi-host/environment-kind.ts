import type { EnvironmentListItem, InstallationProfile } from '@superone/shared/environment'
import type { EnvironmentConnection, EnvironmentKind } from './types'

export function environmentKindOf(item: {
  kind?: 'local' | 'remote'
  installationProfile?: InstallationProfile
}): EnvironmentKind {
  if (item.kind !== 'remote') return 'local'
  if (item.installationProfile === 'local-electron') return 'remote-desktop'
  return 'cli-node'
}

/**
 * Offline wins over "needs upgrade": a disconnected node cannot be selected.
 * `desired: false` is an explicit disconnect and stays offline even if a stale
 * supervisor snapshot still says connected.
 */
export function connectionOf(item: Pick<EnvironmentListItem, 'state' | 'desired' | 'nodeUpgrade'>): EnvironmentConnection {
  if (item.desired === false) return 'offline'
  if (item.state === 'offline' || item.state === 'disconnected' || item.state === 'blocked') return 'offline'
  const live = item.state === 'connected' || item.state === 'synchronizing'
  if (item.nodeUpgrade && live) return 'needs-upgrade'
  if (live) return 'connected'
  return 'connecting'
}

/** Group-by and the environment dropdown appear only when another machine is listed. */
export function multiHostChromeVisible(
  remoteEnabled: boolean,
  buckets: Array<{ connectionId: string }>,
): boolean {
  return remoteEnabled && buckets.some((bucket) => bucket.connectionId !== 'local')
}
