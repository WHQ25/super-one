import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { bindControlActor } from './control-actor'
import { ControlLeaseService } from './control-lease'

const dbs: NodeDatabase[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })

describe('authenticated control actors', () => {
  it.each([{ environmentId: 'env', sessionId: 's' }, { environmentId: 'env', terminalId: 't' }])('fences two phones and a window on %j', (resource) => {
    const db = openNodeDatabase(':memory:')
    dbs.push(db)
    const service = new ControlLeaseService(db)
    const bind = (clientSessionId: string, delegate: string, yields = false) => bindControlActor(service, {
      clientSessionId, holderClientId: 'desktop:env', delegate, yields,
    })
    const window = bind('ipc:1', 'window:1', true)
    const a = bind('phone:a', 'phone:a')
    const b = bind('phone:b', 'phone:b')
    const local = window.acquire({ resource, holderClientId: 'ipc:1' })
    const remote = a.acquire({ resource, holderClientId: 'phone:a', delegate: 'phone:b', yields: true })
    expect(remote).toMatchObject({ holderClientId: 'desktop:env', delegate: 'phone:a' })
    expect(() => window.assertValid({ ...local, holderClientId: 'ipc:1' })).toThrow()
    expect(() => b.acquire({ resource, holderClientId: 'phone:b' })).toThrow('another device')
    expect(() => b.assertValid({ ...remote, holderClientId: 'phone:b' })).toThrow('delegate mismatch')
    expect(() => b.renew({ ...remote, holderClientId: 'phone:b' })).toThrow('delegate mismatch')
    expect(() => b.release(remote.leaseId, remote.generation, 'phone:b')).toThrow()
    b.revoke(resource)
    expect(service.get(resource)).toEqual(remote)
    expect(() => a.acquire({ resource, holderClientId: 'phone:b' })).toThrow('actor mismatch')
    a.release(remote.leaseId, remote.generation, 'phone:a')
    const returned = window.acquire({ resource, holderClientId: 'ipc:1' })
    expect(Number(returned.generation)).toBeGreaterThan(Number(remote.generation))
  })
})
