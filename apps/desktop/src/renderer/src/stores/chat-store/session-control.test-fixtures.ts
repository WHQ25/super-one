import type { ControlLease } from '@superone/shared/environment'
export function sessionControlLeaseFixture(sessionId: string, delegate = 'phone:test'): ControlLease {
  return { resource: { environmentId: 'desktop', sessionId }, delegate, holderClientId: 'desktop:desktop',
    leaseId: `lease:${sessionId}`, generation: '1', expiresAt: new Date(Date.now() + 60_000).toISOString() }
}
