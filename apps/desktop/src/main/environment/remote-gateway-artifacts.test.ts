/**
 * RemoteEnvironmentGateway.artifacts against a real node: the desktop half of
 * the session sync zone transfer contract (session-sync-zone.md §5).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `g-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (!v) throw new Error('missing')
      return v
    },
  },
  app: { getPath: () => mkdtempSync(join(tmpdir(), 'eh-')) },
}))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
})

describe('RemoteEnvironmentGateway artifacts', () => {
  it('learns the node zone root at connect and round-trips a chunked upload with the session lease', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'rga-node-'))
    const desk = mkdtempSync(join(tmpdir(), 'rga-desk-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'rga-proj-'))
    dirs.push(nodeHome, desk, projectDir)
    writeFileSync(join(projectDir, 'seed.txt'), 'seed')

    const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
    runtimes.push(rt)

    const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(desk) })
    const pair = rt.auth.createPairingToken()
    const { descriptor } = await manager.pairAndConnect({ baseUrl: rt.server.url, pairingToken: pair.token, label: 'gw' })
    const gw = manager.getGateway(descriptor.environmentId)!
    expect(gw.syncZone()).toEqual({ syncRoot: join(nodeHome, 'sync'), os: process.platform === 'darwin' ? 'darwin' : 'linux' })

    const project = await gw.openProject(projectDir, 'p')
    const { sessionId } = await gw.sessions.create({
      project: { environmentId: descriptor.environmentId, projectId: project.projectId },
      providerId: 'codex',
      options: { harnessId: 'codex' },
    })
    const lease = await gw.sessions.acquireControl({ resource: { environmentId: descriptor.environmentId, sessionId } })
    const control = { leaseId: lease.leaseId, generation: lease.generation }

    const data = Buffer.from('desktop-produced screenshot')
    const sha256 = createHash('sha256').update(data).digest('hex')
    const chunk = (offset: number, end: number, final: boolean) => gw.artifacts.put({
      sessionId, relativePath: 'browser/shot.png', transferId: 'up-1', offset, total: data.length, sha256,
      chunk: data.subarray(offset, end).toString('base64'), final,
    }, control)
    expect(await chunk(0, 8, false)).toEqual({ ok: true, bytesWritten: 8 })
    expect(await chunk(8, data.length, true)).toMatchObject({ ok: true, bytesWritten: data.length })

    const twin = join(nodeHome, 'sync', sessionId, 'browser', 'shot.png')
    expect(readFileSync(twin)).toEqual(data)
    expect(await gw.artifacts.stat({ sessionId, relativePath: 'browser/shot.png' })).toMatchObject({ exists: true, size: data.length })
    const got = await gw.artifacts.get({ sessionId, relativePath: 'browser/shot.png', offset: 0, maxBytes: 1024 })
    expect(Buffer.from(got.chunk, 'base64')).toEqual(data)

    await gw.artifacts.delete({ sessionId }, control)
    expect(existsSync(join(nodeHome, 'sync', sessionId))).toBe(false)
    manager.disconnectAll()
  })
})
