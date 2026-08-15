import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateIdentity } from './identity'
import { startNodeServer, type NodeAuthPort, type NodeServerHandle } from './node-server'

const dirs: string[] = []
const servers: NodeServerHandle[] = []

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()
    if (s) await s.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('runtime node server', () => {
  it('serves /health from extracted transport', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'superone-rt-srv-'))
    dirs.push(nodeHome)
    const identity = loadOrCreateIdentity(nodeHome, 'runtime-test')
    const unused = (): never => {
      throw new Error('unused')
    }
    const auth: NodeAuthPort = {
      onRevoke: null,
      isRevoked: () => false,
      peekWsTicket: unused,
      consumeWsTicket: unused,
      exchangePairingToken: unused,
      refreshAccess: unused,
      createWsTicket: unused,
    }

    const server = await startNodeServer({
      identity,
      auth,
      bindHost: '127.0.0.1',
      bindPort: 0,
      dispatchRpc: async () => ({ error: { code: 'internal', message: 'unused' } }),
      createRpcContext: () => {
        throw new Error('rpc context unused for /health')
      },
      onClientDisconnected: () => {},
      verifyDeviceProof: () => false,
    })
    servers.push(server)

    const res = await fetch(`${server.url}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      environmentId: string
      nodePublicKeyFingerprint: string
    }
    expect(body.ok).toBe(true)
    expect(body.environmentId).toBe(identity.environmentId)
    expect(body.nodePublicKeyFingerprint).toBe(identity.publicKeyFingerprint)
  })
})
