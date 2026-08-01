import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const store = new Map<string, string>()
  let userData = ''
  return {
    store,
    get userData() {
      return userData
    },
    setUserData(p: string) {
      userData = p
    },
  }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `h-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: {
    getPath: () => electron.userData || mkdtempSync(join(tmpdir(), 'eh-ud-')),
  },
}))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'
import { probeEndpointHealth } from './endpoint-probes'
import { ConnectionSupervisor } from './connection-supervisor'
import { ConnectionSupervisorCore } from '@superone/shared/environment'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  resetEnvironmentHostForTests()
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
})

describe('EnvironmentHost product path', () => {
  it('constructs WorkspaceRouter and routes remote listDir without local FS', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'eh-ud-'))
    electron.setUserData(ud)
    dirs.push(ud)

    const nodeHome = mkdtempSync(join(tmpdir(), 'eh-node-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'eh-proj-'))
    dirs.push(nodeHome, projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'via-host')

    const port = 35000 + Math.floor(Math.random() * 1000)
    const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: port, simulatedHarness: true })
    runtimes.push(rt)

    const host = new EnvironmentHost(ud)
    expect(host.workspaceRouter).toBeTruthy()

    const pair = rt.auth.createPairingToken()
    const { descriptor } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'box',
    })

    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir)
    const entries = await host.workspace().listDir({
      project: { environmentId: descriptor.environmentId, projectId: project.projectId },
      relativePath: '.',
    })
    expect(entries.some((e) => e.name === 'a.txt')).toBe(true)

    const connectionId = host.connections
      .listKnown()
      .find((known) => known.environmentId === descriptor.environmentId)!.connectionId
    const terminal = await host.createRemoteTerminal(connectionId, {
      cwd: projectDir,
      cols: 90,
      rows: 30,
    })
    const attached = await host.attachRemoteTerminal(connectionId, terminal.terminalId)
    await host.writeRemoteTerminal(connectionId, terminal.terminalId, 'pwd\r')
    let terminalOutput = ''
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const read = await host.readRemoteTerminal(connectionId, terminal.terminalId, attached.sequence)
      terminalOutput = read.data
      if (terminalOutput.includes(projectDir)) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(terminalOutput).toContain(projectDir)
    await host.resizeRemoteTerminal(connectionId, terminal.terminalId, 100, 40)
    await host.killRemoteTerminal(connectionId, terminal.terminalId)

    // Real health probe against live node
    const probe = await probeEndpointHealth(
      {
        endpointId: 'direct',
        kind: 'direct-wss',
        label: 'loopback',
        target: rt.server.url,
      },
      { baseUrlOverride: rt.server.url },
    )
    expect(probe.ok).toBe(true)
    expect(probe.environmentId).toBe(descriptor.environmentId)

    // Failover reconnect using same identity
    const re = await host.connectWithFailover(
      host.connections.listKnown().find((k) => k.environmentId === descriptor.environmentId)!
        .connectionId,
    )
    expect(re.environmentId).toBe(descriptor.environmentId)

    host.dispose()
  })

  it('desktop ConnectionSupervisor is the shared ConnectionSupervisorCore', () => {
    expect(ConnectionSupervisor).toBe(ConnectionSupervisorCore)
  })
})
