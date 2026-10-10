import type { ControlLeaseService } from './control-lease'

/** Trusted host identity of one frontend, derived from IPC or its authenticated pairing. */
export interface ControlActor {
  clientSessionId: string
  /** Phones and local windows share this desktop principal, with separate delegates. */
  holderClientId: string
  delegate: string
  yields: boolean
}

/**
 * Bind every lease operation to the authenticated frontend. Payloads cannot
 * impersonate another delegate, opt into yielding, or release its lease.
 * A routing controller can still use the unbound service for its own delegates.
 */
export function bindControlActor(service: ControlLeaseService, actor: ControlActor) {
  const identity = (clientSessionId: string) => {
    if (clientSessionId !== actor.clientSessionId) {
      throw Object.assign(new Error('control actor mismatch'), { code: 'forbidden' })
    }
    return { holderClientId: actor.holderClientId, delegate: actor.delegate }
  }
  return {
    acquire(input: Parameters<ControlLeaseService['acquire']>[0]) {
      return service.acquire({ ...input, ...identity(input.holderClientId), yields: actor.yields })
    },
    renew(input: Parameters<ControlLeaseService['renew']>[0]) {
      return service.renew({ ...input, ...identity(input.holderClientId) })
    },
    assertValid(input: Parameters<ControlLeaseService['assertValid']>[0]) {
      service.assertValid({ ...input, ...identity(input.holderClientId) })
    },
    release(leaseId: string, generation: string, clientSessionId: string) {
      identity(clientSessionId)
      service.release(leaseId, generation, actor.holderClientId, actor.delegate)
    },
    revoke(resource: Parameters<ControlLeaseService['revoke']>[0]) {
      // Dispatcher rollback only revokes a grant it just made for this actor.
      const lease = service.get(resource)
      if (lease?.holderClientId === actor.holderClientId && lease.delegate === actor.delegate) {
        service.revoke(resource)
      }
    },
  }
}
