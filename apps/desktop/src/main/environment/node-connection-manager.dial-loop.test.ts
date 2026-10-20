import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeConnectionManager, type ResolvedNodeRoute } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'

vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('NodeConnectionManager dial loop', () => {
  it('does not mark a route failed after the dial is disposed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'superone-dial-'))
    dirs.push(dir)
    const connectionId = 'c1'
    const store = new NodeCredentialStore(dir)
    store.save({
      connectionId,
      environmentId: 'env-b',
      nodePublicKeyFingerprint: 'fp',
      clientSessionId: 's1',
      devicePrivateKeyPem: 'priv',
      devicePublicKeyPem: 'pub',
      refreshToken: 'refresh',
      baseUrl: 'http://127.0.0.1:9',
      label: 'b',
      updatedAt: 1,
    })
    let release!: (route: ResolvedNodeRoute) => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => { started = resolve })
    const onRouteFailed = vi.fn()
    const manager = new NodeConnectionManager({
      credentialStore: store,
      loadKnownEnvironments: () => [{
        connectionId,
        environmentId: 'env-b',
        nodePublicKeyFingerprint: 'fp',
        label: 'b',
        endpointProfiles: [{ endpointId: 'lan', kind: 'direct-wss', label: 'lan', target: 'http://127.0.0.1:9' }],
        desired: true,
        createdAt: 1,
        updatedAt: 1,
      }],
      resolveReconnectRoute: () => {
        started()
        return new Promise((resolve) => { release = resolve })
      },
      onRouteFailed,
    })
    const pending = manager.connectExisting(connectionId)
    await gate
    manager.disconnect(connectionId)
    release({ baseUrl: 'http://127.0.0.1:1', path: 'lan', endpointId: 'lan' })
    await expect(pending).rejects.toThrow()
    expect(onRouteFailed).not.toHaveBeenCalled()
  })
})
