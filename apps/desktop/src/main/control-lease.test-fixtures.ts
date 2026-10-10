import { afterEach } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '@superone/runtime/db'
import { bindControlActor, ControlLeaseService } from '@superone/runtime/lease'
import type { SessionLeaseAuthority } from './session/session-lease'

const authorities: Array<{ db: NodeDatabase; leases: ControlLeaseService }> = []
afterEach(() => { for (const { db, leases } of authorities.splice(0)) { leases.dispose(); db.close() } })

export function controlLeaseAuthority(): SessionLeaseAuthority {
  const db = openNodeDatabase(':memory:')
  const leases = new ControlLeaseService(db)
  authorities.push({ db, leases })
  return { environmentId: 'env', leases }
}

export function acquirePhoneControl(authority: SessionLeaseAuthority, sessionId: string, deviceId: string) {
  const actor = `phone:${deviceId}`
  return bindControlActor(authority.leases, { clientSessionId: actor, holderClientId: `desktop:${authority.environmentId}`,
    delegate: actor, yields: false }).acquire({ resource: { environmentId: authority.environmentId, sessionId }, holderClientId: actor, ttlMs: 60_000 })
}
