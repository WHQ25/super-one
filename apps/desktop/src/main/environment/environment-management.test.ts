/**
 * Environment management surface backing the Settings UI:
 * list / add over SSH / connect / disconnect / forget, plus status push.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const store = new Map<string, string>()
  let userData = ''
  return {
    store,
    available: true,
    get userData() {
      return userData
    },
    setUserData(p: string) {
      userData = p
    },
  }
})

// Unpackaged tests would otherwise be the dev desktop; most cases cover the
// published (registry) channel.
const variant = vi.hoisted(() => ({ id: 'alpha' as 'stable' | 'alpha' | 'dev' }))
vi.mock('../variant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../variant')>()),
  variantId: () => variant.id,
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptString: (s: string) => {
      const id = `m-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: {
    getPath: () => electron.userData,
    getVersion: () => '1.2.3',
  },
}))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { resolveCliReleaseVersion } from '../../../../../apps/cli/src/cli-release-version'
import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'
import { SshTunnelManager } from './ssh-tunnel-manager'
import type {
  InstallOptions,
  InstallResult,
  PackageInstallOptions,
  RegistryInstallOptions,
  RemoteHostProbe,
} from './remote-install'
import type { SshForwardHandle } from './ssh-forward'
import type { RemoteRestartOptions, SshBootstrapOptions } from './ssh-bootstrap'
import { remoteNodePort, remoteSuperoneHome } from './remote-data-path'

const dirs: string[] = []
let sharedRuntime: NodeRuntime | null = null
let sharedNodeHome: string | null = null

afterEach(async () => {
  resetEnvironmentHostForTests()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
  electron.available = true
  // Connect fires project.list and does not wait for it. This file shares one
  // node, so the call can land after the sending test returns and be counted
  // by the next test's spy. Finish that socket turn before the next test.
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
})

afterAll(async () => {
  if (sharedRuntime) {
    await sharedRuntime.stop().catch(() => {})
    sharedRuntime = null
  }
  if (sharedNodeHome) {
    rmSync(sharedNodeHome, { recursive: true, force: true })
    sharedNodeHome = null
  }
})

function temp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

async function bootNode(): Promise<NodeRuntime> {
  if (sharedRuntime) return sharedRuntime
  sharedNodeHome = mkdtempSync(join(tmpdir(), 'env-mgmt-node-'))
  sharedRuntime = await startNodeRuntime({
    nodeHome: sharedNodeHome,
    bindHost: '127.0.0.1',
    // Port 0: the OS assigns a free port and `server.url` reports it.
    // A guessed port in a shared range collides with other workers.
    bindPort: 0,
    simulatedHarness: true,
  })
  return sharedRuntime
}

function newHost(): EnvironmentHost {
  const ud = temp('env-mgmt-ud-')
  electron.setUserData(ud)
  return new EnvironmentHost(ud)
}

/** Fake ssh -L that just points at an already-running loopback node. */
function fakeForwardStarter(targetUrl: string, calls: string[]) {
  return async (opts: { destination: string; remotePort: number }) => {
    calls.push(`${opts.destination}:${opts.remotePort}`)
    // EventEmitter-compatible stub: tunnel manager attaches `once('exit')` and
    // liveness checks exitCode/signalCode (not only killed).
    const process = new EventEmitter() as SshForwardHandle['process'] & EventEmitter
    Object.defineProperty(process, 'killed', { value: false, writable: true, configurable: true })
    Object.defineProperty(process, 'exitCode', { value: null, writable: true, configurable: true })
    Object.defineProperty(process, 'signalCode', { value: null, writable: true, configurable: true })
    process.kill = (() => {
      ;(process as { killed: boolean }).killed = true
      return true
    }) as SshForwardHandle['process']['kill']
    const handle: SshForwardHandle = {
      localPort: Number(new URL(targetUrl).port),
      localBaseUrl: targetUrl,
      process,
      stop() {
        ;(process as { killed: boolean }).killed = true
      },
    }
    return handle
  }
}

describe('environment list', () => {
  it('returns only the local environment before any node is paired', async () => {
    const host = newHost()
    const list = await host.listEnvironments()

    expect(list).toHaveLength(1)
    expect(list[0]!.connectionId).toBe('local')
    expect(list[0]!.kind).toBe('local')
    expect(list[0]!.state).toBe('connected')
    expect(list[0]!.capabilities?.harnessIds).toContain('claude')
    host.dispose()
  })

  it('projects a paired node with supervisor state, identity, and capabilities', async () => {
    const rt = await bootNode()
    const host = newHost()
    await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'linux-box',
    })

    const list = await host.listEnvironments()
    const remote = list.find((e) => e.kind === 'remote')

    expect(list).toHaveLength(2)
    expect(remote?.label).toBe('linux-box')
    expect(remote?.desired).toBe(true)
    expect(remote?.environmentId).toBe(rt.identity.environmentId)
    expect(remote?.nodePublicKeyFingerprint).toBe(rt.identity.publicKeyFingerprint)
    expect(remote?.state).toBe('connected')
    // Production node is fail-closed on sessions until a real harness is injected.
    expect(remote?.capabilities?.methods).toContain('terminal.create')
    host.dispose()
  })

  it('lists a paired node as disconnected when its socket is not live', async () => {
    const rt = await bootNode()
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud)
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'offline-box',
    })

    const connected = (await host.listEnvironments()).find((e) => e.kind === 'remote')
    expect(connected?.machine?.memoryBytes).toBeGreaterThan(0)

    host.disconnect(connectionId)
    const remote = (await host.listEnvironments()).find((e) => e.kind === 'remote')

    expect(remote).toBeTruthy()
    expect(remote?.state).toBe('disconnected')
    expect(remote?.desired).toBe(false)
    // Endpoint metadata survives disconnect so the UI can offer reconnect.
    expect(remote?.endpointProfiles.length).toBeGreaterThan(0)
    expect(remote?.machine?.cpuModel).toBe(connected?.machine?.cpuModel)
    expect(remote?.machine?.memoryBytes).toBe(connected?.machine?.memoryBytes)
    host.dispose()

    const restarted = new EnvironmentHost(ud)
    const stored = (await restarted.listEnvironments()).find((e) => e.kind === 'remote')
    expect(stored?.machine?.cpuModel).toBe(connected?.machine?.cpuModel)
    expect(stored?.machine?.memoryBytes).toBe(connected?.machine?.memoryBytes)
    restarted.dispose()
  })

  it('renames the name this computer shows for a paired node', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'linux-box',
    })

    host.rename(connectionId, '  studio  ')
    const remote = (await host.listEnvironments()).find((e) => e.kind === 'remote')
    expect(remote?.label).toBe('studio')
    expect(() => host.rename(connectionId, '   ')).toThrow(/name/i)
    host.dispose()
  })

  it('renames the local environment and keeps the name across a restart', async () => {
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud)
    const before = (await host.listEnvironments()).find((item) => item.connectionId === 'local')
    expect(before?.label).toBeTruthy()
    expect(before?.label).not.toBe('studio')

    host.rename('local', '  studio  ')
    expect((await host.listEnvironments()).find((item) => item.connectionId === 'local')?.label).toBe('studio')
    expect(() => host.rename('local', '   ')).toThrow(/name/i)
    host.dispose()

    const restarted = new EnvironmentHost(ud)
    expect((await restarted.listEnvironments()).find((item) => item.connectionId === 'local')?.label).toBe('studio')
    restarted.dispose()
  })
})

describe('repairPairing', () => {
  it('rejects identity mismatch without overwriting credentials', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'repair-me',
    })
    const before = host.credentials.get(connectionId)
    expect(before).toBeTruthy()

    // Force known identity to disagree with live node.
    host.connections.updateKnown(connectionId, {
      environmentId: 'env-other',
      nodePublicKeyFingerprint: 'fp-other',
    })

    await expect(
      host.repairPairing({
        connectionId,
        baseUrl: rt.server.url,
        pairingToken: rt.auth.createPairingToken().token,
      }),
    ).rejects.toMatchObject({ code: 'identity_conflict' })

    const after = host.credentials.get(connectionId)
    expect(after?.refreshToken).toBe(before?.refreshToken)
    host.dispose()
  })

  it('successful re-pair keeps connectionId and replaces the refresh credential', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'repair-keep-id',
    })
    const before = host.credentials.get(connectionId)
    expect(before).toBeTruthy()

    const descriptor = await host.repairPairing({
      connectionId,
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
    })

    expect(descriptor.environmentId).toBe(before!.environmentId)
    const after = host.credentials.get(connectionId)
    expect(after).toBeTruthy()
    expect(after!.connectionId).toBe(connectionId)
    expect(after!.refreshToken).not.toBe(before!.refreshToken)
    expect(host.connections.isConnected(connectionId)).toBe(true)
    host.dispose()
  })

  it('repairPairingOverSsh refuses a non-SSH pairing instead of half-repairing', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'direct-only',
    })

    await expect(host.repairPairingOverSsh(connectionId)).rejects.toMatchObject({
      code: 'failed_precondition',
    })
    // Credential untouched when automated SSH path cannot run.
    expect(host.credentials.get(connectionId)?.refreshToken).toBeTruthy()
    host.dispose()
  })

  it('single-flights concurrent repairPairingOverSsh for the same connection', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'single-flight',
    })

    // Both calls reject (no SSH endpoint) but must share one in-flight promise —
    // a second dial must not race credential replacement on the same connection.
    const a = host.repairPairingOverSsh(connectionId)
    const b = host.repairPairingOverSsh(connectionId)
    const [ra, rb] = await Promise.allSettled([a, b])
    expect(ra.status).toBe('rejected')
    expect(rb.status).toBe('rejected')
    // Same rejection object identity proves single-flight (shared promise).
    expect(ra.status === 'rejected' && rb.status === 'rejected' && ra.reason === rb.reason).toBe(
      true,
    )
    host.dispose()
  })
})

describe('desired auto-connect semantics', () => {
  it('migrates omitted desired to auto-connect on startDesiredConnections', async () => {
    const rt = await bootNode()
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud)
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'desired-node',
    })
    // Simulate legacy record without desired field.
    host.connections.updateKnown(connectionId, { desired: undefined })
    host.disconnect(connectionId)
    // disconnect sets desired=false — flip back to legacy omit.
    host.connections.updateKnown(connectionId, { desired: undefined })
    expect(host.connections.listKnown().find((k) => k.connectionId === connectionId)?.desired).toBeUndefined()

    await host.startDesiredConnections()
    expect(host.connections.isConnected(connectionId)).toBe(true)
    host.dispose()
  })

  it('does not auto-connect when desired is false after explicit disconnect', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'stay-down',
    })
    host.disconnect(connectionId)
    expect(host.connections.listKnown().find((k) => k.connectionId === connectionId)?.desired).toBe(
      false,
    )
    await host.startDesiredConnections()
    expect(host.connections.isConnected(connectionId)).toBe(false)
    host.dispose()
  })

  it('single-flights concurrent connect calls for the same connection', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'single-flight',
    })
    host.disconnect(connectionId)

    const a = host.connect(connectionId)
    const b = host.connect(connectionId)
    const [da, db] = await Promise.all([a, b])
    expect(da.environmentId).toBe(db.environmentId)
    expect(host.connections.isConnected(connectionId)).toBe(true)
    host.dispose()
  })

  it('starts host action consumer when supervisor recovers without host.connect', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'ha-recover',
    })
    // Simulate dispose of consumer while leaving desired live path: disconnect
    // and reconnect via connect() failure-then-wake is hard; instead force
    // publishStatus-connected by reconnecting after stopHostActionConsumer.
    host.disconnect(connectionId)
    await host.connect(connectionId)
    // Tear consumer only (not the live socket) by stopping via private map is hard;
    // use wakeDesired after a fresh connect path that reaches connected via supervisor.
    // If already connected, wake is a no-op probe; force a disconnect of consumer:
    const before = (host as unknown as { hostActionConsumers: Map<string, unknown> })
      .hostActionConsumers
    expect(before.has(connectionId)).toBe(true)
    before.delete(connectionId)
    // publishStatus on next connected transition — simulate by waking then
    // manually invoking connect which short-circuits connected and would not
    // restart consumer; instead re-publish via supervisor notify is heavy.
    // Call connect while connected: finalize path won't run. Use wake after
    // temporarily dropping consumer — wake healthy probe stays connected and
    // doWakeDesiredConnections should re-attach consumer.
    await host.wakeDesiredConnections('app-resume')
    expect(
      (host as unknown as { hostActionConsumers: Map<string, unknown> }).hostActionConsumers.has(
        connectionId,
      ),
    ).toBe(true)
    host.dispose()
  })

  it('leaves a live supervisor when the first endpoint resolve fails', async () => {
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const tunnels = new SshTunnelManager(async () => {
      throw new Error('ssh unreachable')
    })
    const host = new EnvironmentHost(ud, { tunnels })

    // Seed a known SSH environment with credentials by pairing a real node, then
    // switch the preferred endpoint to ssh-forward so resolve goes through tunnels.
    const rt = await bootNode()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'ssh-fail',
      endpointProfiles: [
        {
          endpointId: 'ssh',
          kind: 'ssh-forward',
          label: 'SSH: dead',
          target: 'nobody@127.0.0.1',
          ssh: { remotePort: 7788 },
        },
      ],
    })
    host.disconnect(connectionId)
    host.connections.updateKnown(connectionId, {
      desired: true,
      preferredEndpointId: 'ssh',
      endpointProfiles: [
        {
          endpointId: 'ssh',
          kind: 'ssh-forward',
          label: 'SSH: dead',
          target: 'nobody@127.0.0.1',
          ssh: { remotePort: 7788 },
        },
      ],
    })

    await expect(host.connect(connectionId)).rejects.toThrow()
    // Live supervisor owns retry even though dial failed.
    expect(host.connections.getClient(connectionId)).toBeTruthy()
    expect(host.connections.getSupervisor(connectionId)?.state).toMatch(/backoff|disconnected/)
    expect(host.connections.listKnown().find((k) => k.connectionId === connectionId)?.desired).toBe(
      true,
    )
    host.dispose()
  })
})

describe('environment connect and disconnect', () => {
  it('fetches the remote project list once per connection generation', async () => {
    const rt = await bootNode()
    const projectDir = temp('env-mgmt-project-')
    const opened = rt.projects.open(projectDir)
    const originalList = rt.projects.list.bind(rt.projects)
    let snapshotReads = 0
    const listSpy = vi.spyOn(rt.projects, 'list').mockImplementation((...args: Parameters<typeof originalList>) => {
      // A session-list subscribe snapshots projects in-process. That read is not a project.list fetch.
      if ((new Error().stack ?? '').includes('snapshotTopic')) snapshotReads += 1
      return originalList(...args)
    })
    const projectFetches = () => listSpy.mock.calls.length - snapshotReads
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'box',
    })

    const first = await Promise.all([
      host.listProjects(connectionId),
      host.listProjects(connectionId),
      host.listProjects(connectionId),
    ])
    expect(
      first.every((projects) =>
        projects.some((project) => project.projectId === opened.projectId),
      ),
    ).toBe(true)
    expect(projectFetches()).toBe(1)

    await host.listProjects(connectionId, { refresh: true })
    await host.listProjects(connectionId)
    expect(projectFetches()).toBe(2)

    host.disconnect(connectionId)
    await host.connect(connectionId)
    await Promise.all([
      host.listProjects(connectionId),
      host.listProjects(connectionId),
    ])
    expect(projectFetches()).toBe(3)
    host.dispose()
  })

  it('reconnects a disconnected environment through connect()', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'box',
    })

    host.disconnect(connectionId)
    expect((await host.listEnvironments()).find((e) => e.kind === 'remote')?.state).toBe(
      'disconnected',
    )

    const descriptor = await host.connect(connectionId)
    expect(descriptor.environmentId).toBe(rt.identity.environmentId)
    expect((await host.listEnvironments()).find((e) => e.kind === 'remote')?.state).toBe(
      'connected',
    )
    host.dispose()
  })

  it('rebuilds the SSH tunnel before reconnecting an ssh-forward environment', async () => {
    const rt = await bootNode()
    const calls: string[] = []
    const tunnels = new SshTunnelManager(fakeForwardStarter(rt.server.url, calls))
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud, { tunnels })

    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'ssh-box',
      endpointProfiles: [
        {
          endpointId: 'ssh',
          kind: 'ssh-forward',
          label: 'SSH: superone@lab',
          target: 'superone@lab',
          ssh: { remotePort: 7788, port: 2222 },
        },
      ],
    })

    // Simulate an app restart: sockets and tunnels are gone, metadata persists.
    host.disconnect(connectionId)
    expect(calls).toHaveLength(0)

    await host.connect(connectionId)

    expect(calls).toEqual(['superone@lab:7788'])
    expect((await host.listEnvironments()).find((e) => e.kind === 'remote')?.state).toBe(
      'connected',
    )
    host.dispose()
  })

  it('closes the SSH tunnel when the environment is disconnected', async () => {
    const rt = await bootNode()
    const calls: string[] = []
    const tunnels = new SshTunnelManager(fakeForwardStarter(rt.server.url, calls))
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud, { tunnels })

    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'ssh-box',
      endpointProfiles: [
        {
          endpointId: 'ssh',
          kind: 'ssh-forward',
          label: 'SSH: superone@lab',
          target: 'superone@lab',
          ssh: { remotePort: 7788 },
        },
      ],
    })
    // Pair dials the loopback baseUrl directly; rebuild via preferred SSH endpoint.
    host.disconnect(connectionId)
    await host.connect(connectionId)
    expect(tunnels.has(connectionId)).toBe(true)

    host.disconnect(connectionId)
    expect(tunnels.has(connectionId)).toBe(false)
    host.dispose()
  })
})

describe('forget environment', () => {
  it('removes credentials and known metadata so the node is no longer listed', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'temp-box',
    })
    expect(await host.listEnvironments()).toHaveLength(2)

    host.forget(connectionId)

    expect(await host.listEnvironments()).toHaveLength(1)
    expect(host.credentials.get(connectionId)).toBeNull()
    expect(host.connections.listKnown()).toHaveLength(0)
    host.dispose()
  })

  it('tells listeners the host is gone', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'forgotten-box',
    })
    const states: string[] = []
    host.onStatusChange((snap) => {
      if (snap.connectionId === connectionId) states.push(snap.state)
    })
    host.forget(connectionId)
    expect(states).toContain('disconnected')
    expect(await host.listEnvironments()).toHaveLength(1)
    host.dispose()
  })

  it('keeps the node forgotten after the host is reconstructed from disk', async () => {
    const rt = await bootNode()
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)

    const first = new EnvironmentHost(ud)
    const { connectionId } = await first.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'persisted-box',
    })
    expect(new EnvironmentHost(ud).connections.listKnown()).toHaveLength(1)

    first.forget(connectionId)
    first.dispose()

    expect(new EnvironmentHost(ud).connections.listKnown()).toHaveLength(0)
  })
})

describe('status push', () => {
  it('emits supervisor snapshots to a registered status listener', async () => {
    const rt = await bootNode()
    const host = newHost()
    const states: string[] = []
    host.onStatusChange((snap) => states.push(snap.state))

    await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'watched-box',
    })

    expect(states).toContain('connected')
    host.dispose()
  })
})

describe('add over SSH', () => {
  it('pairs through the bootstrap result and stores an ssh-forward endpoint', async () => {
    const rt = await bootNode()
    const calls: string[] = []
    const tunnels = new SshTunnelManager(fakeForwardStarter(rt.server.url, calls))
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud, {
      tunnels,
      // Stand in for a real `ssh` bootstrap against a Linux host.
      bootstrapOverSsh: async () => ({
        localBaseUrl: rt.server.url,
        localPort: Number(new URL(rt.server.url).port),
        forward: await fakeForwardStarter(rt.server.url, calls)({
          destination: 'superone@lab',
          remotePort: 7788,
        }),
        pairingToken: rt.auth.createPairingToken().token,
        environmentId: rt.identity.environmentId,
        expiresAt: Date.now() + 600_000,
        unitPreview: '',
        warnings: ['unexpected remote OS: Darwin'],
      }),
    })

    const result = await host.addRemoteOverSsh({
      destination: 'superone@lab',
      remoteExec: '/usr/local/bin/superone',
      remotePort: 7788,
      label: 'lab',
    })

    expect(result.descriptor.environmentId).toBe(rt.identity.environmentId)
    expect(result.warnings).toContain('unexpected remote OS: Darwin')

    const remote = (await host.listEnvironments()).find((e) => e.kind === 'remote')
    expect(remote?.state).toBe('connected')
    const ssh = remote?.endpointProfiles.find((p) => p.kind === 'ssh-forward')
    expect(ssh?.target).toBe('superone@lab')
    expect(ssh?.ssh?.remotePort).toBe(7788)
    // The bootstrap tunnel must be adopted, not leaked.
    expect(tunnels.has(result.connectionId)).toBe(true)
    host.dispose()
  })
})

describe('add over SSH without a remote path', () => {
  const linuxProbe: RemoteHostProbe = {
    os: 'linux',
    arch: 'x64',
    musl: false,
    home: '/home/superone',
    superonePath: null,
    superoneVersion: null,
    nodeMajor: 22,
    nodeVersion: '22.23.4',
    hasNpm: true,
    hasSystemd: true,
    distTarget: 'linux-x64',
  }

  function hostWith(
    rt: NodeRuntime,
    overrides: {
      probe?: RemoteHostProbe
      findArtifact?: (target: string) => { path: string; version: string; target: string } | null
      installNode?: (opts: InstallOptions) => Promise<InstallResult>
      installFromRegistry?: (opts: RegistryInstallOptions) => Promise<InstallResult>
      restartNode?: (opts: RemoteRestartOptions) => Promise<void>
    },
  ): {
    host: EnvironmentHost
    bootstrapExec: string[]
    restarts: RemoteRestartOptions[]
    events: string[]
  } {
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const bootstrapExec: string[] = []
    const restarts: RemoteRestartOptions[] = []
    const events: string[] = []
    const host = new EnvironmentHost(ud, {
      tunnels: new SshTunnelManager(fakeForwardStarter(rt.server.url, [])),
      probeHost: async () => overrides.probe ?? linuxProbe,
      findArtifact: overrides.findArtifact ?? (() => null),
      installNode: overrides.installNode,
      installFromRegistry: overrides.installFromRegistry,
      restartNode: async (opts) => {
        events.push('restart')
        if (overrides.restartNode) {
          await overrides.restartNode(opts)
          return
        }
        restarts.push(opts)
      },
      defaultCliVersion: '1.2.3',
      bootstrapOverSsh: async (opts) => {
        events.push('bootstrap')
        bootstrapExec.push(opts.remoteExec)
        return {
          localBaseUrl: rt.server.url,
          localPort: Number(new URL(rt.server.url).port),
          forward: await fakeForwardStarter(rt.server.url, [])({
            destination: opts.destination,
            remotePort: 7788,
          }),
          pairingToken: rt.auth.createPairingToken().token,
          environmentId: rt.identity.environmentId,
          expiresAt: Date.now() + 600_000,
          unitPreview: '',
          warnings: [],
        }
      },
    })
    return { host, bootstrapExec, restarts, events }
  }

  it('reuses an existing remote installation when versions match', async () => {
    const rt = await bootNode()
    let installCalls = 0
    const { host, bootstrapExec, restarts, events } = hostWith(rt, {
      probe: {
        ...linuxProbe,
        superonePath: '/home/superone/.local/bin/superone',
        // Matches hostWith defaultCliVersion
        superoneVersion: '1.2.3',
      },
      installNode: async () => {
        installCalls += 1
        throw new Error('should not install')
      },
      installFromRegistry: async () => {
        installCalls += 1
        throw new Error('should not install')
      },
    })

    const result = await host.addRemoteOverSsh({ destination: 'superone@lab', label: 'lab' })

    expect(installCalls).toBe(0)
    expect(restarts).toHaveLength(0)
    expect(events).toEqual(['bootstrap'])
    expect(bootstrapExec).toEqual(['/home/superone/.local/bin/superone'])
    expect(result.installed).toBeUndefined()
    expect(result.descriptor.environmentId).toBe(rt.identity.environmentId)
    host.dispose()
  })

  it('upgrades an older remote CLI to the desktop version', async () => {
    const rt = await bootNode()
    const registry: RegistryInstallOptions[] = []
    const { host, bootstrapExec, restarts, events } = hostWith(rt, {
      probe: {
        ...linuxProbe,
        superonePath: '/home/superone/.local/bin/superone',
        superoneVersion: '1.0.0',
        nodeBinDir: '/home/superone/.nvm/versions/node/v22.22.2/bin',
      },
      installFromRegistry: async (opts) => {
        registry.push(opts)
        return {
          remoteExec: '/home/superone/.local/bin/superone',
          version: opts.version,
          target: 'registry',
          sha256: '',
          source: 'registry',
        }
      },
    })

    const result = await host.addRemoteOverSsh({ destination: 'superone@lab' })

    expect(registry).toHaveLength(1)
    expect(registry[0]!.version).toBe('1.2.3')
    expect(bootstrapExec).toEqual(['/home/superone/.local/bin/superone'])
    expect(result.installed?.source).toBe('registry')
    expect(result.warnings.some((w) => /older than this desktop/i.test(w))).toBe(true)
    // A healthy old process survives npm replacing the files. Restart before
    // bootstrap, which only starts a node when /health is already down.
    expect(events).toEqual(['restart', 'bootstrap'])
    expect(restarts).toEqual([
      expect.objectContaining({
        destination: 'superone@lab',
        remoteExec: '/home/superone/.local/bin/superone',
        remoteNodeHome: `${remoteSuperoneHome('/home/superone')}/node`,
        remotePort: remoteNodePort(),
        nodeBinDir: '/home/superone/.nvm/versions/node/v22.22.2/bin',
      }),
    ])
    host.dispose()
  })

  it('restarts a running node when the installed CLI version cannot be read', async () => {
    const rt = await bootNode()
    const { host, restarts, events } = hostWith(rt, {
      probe: {
        ...linuxProbe,
        superonePath: '/home/superone/.local/bin/superone',
        superoneVersion: null,
      },
      installFromRegistry: async (opts) => ({
        remoteExec: '/home/superone/.local/bin/superone',
        version: opts.version,
        target: 'registry',
        sha256: '',
        source: 'registry',
      }),
    })

    const result = await host.addRemoteOverSsh({
      destination: 'superone@lab',
      sshPort: 2222,
      remoteNodeHome: '/var/lib/superone-node',
    })

    expect(result.warnings.some((w) => /could not be read/i.test(w))).toBe(true)
    expect(events).toEqual(['restart', 'bootstrap'])
    expect(restarts).toEqual([
      expect.objectContaining({
        destination: 'superone@lab',
        extraSshArgs: ['-p', '2222'],
        remoteExec: '/home/superone/.local/bin/superone',
        remoteNodeHome: '/var/lib/superone-node',
        remotePort: remoteNodePort(),
      }),
    ])
    host.dispose()
  })

  it('blocks when the remote CLI is newer than the desktop', async () => {
    const rt = await bootNode()
    let installCalls = 0
    const { host } = hostWith(rt, {
      probe: {
        ...linuxProbe,
        superonePath: '/home/superone/.local/bin/superone',
        superoneVersion: '9.9.9-alpha',
      },
      installFromRegistry: async () => {
        installCalls += 1
        throw new Error('should not install')
      },
    })

    await expect(host.addRemoteOverSsh({ destination: 'superone@lab' })).rejects.toMatchObject({
      code: 'desktop_upgrade_required',
      message: expect.stringMatching(/9\.9\.9-alpha/),
    })
    expect(installCalls).toBe(0)
    host.dispose()
  })

  it('installs from npm registry by default when the host has no superone', async () => {
    const rt = await bootNode()
    const registry: RegistryInstallOptions[] = []
    const { host, bootstrapExec, restarts } = hostWith(rt, {
      installFromRegistry: async (opts) => {
        registry.push(opts)
        opts.onProgress?.('npm', `@super-one/cli@${opts.version}`)
        return {
          remoteExec: '/home/superone/.local/bin/superone',
          version: opts.version,
          target: 'registry',
          sha256: '',
          source: 'registry',
        }
      },
      installNode: async () => {
        throw new Error('upload path should not run for registry default')
      },
    })

    const phases: string[] = []
    const result = await host.addRemoteOverSsh({ destination: 'superone@lab' }, (p) =>
      phases.push(p.phase),
    )

    expect(registry).toHaveLength(1)
    expect(registry[0]!.version).toBe('1.2.3')
    expect(registry[0]!.remoteHome).toBe('/home/superone')
    expect(bootstrapExec).toEqual(['/home/superone/.local/bin/superone'])
    expect(restarts).toHaveLength(0)
    expect(result.installed?.source).toBe('registry')
    expect(phases).toEqual(['probing', 'installing', 'starting', 'pairing'])
    host.dispose()
  })

  it('uploads a local dist when installSource is upload', async () => {
    const rt = await bootNode()
    const installs: InstallOptions[] = []
    const { host, bootstrapExec } = hostWith(rt, {
      findArtifact: (target) => ({ path: `/local/superone-1.2.3-${target}.tar.gz`, version: '1.2.3', target }),
      installNode: async (opts) => {
        installs.push(opts)
        opts.onProgress?.('upload', '100%')
        opts.onProgress?.('activate')
        return {
          remoteExec: '/home/superone/.superone/current/bin/superone',
          version: opts.version,
          target: opts.distTarget,
          sha256: 'deadbeef',
          source: 'upload',
        }
      },
    })

    const phases: string[] = []
    const result = await host.addRemoteOverSsh(
      { destination: 'superone@lab', installSource: 'upload' },
      (p) => phases.push(p.phase),
    )

    expect(installs).toHaveLength(1)
    expect(installs[0]!.distTarget).toBe('linux-x64')
    expect(bootstrapExec).toEqual(['/home/superone/.superone/current/bin/superone'])
    expect(result.installed?.source).toBe('upload')
    expect(phases).toEqual(['probing', 'installing', 'installing', 'starting', 'pairing'])
    host.dispose()
  })

  it('fails with an actionable message when upload is requested but no artifact is bundled', async () => {
    const rt = await bootNode()
    const { host } = hostWith(rt, { findArtifact: () => null })

    await expect(
      host.addRemoteOverSsh({ destination: 'superone@lab', installSource: 'upload' }),
    ).rejects.toThrow(/build:dist --target linux-x64/)
    host.dispose()
  })

  it('blocks before any install when the remote Node runtime is too old', async () => {
    const rt = await bootNode()
    let installCalls = 0
    const { host } = hostWith(rt, {
      probe: { ...linuxProbe, nodeMajor: 16, nodeVersion: '16.0.0' },
      findArtifact: (target) => ({ path: '/local/x.tar.gz', version: '1.0.0', target }),
      installNode: async () => {
        installCalls += 1
        throw new Error('unreachable')
      },
    })

    await expect(host.addRemoteOverSsh({ destination: 'superone@lab' })).rejects.toThrow(/found 16/)
    expect(installCalls).toBe(0)
    host.dispose()
  })

  it('warns instead of failing when the host has no systemd', async () => {
    const rt = await bootNode()
    const { host } = hostWith(rt, {
      probe: {
        ...linuxProbe,
        superonePath: '/usr/local/bin/superone',
        superoneVersion: '1.2.3',
        hasSystemd: false,
      },
    })

    const result = await host.addRemoteOverSsh({ destination: 'superone@lab' })

    expect(result.warnings.some((w) => w.includes('systemd'))).toBe(true)
    host.dispose()
  })

  it('still honours an explicitly supplied remote path without probing', async () => {
    const rt = await bootNode()
    let probes = 0
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    const host = new EnvironmentHost(ud, {
      tunnels: new SshTunnelManager(fakeForwardStarter(rt.server.url, [])),
      probeHost: async () => {
        probes += 1
        return linuxProbe
      },
      bootstrapOverSsh: async (opts) => {
        expect(opts.remoteExec).toBe('/opt/superone/bin/superone')
        return {
          localBaseUrl: rt.server.url,
          localPort: Number(new URL(rt.server.url).port),
          forward: await fakeForwardStarter(rt.server.url, [])({
            destination: opts.destination,
            remotePort: 7788,
          }),
          pairingToken: rt.auth.createPairingToken().token,
          environmentId: rt.identity.environmentId,
          expiresAt: Date.now() + 600_000,
          unitPreview: '',
          warnings: [],
        }
      },
    })

    await host.addRemoteOverSsh({
      destination: 'superone@lab',
      remoteExec: '/opt/superone/bin/superone',
    })

    expect(probes).toBe(0)
    host.dispose()
  })

  it('installs the desktop version, restarts the node, and reconnects', async () => {
    const rt = await bootNode()
    const registry: RegistryInstallOptions[] = []
    const restarts: RemoteRestartOptions[] = []
    const { host } = hostWith(rt, {
      probe: {
        ...linuxProbe,
        superonePath: '/home/superone/.local/bin/superone',
        superoneVersion: '1.0.0',
      },
      installFromRegistry: async (opts) => {
        registry.push(opts)
        // Mirror installNodeFromRegistry, which reports the npm step.
        opts.onProgress?.('npm', `@super-one/cli@${opts.version}`)
        return {
          remoteExec: '/home/superone/.local/bin/superone',
          version: opts.version,
          target: 'registry',
          sha256: '',
          source: 'registry',
        }
      },
      restartNode: async (opts) => {
        restarts.push(opts)
      },
    })

    const added = await host.addRemoteOverSsh({ destination: 'superone@lab', label: 'lab' })
    const before = (await host.listEnvironments()).find(
      (e) => e.connectionId === added.connectionId,
    )
    expect(before?.nodeUpgrade?.canUpgradeOverSsh).toBe(true)

    const phases: string[] = []
    registry.length = 0
    restarts.length = 0
    const result = await host.upgradeRemoteNode(added.connectionId, (p) => phases.push(p.phase))

    expect(result.version).toBe('1.2.3')
    expect(registry).toHaveLength(1)
    expect(registry[0]!.version).toBe('1.2.3')
    // Restart must target the installed launcher, not the pre-upgrade path.
    expect(restarts).toHaveLength(1)
    expect(restarts[0]!.remoteExec).toBe('/home/superone/.local/bin/superone')
    expect(restarts[0]!.remoteNodeHome).toBe('/home/superone/.superone/alpha/node')
    expect(phases).toEqual(['probing', 'installing', 'starting'])
    // Pairing survives the restart: the same connection is live again.
    expect(host.connections.getSupervisor(added.connectionId)?.state).toBe('connected')
    host.dispose()
  })
})

describe('dev channel', () => {
  const devProbe: RemoteHostProbe = {
    os: 'linux',
    arch: 'x64',
    musl: false,
    home: '/home/superone',
    // An earlier dev deploy of the same version: its code is still stale.
    superonePath: '/home/superone/.superone/dev/npm/bin/superone',
    superoneVersion: '1.2.3',
    nodeMajor: 22,
    nodeVersion: '22.23.4',
    hasNpm: true,
    hasSystemd: true,
    distTarget: 'linux-x64',
  }

  function devHost(rt: NodeRuntime): {
    host: EnvironmentHost
    builds: number
    releases: number
    uploads: PackageInstallOptions[]
    restarts: RemoteRestartOptions[]
    bootstraps: SshBootstrapOptions[]
  } {
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    let builds = 0
    let releases = 0
    const uploads: PackageInstallOptions[] = []
    const restarts: RemoteRestartOptions[] = []
    const bootstraps: SshBootstrapOptions[] = []
    const host = new EnvironmentHost(ud, {
      tunnels: new SshTunnelManager(fakeForwardStarter(rt.server.url, [])),
      probeHost: async () => devProbe,
      defaultCliVersion: '1.2.3',
      packDevCli: async () => {
        builds += 1
        return { path: '/tmp/superone-dev-cli-x/super-one-cli-1.2.3.tgz', version: '1.2.3', release: async () => { releases += 1 } }
      },
      installFromPackage: async (opts) => {
        uploads.push(opts)
        return {
          remoteExec: '/home/superone/.superone/dev/npm/bin/superone',
          version: opts.version,
          target: 'npm-pack',
          sha256: 'deadbeef',
          source: 'upload',
        }
      },
      installNode: async () => {
        throw new Error('dev channel must not upload a dist tarball')
      },
      installFromRegistry: async () => {
        throw new Error('dev channel must not install from npm')
      },
      restartNode: async (opts) => {
        restarts.push(opts)
      },
      bootstrapOverSsh: async (opts) => {
        bootstraps.push(opts)
        return {
          localBaseUrl: rt.server.url,
          localPort: Number(new URL(rt.server.url).port),
          forward: await fakeForwardStarter(rt.server.url, [])({ destination: opts.destination, remotePort: opts.remotePort! }),
          pairingToken: rt.auth.createPairingToken().token,
          environmentId: rt.identity.environmentId,
          expiresAt: Date.now() + 600_000,
          unitPreview: '',
          warnings: [],
          remoteNodeHome: '/home/superone/.superone/dev/node',
          remoteExec: opts.remoteExec,
        }
      },
    })
    return { host, get builds() { return builds }, get releases() { return releases }, uploads, restarts, bootstraps }
  }

  afterEach(() => {
    variant.id = 'alpha'
  })

  it('packs this checkout and redeploys it into the dev channel even when versions match', async () => {
    variant.id = 'dev'
    const rt = await bootNode()
    const dev = devHost(rt)
    const { host, uploads, restarts, bootstraps } = dev

    const steps: string[] = []
    const result = await host.addRemoteOverSsh(
      { destination: 'superone@lab', installSource: 'registry' },
      (p) => { if (p.phase === 'installing') steps.push(p.step) },
    )

    expect(dev.builds).toBe(1)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.tarballPath).toBe('/tmp/superone-dev-cli-x/super-one-cli-1.2.3.tgz')
    expect(dev.releases).toBe(1)
    expect(steps[0]).toBe('build')
    expect(restarts).toHaveLength(1)
    expect(restarts[0]!.remoteNodeHome).toBe('/home/superone/.superone/dev/node')
    expect(restarts[0]!.remotePort).toBe(7792)
    expect(bootstraps[0]!.remotePort).toBe(7792)
    expect(result.installed?.source).toBe('upload')
    host.dispose()
  })

  it('redeploys a dev node from source on upgrade', async () => {
    variant.id = 'dev'
    const rt = await bootNode()
    const dev = devHost(rt)
    const { host, uploads, restarts } = dev
    const added = await host.addRemoteOverSsh({ destination: 'superone@lab' })
    uploads.length = 0
    restarts.length = 0

    await host.upgradeRemoteNode(added.connectionId)

    expect(dev.builds).toBe(2)
    expect(uploads).toHaveLength(1)
    expect(restarts[0]!.remoteNodeHome).toBe('/home/superone/.superone/dev/node')
    expect(host.connections.getSupervisor(added.connectionId)?.state).toBe('connected')
    host.dispose()
  })

  it.each([
    ['an alpha executable', { remoteExec: '/home/superone/.superone/alpha/npm/bin/superone' }],
    ['the alpha port', { remotePort: 7790 }],
    ['the stable node home', { remoteNodeHome: '~/.superone/node' }],
  ])('refuses a dev add pointed at %s before touching the host', async (_, target) => {
    variant.id = 'dev'
    const rt = await bootNode()
    const dev = devHost(rt)

    await expect(dev.host.addRemoteOverSsh({ destination: 'superone@lab', ...target }))
      .rejects.toMatchObject({ code: 'failed_precondition' })
    expect(dev.builds).toBe(0)
    expect(dev.bootstraps).toEqual([])
    dev.host.dispose()
  })

  it('releases the local package when the remote install fails', async () => {
    variant.id = 'dev'
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    let released = false
    const host = new EnvironmentHost(ud, {
      probeHost: async () => devProbe,
      packDevCli: async () => ({ path: '/tmp/p.tgz', version: '1.2.3', release: async () => { released = true } }),
      installFromPackage: async () => { throw new Error('npm install failed') },
    })

    await expect(host.addRemoteOverSsh({ destination: 'superone@lab' })).rejects.toThrow('npm install failed')
    expect(released).toBe(true)
    host.dispose()
  })

  it('refuses to redeploy over a node paired on the alpha channel', async () => {
    // Paired by this desktop before the dev channel existed.
    const rt = await bootNode()
    const dev = devHost(rt)
    const { host, uploads, restarts } = dev
    const added = await host.addRemoteOverSsh({ destination: 'superone@lab', remoteExec: '/home/superone/.superone/alpha/npm/bin/superone' })
    variant.id = 'dev'

    await expect(host.upgradeRemoteNode(added.connectionId)).rejects.toMatchObject({
      code: 'failed_precondition',
      message: expect.stringMatching(/alpha channel/),
    })
    expect(dev.builds).toBe(0)
    expect(uploads).toEqual([])
    expect(restarts).toEqual([])
    expect(host.connections.getSupervisor(added.connectionId)?.state).toBe('connected')
    host.dispose()
  })
})

describe('outdated node upgrade', () => {
  const linuxProbe: RemoteHostProbe = {
    ok: true,
    os: 'linux',
    arch: 'x64',
    musl: false,
    home: '/home/superone',
    superonePath: '/home/superone/.local/bin/superone',
    superoneVersion: '1.0.0',
    nodeMajor: 22,
    hasNpm: true,
    hasSystemd: true,
    distTarget: 'linux-x64',
  }

  it('flags a node behind the desktop on connect without upgrading it', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'stale-box',
    })

    // Desktop is mocked at 1.2.3; the booted node reports the monorepo version.
    const remote = (await host.listEnvironments()).find((e) => e.kind === 'remote')

    expect(remote?.state).toBe('connected')
    expect(remote?.nodeUpgrade?.targetVersion).toBe('1.2.3')
    expect(remote?.nodeUpgrade?.remoteVersion).toBe(remote?.cliVersion)
    // Paired over a plain socket: no SSH endpoint, so no in-app installer.
    expect(remote?.nodeUpgrade?.canUpgradeOverSsh).toBe(false)
    // Connect stayed non-destructive — the stale node is still usable.
    expect(host.connections.getSupervisor(connectionId)?.state).toBe('connected')
    host.dispose()
  })

  it('leaves nodeUpgrade unset when the node already matches the desktop', async () => {
    const rt = await bootNode()
    const ud = temp('env-mgmt-ud-')
    electron.setUserData(ud)
    // Pin the desktop target to exactly what this node runs.
    const host = new EnvironmentHost(ud, { defaultCliVersion: resolveCliReleaseVersion() })
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'same-box',
    })

    const remote = (await host.listEnvironments()).find((e) => e.connectionId === connectionId)

    expect(remote?.cliVersion).toBe(resolveCliReleaseVersion())
    expect(remote?.nodeUpgrade).toBeUndefined()
    host.dispose()
  })

  it('refuses to upgrade a node that was paired without an SSH endpoint', async () => {
    const rt = await bootNode()
    const host = newHost()
    const { connectionId } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: rt.auth.createPairingToken().token,
      label: 'socket-only',
    })

    await expect(host.upgradeRemoteNode(connectionId)).rejects.toMatchObject({
      code: 'failed_precondition',
      message: expect.stringMatching(/npm install -g @super-one\/cli/),
    })
    // Refusing must not take the working connection down.
    expect(host.connections.getSupervisor(connectionId)?.state).toBe('connected')
    host.dispose()
  })
})
