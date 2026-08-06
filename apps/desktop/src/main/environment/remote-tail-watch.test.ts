/**
 * Prove RemoteEnvironmentGateway.workspace.tailWatch* hits real node RPC.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const store = new Map<string, string>()
  return { store, available: true }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptString: (s: string) => {
      const id = `x-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (!v) throw new Error('missing')
      return v
    },
  },
}))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'
import type { RemoteEnvironmentGateway } from './remote-environment-gateway'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop()
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
})

describe('RemoteEnvironmentGateway workspace.tailWatch', () => {
  it('start/poll returns appended bytes via node RPC', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'rtw-node-'))
    const desk = mkdtempSync(join(tmpdir(), 'rtw-desk-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'rtw-proj-'))
    dirs.push(nodeHome, desk, projectDir)
    mkdirSync(join(projectDir, 'temp'), { recursive: true })
    writeFileSync(join(projectDir, 'temp', 'bash.output'), 'seed')

    const port = 38000 + Math.floor(Math.random() * 1000)
    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      simulatedHarness: true,
    })
    runtimes.push(rt)

    const store = new NodeCredentialStore(desk)
    const manager = new NodeConnectionManager({ credentialStore: store })
    const pair = rt.auth.createPairingToken()
    const { descriptor } = await manager.pairAndConnect({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'remote-tail',
    })

    const gw = manager.getGateway(descriptor.environmentId) as RemoteEnvironmentGateway
    const project = await gw.openProject(projectDir, 'p')
    const projectRef = { environmentId: descriptor.environmentId, projectId: project.projectId }

    const started = await gw.workspace.tailWatchStart({
      project: projectRef,
      relativePath: 'temp/bash.output',
      offset: 0,
    })
    expect(started.watchId).toBeTruthy()

    const first = await gw.workspace.tailWatchPoll({ watchId: started.watchId })
    expect(Buffer.from(first.content, 'base64').toString('utf8')).toBe('seed')

    appendFileSync(join(projectDir, 'temp', 'bash.output'), '-more')
    const second = await gw.workspace.tailWatchPoll({ watchId: started.watchId })
    expect(Buffer.from(second.content, 'base64').toString('utf8')).toBe('-more')

    await expect(
      gw.workspace.tailWatchStart({
        project: projectRef,
        relativePath: 'src/secret.ts',
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })

    const stop = await gw.workspace.tailWatchStop({ watchId: started.watchId })
    expect(stop.ok).toBe(true)

    manager.disconnectAll()
  })
})
