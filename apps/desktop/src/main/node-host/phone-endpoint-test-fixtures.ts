import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecentFolder } from '@superone/shared/agent-types'
import { DATABASE_SCHEMA_GENERATION, PROTOCOL_GENERATION } from '@superone/shared/environment'
import { encodePlainMessage, WireDecoder } from '@superone/shared/environment/wire'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { createDesktopProjectsPort } from './desktop-projects-port'
import { DesktopDomain, type DesktopDomainDeps } from './desktop-domain'
import { AGENT_PROFILES, FakeSessionManager, memoryStore, type FakeSession } from './node-host-test-fixtures'
import { openPhoneConnection } from './phone-endpoint'
import type { LocalSessionEdits } from './local-session-host'

/**
 * A desktop domain over one Git project with one session this desktop's user
 * runs. `cleanup` collects what the caller tears down after each test.
 */
export function phoneDomain(cleanup: Array<() => void>, extra: Partial<DesktopDomainDeps> = {}) {
  const tempDir = (prefix: string) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    return dir
  }
  const projectDir = tempDir('superone-domain-project-')
  execFileSync('git', ['init', '-q', projectDir])
  const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
  const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
  const sessions = new FakeSessionManager()
  const store = memoryStore(() => projects.list())
  const harnessDb = openNodeDatabase(':memory:')
  const harnesses = new HarnessManager(harnessDb)
  harnesses.enableSimulatedOverlay()
  cleanup.push(() => harnessDb.close())
  const userDataDir = tempDir('superone-domain-')
  const sessionEdits: LocalSessionEdits = {
    create: store.createRow,
    rename: (id, title) => { const row = store.rows.get(id)!; store.rows.set(id, { ...row, title }) },
    tags: (id, tags) => { const row = store.rows.get(id)!; store.rows.set(id, { ...row, tags }) },
    flags: (id, flags) => { const row = store.rows.get(id)!; store.rows.set(id, { ...row, ...flags }) },
    remove: (id) => { store.rows.delete(id) },
    close: (id) => sessions.disposeSession(id),
  }
  const domain = DesktopDomain.open({
    userDataDir, appVersion: '0.0.0-test', sessions, store, rows: store.all, projects, harnesses,
    listAgentProfiles: () => AGENT_PROFILES,
    hooks: { probeHarnessReadiness: () => ({ ok: true }) as never, assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }) },
    sessionEdits,
    ...extra,
  })
  cleanup.push(() => domain.close())
  store.createRow({ sessionId: 'own', projectPath: projectDir, title: 'Mine', cwd: projectDir })
  const own = sessions.createSession({ id: 'own', projectPath: projectDir }) as unknown as FakeSession
  return { domain, own, sessions, projectDir, userDataDir, store, sessionEdits }
}

/** An RPC answered with an error, as the client sees it. */
export type PhoneRpcError = Error & { code: string; details?: Record<string, unknown> }

/**
 * A phone on one link to the domain's endpoint, speaking the protocol as the
 * phone client will: generation handshake, envelopes with the environment id,
 * replies matched by request id, pushes collected in order.
 */
export async function connectPhone(domain: DesktopDomain, opts: { transport?: 'lan' | 'relay'; deviceId?: string } = {}) {
  const decoder = new WireDecoder(nodeWireCompression)
  const pending = new Map<string, { resolve(value: unknown): void; reject(err: Error): void }>()
  const pushes: Array<Record<string, unknown>> = []
  let closed: { code: number; reason: string } | null = null
  let nextId = 0
  const connection = openPhoneConnection(domain, {
    deviceId: opts.deviceId ?? 'phone-1',
    keyId: 'key-1',
    transport: opts.transport ?? 'relay',
    write: (frame) => {
      const message = decoder.decode(frame) as Record<string, unknown> | undefined
      if (!message) return
      const waiter = typeof message.requestId === 'string' ? pending.get(message.requestId) : undefined
      if (!waiter) {
        pushes.push(message)
        return
      }
      pending.delete(message.requestId as string)
      if (message.type === 'rpc_error') {
        const error = message.error as { code: string; message: string; details?: Record<string, unknown> }
        waiter.reject(Object.assign(new Error(error.message), error))
      } else {
        waiter.resolve(message.result)
      }
    },
    buffered: () => 0,
    close: (code, reason) => { closed = { code, reason } },
  })
  const send = <T>(message: Record<string, unknown>): Promise<T> => {
    const requestId = `r${++nextId}`
    const reply = new Promise<T>((resolve, reject) => pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject }))
    connection.receive(encodePlainMessage({ ...message, requestId }))
    return reply
  }
  await send({ type: 'handshake', payload: { protocol: { ...PROTOCOL_GENERATION }, databaseSchema: { ...DATABASE_SCHEMA_GENERATION } } })
  return {
    rpc: <T = unknown>(method: string, payload: unknown = {}, idempotencyKey = `${method}-${nextId + 1}`) =>
      send<T>({
        type: 'rpc', method, payload, idempotencyKey,
        environmentId: domain.identity.environmentId, protocolVersion: PROTOCOL_GENERATION.current,
      }),
    pushes,
    closed: () => closed,
    close: () => connection.close(),
  }
}

export type { FakeSession }
