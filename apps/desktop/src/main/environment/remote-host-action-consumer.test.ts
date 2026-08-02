/**
 * Persistent Host Action consumer — survives closed chat view / no sendSessionMessage.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_ACTION_TOOL_GROUPS } from '@superone/shared/environment'

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
import { createSimulatedTurnRunner, type TurnRunner } from '../../../../../apps/cli/src/session/session-runtime'
import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'
import type { ClaimHostActionResult } from '@superone/shared/environment'

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

describe('RemoteHostActionConsumer via EnvironmentHost', () => {
  it('receives and completes host actions with no chat view and no sendSessionMessage in flight', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'ha-ud-'))
    electron.setUserData(ud)
    dirs.push(ud)

    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }

    const nodeHome = mkdtempSync(join(tmpdir(), 'ha-node-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'ha-proj-'))
    dirs.push(nodeHome, projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'x')

    const port = 36000 + Math.floor(Math.random() * 2000)
    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      turnRunner: runner,
      simulatedHarness: true,
    })
    runtimes.push(rt)

    const executed: ClaimHostActionResult[] = []
    const host = new EnvironmentHost(ud, {
      hostActionPollWaitMs: 500,
      hostActionExecutor: async (claimed) => {
        executed.push(claimed)
        return { outcome: 'succeeded', result: { tabs: [{ id: 1 }] } }
      },
    })

    const pair = rt.auth.createPairingToken()
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'box',
    })

    // Consumer must be running after handshake — without any chat UI.
    expect(host.isHostActionConsumerRunning(connectionId)).toBe(true)

    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir)
    const session = (await host.createSession(connectionId, {
      projectId: project.projectId,
      harnessId: 'codex',
      title: 'no-chat',
    })) as { sessionId: string }

    // Start a turn so claim's active-turn gate passes — but do NOT call sendSessionMessage
    // (which is the old design's drain path). Use the gateway sessions API directly.
    const gateway = host.getGateway(descriptor.environmentId)!
    const control = await gateway.sessions.acquireControl({
      resource: { environmentId: descriptor.environmentId, sessionId: session.sessionId },
      ttlMs: 60_000,
    })
    await gateway.sessions.send({
      session: { environmentId: descriptor.environmentId, sessionId: session.sessionId },
      text: 'start turn without sendSessionMessage drain',
      leaseId: control.leaseId,
      generation: control.generation,
    })

    // Enqueue host action on the node (simulating harness tool call).
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { from: 'no-chat-view' },
      deadlineMs: 20_000,
    })

    // Wait for consumer to claim + execute + respond without any chat drain.
    const terminal = await Promise.race([
      wait,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('host action not completed by consumer')), 15_000),
      ),
    ])

    expect(terminal.state).toBe('succeeded')
    expect(terminal.result).toEqual({ tabs: [{ id: 1 }] })
    expect(executed).toHaveLength(1)
    expect(executed[0]!.args).toEqual({ from: 'no-chat-view' })
    expect(executed[0]!.toolName).toBe('browser.tabs')

    // Still no sendSessionMessage — consumer is connection-scoped.
    expect(host.isHostActionConsumerRunning(connectionId)).toBe(true)

    release()
    host.disconnect(connectionId)
    expect(host.isHostActionConsumerRunning(connectionId)).toBe(false)
    host.dispose()
  }, 30_000)

  it('restarts consumer on reconnect and resumes outstanding safe actions', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'ha-ud2-'))
    electron.setUserData(ud)
    dirs.push(ud)

    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const runner: TurnRunner = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        held.then(() => resolve())
      })
      return { finalText: 'done' }
    }

    const nodeHome = mkdtempSync(join(tmpdir(), 'ha-node2-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'ha-proj2-'))
    dirs.push(nodeHome, projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'x')

    const port = 38000 + Math.floor(Math.random() * 2000)
    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: port,
      turnRunner: runner,
      simulatedHarness: true,
    })
    runtimes.push(rt)

    let execCount = 0
    const host = new EnvironmentHost(ud, {
      hostActionPollWaitMs: 400,
      hostActionExecutor: async (claimed) => {
        execCount++
        return { outcome: 'succeeded', result: { n: execCount, tool: claimed.toolName } }
      },
    })

    const pair = rt.auth.createPairingToken()
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'box',
    })

    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir)
    const session = (await host.createSession(connectionId, {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as { sessionId: string }

    const gateway = host.getGateway(descriptor.environmentId)!
    const control = await gateway.sessions.acquireControl({
      resource: { environmentId: descriptor.environmentId, sessionId: session.sessionId },
      ttlMs: 120_000,
    })
    await gateway.sessions.send({
      session: { environmentId: descriptor.environmentId, sessionId: session.sessionId },
      text: 'turn',
      leaseId: control.leaseId,
      generation: control.generation,
    })

    // Enqueue action while connected but disconnect before consumer claims it.
    // Stop consumer first so the action stays pending (replay-safe resume after reconnect).
    host.disconnect(connectionId)
    expect(host.isHostActionConsumerRunning(connectionId)).toBe(false)

    // Turn is still streaming on the node after desktop disconnect.
    const wait = rt.sessions.requestHostAction({
      sessionId: session.sessionId,
      toolName: 'browser.tabs',
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      args: { reconnect: true },
      deadlineMs: 30_000,
      replayPolicy: 'safe',
    })

    // Reconnect — consumer starts and takes outstanding snapshot.
    await host.connect(connectionId)
    expect(host.isHostActionConsumerRunning(connectionId)).toBe(true)

    const terminal = await Promise.race([
      wait,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('not completed after reconnect')), 15_000),
      ),
    ])
    expect(terminal.state).toBe('succeeded')
    expect(execCount).toBeGreaterThanOrEqual(1)

    release()
    host.dispose()
  }, 40_000)
})
