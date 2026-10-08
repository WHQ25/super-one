/**
 * A Resend of a remote row reaches Session.send through the node's real RPC
 * receipts: the receipt key is per delivery attempt, the message id is not.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import { openNodeDatabase } from '@superone/runtime/db'
import { ControlLeaseService } from '@superone/runtime/lease'
import { IdempotencyService, dispatchRpc, type RpcContext } from '@superone/runtime/server'
import { EventLog, createSqliteHostActionStore } from '@superone/runtime/session'
import type { NodeRpcClient } from '../environment/node-rpc-client'
import { RemoteEnvironmentGateway } from '../environment/remote-environment-gateway'
import type { RemoteControllerRecord } from '../db-remote-controlled-sessions'
import { Session } from '../session/session'
import type { SessionBackend } from '../session/types'
import { DesktopSessionHost, type NodeHostSessionManager } from './desktop-session-host'
import { memoryStore } from './node-host-test-fixtures'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shell-path')>()),
  ensureShellPath: async () => {}, isShellPathReady: () => true,
}))

const ENV = 'env-b'
const CLIENT = 'desktop-a'
const SID = 's1'

/** `messageIdempotency: false` stands for a node predating the message-id guard. */
async function setup({ messageIdempotency = true } = {}) {
  let failStart = true
  const backend = {
    kind: 'claude',
    start: vi.fn(async () => { if (failStart) throw new Error('spawn claude ENOENT') }),
    send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (_listener: (event: AgentEvent) => void) => () => {},
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
    getPendingInteractions: () => [],
  }
  const session = new Session({ id: SID, projectPath: '/b/project', cwd: '/b/project',
    providerId: 'claude', harnessId: 'claude', providerConfig: {}, backend: backend as unknown as SessionBackend })
  const hostSend = vi.spyOn(session, 'send')

  const db = openNodeDatabase(':memory:')
  const leases = new ControlLeaseService(db)
  const projects = [{ projectId: 'p1', path: '/b/project', name: 'project' }]
  const store = memoryStore(() => projects as never)
  store.createRow({ sessionId: SID, projectPath: '/b/project', cwd: '/b/project' })
  store.setController(SID, { clientSessionId: CLIENT } as RemoteControllerRecord, 'claude-base')
  const manager = { getSession: (id: string) => (id === SID ? session : null), onSession: () => () => {} } as unknown as NodeHostSessionManager
  const sessions = new DesktopSessionHost({
    environmentId: ENV, sessions: manager, store, leases,
    events: new EventLog(db, ENV), hostActions: createSqliteHostActionStore(db),
    projectPath: () => '/b/project', controllerLabel: () => null,
  })
  const ctx = {
    idempotency: new IdempotencyService(db),
    leases,
    sessions,
    projects: { get: () => ({ projectId: 'p1', path: '/b/project', extraDirs: [] }) },
    settingsConfigPath: '/nonexistent/config.json',
    client: { clientSessionId: CLIENT, scopes: ['session:operate'] },
  } as unknown as RpcContext

  // NodeRpcClient's contract: one key per call (its own unless given), reused by its transport retries.
  const keys: string[] = []
  let loseNextResponse = false
  const client = {
    getDescriptor: async () => ({ environmentId: ENV, capabilities: { messageIdempotency } }),
    async rpc(method: string, payload: unknown, _environmentId?: string, commandKey?: string) {
      const idempotencyKey = commandKey || randomUUID()
      keys.push(idempotencyKey)
      let res = await dispatchRpc(method, payload, { ...ctx, idempotencyKey })
      if (loseNextResponse) {
        loseNextResponse = false
        res = await dispatchRpc(method, payload, { ...ctx, idempotencyKey })
      }
      if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
      return res.result
    },
  } as unknown as NodeRpcClient
  const gateway = new RemoteEnvironmentGateway(client)
  await gateway.getDescriptor()

  const acquire = () => leases.acquire({ resource: { environmentId: ENV, sessionId: SID }, holderClientId: CLIENT })
  const send = (lease: { leaseId: string; generation: string }) => gateway.sessions.send({
    session: { environmentId: ENV, sessionId: SID }, text: 'hello', clientMessageId: 'u1',
    leaseId: lease.leaseId, generation: lease.generation,
  })
  const row = () => session.snapshot.messages.find((message) => message.id === 'u1')
  return {
    session, backend, hostSend, keys, acquire, send, row, leases,
    startSucceeds: () => { failStart = false },
    loseNextResponse: () => { loseNextResponse = true },
  }
}

describe('Resend of a remote row the node accepted and then failed', () => {
  async function acceptedThenFailed() {
    const t = await setup()
    const lease = t.acquire()
    await t.send(lease)
    await vi.waitFor(() => expect(t.row()?.metadata?.sendFailure).toEqual({ error: 'spawn claude ENOENT' }))
    t.startSucceeds()
    return { ...t, lease }
  }

  it('runs the task again instead of replaying the acceptance receipt', async () => {
    const t = await acceptedThenFailed()
    await t.send(t.lease)

    expect(t.hostSend).toHaveBeenCalledTimes(2)
    expect(t.backend.send).toHaveBeenCalledOnce()
    expect(t.backend.send).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'u1' }), expect.anything())
    expect(t.row()?.metadata?.sendFailure).toBeUndefined()
    expect(new Set(t.keys).size).toBe(2)
  })

  it('runs it under a lease taken after the failure', async () => {
    const t = await acceptedThenFailed()
    t.leases.release(t.lease.leaseId, t.lease.generation, CLIENT)
    const fresh = t.acquire()
    expect(fresh.leaseId).not.toBe(t.lease.leaseId)

    await t.send(fresh)

    expect(t.backend.send).toHaveBeenCalledOnce()
    expect(t.row()?.metadata?.sendFailure).toBeUndefined()
  })
})

describe('A send whose response was lost', () => {
  it('replays the receipt for the same attempt and holds a new attempt of the accepted id', async () => {
    const t = await setup()
    t.startSucceeds()
    const lease = t.acquire()
    t.loseNextResponse()
    await t.send(lease)
    // The transport retry under the same key answered from the receipt.
    expect(t.keys).toHaveLength(1)
    expect(t.hostSend).toHaveBeenCalledOnce()

    await t.send(lease)
    expect(t.hostSend).toHaveBeenCalledTimes(2)
    await expect(t.hostSend.mock.results[1]?.value).resolves.toEqual({ duplicate: true })
    expect(t.backend.send).toHaveBeenCalledOnce()
    expect(t.session.snapshot.messages.filter((message) => message.id === 'u1')).toHaveLength(1)
  })

  it('keys a Resend by the message id on a node without the message-id guard, so it runs once', async () => {
    const t = await setup({ messageIdempotency: false })
    t.startSucceeds()
    const lease = t.acquire()
    t.loseNextResponse()
    await t.send(lease)
    await t.send(lease)

    // Every attempt carried the message id, so the node answered the Resend
    // from its receipt without reaching its send.
    expect(t.keys).toEqual(['u1', 'u1'])
    expect(t.hostSend).toHaveBeenCalledOnce()
    expect(t.backend.send).toHaveBeenCalledOnce()
  })
})
