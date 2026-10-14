import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { bindControlActor } from '@superone/runtime/lease'

const electron = vi.hoisted(() => ({ store: new Map<string, string>(), userData: '' }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `t-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: { getPath: () => electron.userData },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'
import { startTestDesktopNode, type FakeSession } from '../node-host/node-host-test-fixtures'
import { runWindowControl } from '../session/control-context'

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
  resetEnvironmentHostForTests()
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Desktop A (an `EnvironmentHost`) paired with desktop B over its LAN listener. */
async function pairedWithB() {
  const projectDir = tempDir('superone-eht-project-')
  const b = await startTestDesktopNode({ userDataDir: tempDir('superone-eht-b-'), projectDir, listen: { bindPort: 0 } })
  cleanup.push(b.close)
  electron.userData = tempDir('superone-eht-a-')
  const a = new EnvironmentHost(electron.userData, { discoverLan: async () => [] })
  cleanup.push(() => a.dispose())
  const pairing = b.host.mintPairingToken()
  const { connectionId } = await a.pairRemote({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop B', channel: pairing.channel })
  const events: AgentEvent[] = []
  a.setAgentEventSink((event) => events.push(event))
  const projectPath = `remote:${connectionId}:${projectDir}`
  const send = (sessionId: string) => a.sendSessionMessage(connectionId, { sessionId, text: 'hello', projectPath, providerId: 'claude' })
  return { a, b, connectionId, projectDir, projectPath, events, send }
}

describe("A driving a session someone on B is using", () => {
  it("shows B's window as the holder, sends nothing until Take over, then drives it", async () => {
    const { a, b, connectionId, projectDir, projectPath, events, send } = await pairedWithB()
    const own = b.sessions.createSession({ id: 'own', projectPath: projectDir }) as unknown as FakeSession
    runWindowControl(1, () => own.lease.assertMutation())
    const windowLease = own.lease.current

    // A learns who holds it before asking for control.
    expect(await a.getSession(connectionId, own.id)).toMatchObject({ controlHolder: { kind: 'window', label: null } })

    // An ordinary send neither takes it nor reaches B; A's composer is told who holds it.
    await expect(send(own.id)).rejects.toMatchObject({ details: { reason: 'control_held' } })
    expect(own.lease.current).toEqual(windowLease)
    expect(own.sent).toEqual([])
    expect(events).toContainEqual({ type: 'session_control_holder', holder: { kind: 'window', label: null }, sessionId: own.id, projectPath })

    // Take over: the lease is A's and the next send goes through.
    await a.reclaimSessionControl(connectionId, own.id)
    expect(own.lease.holder).toMatchObject({ kind: 'controller' })
    await send(own.id)
    expect(own.sent.map((request) => request.content)).toEqual(['hello'])
    expect(await a.getSession(connectionId, own.id)).not.toHaveProperty('controlHolder')
  })

  it("never takes a session from B's phone, even on purpose", async () => {
    const { a, b, connectionId, projectDir, projectPath, events, send } = await pairedWithB()
    const held = b.sessions.createSession({ id: 'phone-held', projectPath: projectDir }) as unknown as FakeSession
    bindControlActor(b.host.domain.leases, { clientSessionId: 'phone:p', holderClientId: `desktop:${b.host.identity.environmentId}`, delegate: 'phone:p', yields: 'none' })
      .acquire({ resource: held.lease.resource, holderClientId: 'phone:p', ttlMs: 60_000 })

    const phone = { kind: 'phone', label: null }
    expect(await a.getSession(connectionId, held.id)).toMatchObject({ controlHolder: phone })
    await expect(send(held.id)).rejects.toMatchObject({ details: { reason: 'control_held', holder: phone } })
    expect(events).toContainEqual({ type: 'session_control_holder', holder: phone, sessionId: held.id, projectPath })
    await expect(a.reclaimSessionControl(connectionId, held.id)).rejects.toMatchObject({ details: { reason: 'control_held', holder: phone } })
    expect(held.lease.phoneDeviceId).toBe('p')
    expect(held.sent).toEqual([])
  })
})
