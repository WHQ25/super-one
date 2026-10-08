import { join } from 'node:path'
import type { VariantId } from '../variant'

/**
 * On-disk layout of the node surface this desktop serves to other devices.
 * It lives under the app's userData so each side-by-side app (stable, alpha,
 * dev) is its own node with its own identity, pairings and event log.
 */
export function desktopNodeHostPaths(userDataDir: string) {
  const nodeHome = join(userDataDir, 'node-host')
  return {
    /** Identity (`environment-id`, `secrets/instance.key`) — runtime `loadOrCreateIdentity`. */
    nodeHome,
    /** Pairings, client sessions, idempotency receipts, control leases, durable event log. */
    db: join(nodeHome, 'node.db'),
    /** Node agent settings (`settings.get`, create-time defaults). */
    configJson: join(nodeHome, 'config.json'),
  }
}

/**
 * Default port per app, distinct from the CLI node's (7788 / 7790) so a CLI
 * node and every desktop variant can serve on one machine at once.
 */
const DEFAULT_PORTS: Record<VariantId, number> = { stable: 7791, alpha: 7792, dev: 7793 }

export function defaultDesktopNodePort(variant: VariantId): number {
  return DEFAULT_PORTS[variant]
}

export const DESKTOP_NODE_LOOPBACK_HOST = '127.0.0.1'
