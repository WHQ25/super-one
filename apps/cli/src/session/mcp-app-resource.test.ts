import { expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime, type TurnRunner } from './session-runtime'
import { dispatchMcpAppsRpc } from '../rpc/mcp-apps-handlers'
import type { RpcContext } from '../rpc/handlers'

it('deduplicates node HTML, authorizes scoped fetches, restores fixed history, and collects unique deleted-session blobs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'node-mcp-resource-'))
  const db = openNodeDatabase(join(directory, 'node.db')), events = new EventLog(db, 'node'), leases = new ControlLeaseService(db)
  const runner: TurnRunner = async ({ session, messageId, onAgentEvent }) => {
    for (const id of ['shared', 'unique']) onAgentEvent?.({ type: 'content_delta', messageId: messageId!, delta: { type: 'tool_result', toolUseId: id, summary: 'done', app: { appInstanceId: id, status: 'result', resourceUri: 'ui://cad', origin: { providerSessionId: 'thread' }, binding: { node: 'node', session: session.sessionId, server: 'CAD', configGeneration: 1, configFingerprint: 'cfg' } } } })
    return { finalText: 'done', providerResume: 'thread' }
  }
  let runtime = new SessionRuntime(db, events, leases, 'node', runner)
  try {
    const a = runtime.create({ projectId: 'project', harnessId: 'codex' }), b = runtime.create({ projectId: 'project', harnessId: 'codex' })
    for (const session of [a, b]) {
      const control = leases.acquire({ resource: { environmentId: 'node', sessionId: session.sessionId }, holderClientId: 'client', ttlMs: 30_000 })
      await runtime.send({ sessionId: session.sessionId, text: 'open', client: { clientSessionId: 'client' }, leaseId: control.leaseId, generation: control.generation })
      for (let tries = 0; runtime.get(session.sessionId)?.status === 'streaming' && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 5))
      expect(runtime.get(session.sessionId)?.status).toBe('idle')
      for (const id of ['shared', 'unique']) runtime.updateMcpApp(session.sessionId, id, { resource: { hash: 'ignored', meta: {}, html: id === 'shared' ? 'shared HTML' : session.sessionId } })
    }
    const shared = runtime.resolveMcpAppAttachment(a.sessionId, 'shared').app.resource!, unique = runtime.resolveMcpAppAttachment(a.sessionId, 'unique').app.resource!
    expect(() => runtime.updateMcpApp(a.sessionId, 'shared', { resource: { hash: unique.hash, meta: {} } })).toThrow('must include HTML')
    expect(shared).not.toHaveProperty('html'); expect(readdirSync(join(directory, 'mcp-app-resources'))).toHaveLength(3)
    expect(JSON.stringify(runtime.listMessages({ sessionId: a.sessionId }))).not.toContain('shared HTML')
    const ctx = { identity: { environmentId: 'node' }, client: { scopes: ['session:read'], clientSessionId: 'client' }, sessions: runtime, leases } as unknown as RpcContext
    expect(await dispatchMcpAppsRpc('mcpApps.resource', { sessionId: a.sessionId, appInstanceId: 'shared', hash: unique.hash }, ctx)).toMatchObject({ result: { ok: true, value: { html: 'shared HTML' } } })
    expect(await dispatchMcpAppsRpc('mcpApps.resource', { sessionId: a.sessionId, hash: shared.hash }, ctx)).toMatchObject({ error: { code: 'invalid_argument' } })
    expect(await dispatchMcpAppsRpc('mcpApps.resource', { sessionId: 'not-authorized', appInstanceId: 'shared', hash: shared.hash }, ctx)).toMatchObject({ result: { ok: false } })
    expect(await dispatchMcpAppsRpc('mcpApps.resource', { sessionId: a.sessionId, appInstanceId: 'shared' }, { ...ctx, client: { ...ctx.client, scopes: [] } })).toMatchObject({ error: { code: 'forbidden' } })
    await runtime.dispose(); runtime = new SessionRuntime(db, events, leases, 'node', runner)
    expect(runtime.loadMcpAppResource(a.sessionId, 'shared').html).toBe('shared HTML')
    const old = new Date(Date.now() - 600_000)
    for (const file of readdirSync(join(directory, 'mcp-app-resources'))) utimesSync(join(directory, 'mcp-app-resources', file), old, old)
    runtime.remove(a.sessionId)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(existsSync(join(directory, 'mcp-app-resources', `${unique.hash}.html`))).toBe(false)
    expect(existsSync(join(directory, 'mcp-app-resources', `${shared.hash}.html`))).toBe(true)
    runtime.remove(b.sessionId)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(readdirSync(join(directory, 'mcp-app-resources'))).toEqual([])
  } finally { await runtime.dispose(); db.close(); rmSync(directory, { recursive: true, force: true }) }
})
