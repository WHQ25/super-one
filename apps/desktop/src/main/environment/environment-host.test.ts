import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

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
let sharedRuntime: NodeRuntime | null = null
let sharedNodeHome: string | null = null

afterEach(() => {
  resetEnvironmentHostForTests()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
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

async function bootNode(): Promise<NodeRuntime> {
  if (sharedRuntime) return sharedRuntime
  sharedNodeHome = mkdtempSync(join(tmpdir(), 'eh-node-'))
  sharedRuntime = await startNodeRuntime({
    nodeHome: sharedNodeHome,
    bindHost: '127.0.0.1',
    bindPort: 35000 + Math.floor(Math.random() * 1000),
    simulatedHarness: true,
  })
  return sharedRuntime
}

describe('EnvironmentHost product path', () => {
  it('constructs WorkspaceRouter and routes remote listDir without local FS', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'eh-ud-'))
    electron.setUserData(ud)
    dirs.push(ud)

    const projectDir = mkdtempSync(join(tmpdir(), 'eh-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'via-host')

    const rt = await bootNode()

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
    await vi.waitFor(async () => {
      const read = await host.readRemoteTerminal(connectionId, terminal.terminalId, attached.sequence)
      expect(read.data).toContain(projectDir)
    }, { timeout: 10_000, interval: 25 })
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

  it('sendSessionMessage does not re-emit prior turn after >1000 durable events', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'eh-cursor-ud-'))
    electron.setUserData(ud)
    dirs.push(ud)

    const projectDir = mkdtempSync(join(tmpdir(), 'eh-cursor-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'x')

    const rt = await bootNode()

    const host = new EnvironmentHost(ud)
    const pair = rt.auth.createPairingToken()
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'cursor',
    })

    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir)
    const created = (await host.createSession(connectionId, {
      projectId: project.projectId,
      harnessId: 'codex',
      title: 'cursor-test',
    })) as { sessionId: string }

    // Pad the durable log past the listEvents page size (1000) with a distinctive
    // prior-turn delta. The buggy cursor takes only the first page's last sequence
    // and then re-maps everything after it on the next send.
    const PRIOR_MARKER = 'PRIOR_TURN_SHOULD_NOT_REPLAY'
    for (let i = 0; i < 1100; i++) {
      rt.events.appendSession({
        sessionId: created.sessionId,
        eventType: 'session.assistant_delta',
        payload: { blockId: 'prior-asst', delta: `${PRIOR_MARKER}-${i}` },
      })
    }

    const emitted: Array<{ type?: string; delta?: { type?: string; text?: string } }> = []
    host.setAgentEventSink((ev) => {
      emitted.push(ev as { type?: string; delta?: { type?: string; text?: string } })
    })

    await host.sendSessionMessage(connectionId, {
      sessionId: created.sessionId,
      text: 'second turn after long history',
      projectPath: `remote:${connectionId}:${projectDir}`,
      providerId: 'codex',
    })

    const replayed = emitted.filter(
      (e) =>
        e.type === 'content_delta' &&
        typeof e.delta?.text === 'string' &&
        e.delta.text.includes(PRIOR_MARKER),
    )
    expect(replayed).toEqual([])

    host.dispose()
  }, 60_000)
})
