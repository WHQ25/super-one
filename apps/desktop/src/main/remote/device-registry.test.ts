import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createDraftStore, DraftControl } from '@superone/runtime/drafts'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../session/composer-delivery', () => ({ releaseComposerClient: vi.fn() }))

import { mobileModClientId } from '@superone/shared/mod-ui'
import { DeviceRegistry } from './device-registry'
import type { Session, SessionManager } from '../session/types'
import { acquirePhoneControl, controlLeaseAuthority } from '../control-lease.test-fixtures'
import { SessionLease } from '../session/session-lease'
import { releaseComposerClient } from '../session/composer-delivery'

function makeFakeSession(id: string): Session {
  return { id, lease: new SessionLease(id, controlLeaseAuthority()), detachModClient: vi.fn() } as unknown as Session
}

function makeFakeManager(sessions: Session[]): SessionManager {
  return {
    forEachSession(fn) { sessions.forEach(fn) },
  } as unknown as SessionManager
}

describe('DeviceRegistry', () => {
  it('releases authenticated draft and composer ownership for the disconnected phone only', () => {
    const db = new Database(':memory:')
    try {
      const drafts = new DraftControl(createDraftStore(db))
      drafts.save({ id: 'own', text: 'own' }, 'phone:dev-A')
      const other = drafts.save({ id: 'other', text: 'other' }, 'phone:dev-B')
      const registry = new DeviceRegistry(makeFakeManager([]))
      registry.setDraftControl(drafts)
      registry.handleDeviceDisconnected('dev-A')
      expect(drafts.get('own')?.controllerDeviceId).toBeNull()
      expect(() => drafts.assertControl('other', 'phone:dev-B', other.leaseId)).not.toThrow()
      expect(releaseComposerClient).toHaveBeenCalledWith({ kind: 'device', id: 'dev-A' })
    } finally { db.close() }
  })

  it('detaches the disconnected device\'s mod client from every session', () => {
    const s1 = makeFakeSession('s1')
    const registry = new DeviceRegistry(makeFakeManager([s1]))

    registry.handleDeviceDisconnected('dev-A')

    expect(s1.detachModClient).toHaveBeenCalledWith(mobileModClientId('dev-A'))
  })

  it('releases only the disconnected authenticated delegate at the domain authority', () => {
    const authority = controlLeaseAuthority()
    const s1 = makeFakeSession('s1'), s2 = makeFakeSession('s2')
    s1.lease.bind(authority); s2.lease.bind(authority)
    acquirePhoneControl(authority, 's1', 'dev-A')
    const other = acquirePhoneControl(authority, 's2', 'dev-B')
    const registry = new DeviceRegistry(makeFakeManager([s1, s2]))
    registry.handleDeviceDisconnected('dev-A')
    expect(s1.lease.current).toBeNull()
    expect(s2.lease.current).toEqual(other)
  })
  it('leaves another device proof intact when an unknown device leaves', () => {
    const authority = controlLeaseAuthority()
    const session = makeFakeSession('s1')
    session.lease.bind(authority)
    const grant = acquirePhoneControl(authority, 's1', 'dev-A')
    new DeviceRegistry(makeFakeManager([session])).handleDeviceDisconnected('dev-X')
    expect(session.lease.current).toEqual(grant)
  })
})
