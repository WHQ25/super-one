/**
 * Focused local vs remote EnvironmentGateway harness parity.
 * Both gateways implement the same sessions.create/send surface for claude/codex/acp/opencode.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const store = new Map<string, string>()
  return { store, available: true }
})
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `p-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: { getPath: () => mkdtempSync(join(tmpdir(), 'parity-ud-')) },
}))

import { openNodeDatabase } from '../../../../../apps/cli/src/db/database'
import { EventLog } from '../../../../../apps/cli/src/session/event-log'
import { ControlLeaseService } from '../../../../../apps/cli/src/session/control-lease'
import { SessionRuntime } from '../../../../../apps/cli/src/session/session-runtime'
import { createMultiHarnessRouter } from '../../../../../apps/cli/src/session/harness-runners'
import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { LocalEnvironmentGateway } from './local-environment-gateway'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'
import { LOCAL_ENVIRONMENT_CAPABILITIES, type EnvironmentGateway } from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'

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

async function waitIdle(gw: EnvironmentGateway, environmentId: string, sessionId: string) {
  for (let i = 0; i < 50; i++) {
    const s = (await gw.sessions.get({ environmentId, sessionId })) as { status: string }
    if (s?.status === 'idle') return s
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('session did not become idle')
}

describe('local vs remote gateway harness parity', () => {
  it('both gateways complete a turn for every Phase-4 harness id', async () => {
    // --- local gateway with in-process SessionRuntime ---
    const localHome = mkdtempSync(join(tmpdir(), 'parity-local-'))
    dirs.push(localHome)
    const db = openNodeDatabase(join(localHome, 'state.sqlite'))
    const envIdLocal = 'local-test-env'
    const events = new EventLog(db, envIdLocal)
    const leases = new ControlLeaseService(db)
    const sessions = new SessionRuntime(
      db,
      events,
      leases,
      envIdLocal,
      createMultiHarnessRouter('codex'),
    )
    const localGw = new LocalEnvironmentGateway({
      dataDir: localHome,
      label: 'local',
      listProjects: () => [{ projectId: 'local-proj', path: localHome, name: 'local' }],
      clientSessionId: 'local-client',
      sessions: {
        create: (input) => sessions.create(input),
        get: (id) => sessions.get(id),
        list: (pid) => sessions.list(pid),
        send: async (input) => sessions.send(input),
        acquireControl: (input) => {
          const lease = leases.acquire({
            resource: { environmentId: envIdLocal, sessionId: input.sessionId },
            holderClientId: input.holderClientId,
            ttlMs: input.ttlMs,
          })
          return {
            leaseId: lease.leaseId,
            generation: lease.generation,
            holderClientId: lease.holderClientId,
            expiresAt: lease.expiresAt,
          }
        },
        respondPermission: (input) =>
          sessions.respondPermission({
            ...input,
            decision: input.decision as 'allow' | 'deny' | 'allow_always',
          }),
      },
    })

    // --- remote gateway ---
    const nodeHome = mkdtempSync(join(tmpdir(), 'parity-node-'))
    const desk = mkdtempSync(join(tmpdir(), 'parity-desk-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'parity-proj-'))
    dirs.push(nodeHome, desk, projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const port = 34000 + Math.floor(Math.random() * 1000)
    const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: port, simulatedHarness: true })
    runtimes.push(rt)
    const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(desk) })
    const pair = rt.auth.createPairingToken()
    const { descriptor } = await manager.pairAndConnect({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'remote',
    })
    const remoteGw = manager.getGateway(descriptor.environmentId)!
    const remoteProject = await remoteGw.openProject(projectDir)

    const localDesc = await localGw.getDescriptor()
    const remoteDesc = await remoteGw.getDescriptor()
    // Local desktop still hosts the original four. Cursor is on the node
    // catalog (PHASE4) but not LOCAL_ENVIRONMENT_CAPABILITIES yet.
    const sharedIds = LOCAL_ENVIRONMENT_CAPABILITIES.harnessIds
    expect(localDesc.capabilities.harnessIds).toEqual(sharedIds)
    for (const id of sharedIds) {
      expect(remoteDesc.capabilities.harnessIds).toContain(id)
    }

    for (const harnessId of sharedIds as HarnessId[]) {
      // Local path
      const localCreated = await localGw.sessions.create({
        project: { environmentId: localGw.getEnvironmentId(), projectId: 'local-proj' },
        providerId: harnessId,
        options: { harnessId },
      })
      const localLease = await localGw.sessions.acquireControl({
        resource: {
          environmentId: localGw.getEnvironmentId(),
          sessionId: localCreated.sessionId,
        },
      })
      await localGw.sessions.send({
        session: {
          environmentId: localGw.getEnvironmentId(),
          sessionId: localCreated.sessionId,
        },
        text: `hi ${harnessId}`,
        leaseId: localLease.leaseId,
        generation: localLease.generation,
      })
      await waitIdle(localGw, localGw.getEnvironmentId(), localCreated.sessionId)

      // Remote path
      const remoteCreated = await remoteGw.sessions.create({
        project: {
          environmentId: descriptor.environmentId,
          projectId: remoteProject.projectId,
        },
        providerId: harnessId,
        options: { harnessId },
      })
      const remoteLease = await remoteGw.sessions.acquireControl({
        resource: {
          environmentId: descriptor.environmentId,
          sessionId: remoteCreated.sessionId,
        },
      })
      await remoteGw.sessions.send({
        session: {
          environmentId: descriptor.environmentId,
          sessionId: remoteCreated.sessionId,
        },
        text: `hi ${harnessId}`,
        leaseId: remoteLease.leaseId,
        generation: remoteLease.generation,
      })
      await waitIdle(remoteGw, descriptor.environmentId, remoteCreated.sessionId)
    }

    manager.disconnectAll()
    db.close()
  })
})
