import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  store: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `b-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (v === undefined) throw new Error('missing')
      return v
    },
  },
}))

// Import node runtime from monorepo sibling package via relative path to source
import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  electron.store.clear()
})

describe('NodeConnectionManager integration', () => {
  it('pairs from desktop, connects, and runs remote terminal RPC', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'superone-cm-'))
    const desktopData = mkdtempSync(join(tmpdir(), 'superone-desktop-cm-'))
    dirs.push(nodeHome, desktopData)

    const port = 21000 + Math.floor(Math.random() * 10000)
    const runtime = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      label: 'integration-node', simulatedHarness: true })
    runtimes.push(runtime)

    const pair = runtime.auth.createPairingToken()
    const store = new NodeCredentialStore(desktopData)
    const manager = new NodeConnectionManager({ credentialStore: store })

    const { connectionId, descriptor, persisted } = await manager.pairAndConnect({
      baseUrl: runtime.server.url,
      pairingToken: pair.token,
      label: 'My Linux',
    })

    expect(persisted).toBe(true)
    expect(descriptor.environmentId).toBe(runtime.identity.environmentId)
    expect(descriptor.capabilities.terminal).toBe(true)

    const gateway = manager.getGateway(descriptor.environmentId)
    expect(gateway).toBeTruthy()

    const created = await gateway!.terminals.create({ cwd: nodeHome, title: 'remote' })
    expect(created.terminalId).toBeTruthy()

    const attached = await gateway!.terminals.attach({
      environmentId: descriptor.environmentId,
      terminalId: created.terminalId,
    })
    expect(attached.sequence).toBeDefined()

    const termLease = await gateway!.terminals.acquireControl({
      resource: { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      ttlMs: 60_000,
    })

    await gateway!.terminals.write({
      terminal: { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      data: 'echo superone\n',
      leaseId: termLease.leaseId,
      generation: termLease.generation,
    })

    await gateway!.terminals.kill(
      { environmentId: descriptor.environmentId, terminalId: created.terminalId },
      { leaseId: termLease.leaseId, generation: termLease.generation },
    )

    expect(manager.getSupervisor(connectionId)?.state).toBe('connected')
    manager.disconnectAll()
  })
})
