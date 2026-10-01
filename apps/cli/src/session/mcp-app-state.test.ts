import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findMcpAppAttachment } from '@superone/shared/mcp-apps-state'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime, type TurnRunner } from './session-runtime'
import { dispatchMcpAppsRpc } from '../rpc/mcp-apps-handlers'
import type { RpcContext } from '../rpc/handlers'

describe('durable node MCP App host updates', () => {
  it.each(['claude', 'codex'] as const)('persists %s snapshots/context through authenticated RPC and a runtime restart', async harness => {
    const directory = mkdtempSync(join(tmpdir(), 'mcp-app-state-'))
    const db = openNodeDatabase(join(directory, 'state.sqlite'))
    const events = new EventLog(db, 'node')
    const leases = new ControlLeaseService(db)
    const modelInputs: string[] = []
    const runner: TurnRunner = async ({ session, messageId, text, onAgentEvent }) => {
      if (!messageId) throw new Error('Runtime must supply a message ID')
      modelInputs.push(text)
      const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'node', session: session.sessionId, server: 'fixture', account: 'account', configGeneration: 0, configFingerprint: 'config' },
        origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result', toolResult: { content: [], _meta: { secret: 'view-only' } } }
      if (modelInputs.length === 1) {
        if (harness === 'claude') onAgentEvent?.({ type: 'content_delta', messageId, delta: { type: 'tool_result', toolUseId: 'call', summary: 'done', app } })
        else onAgentEvent?.({ type: 'codex_item_delta', messageId, phase: 'completed', item: { type: 'mcp_tool_call', id: 'call', server: 'fixture', tool: 'items', arguments: {}, status: 'completed', app } })
      }
      return { finalText: 'done', providerResume: 'thread' }
    }
    let runtime = new SessionRuntime(db, events, leases, 'node', runner)
    try {
      const session = runtime.create({ projectId: 'project', harnessId: harness })
      const lease = leases.acquire({ resource: { environmentId: 'node', sessionId: session.sessionId }, holderClientId: 'client', ttlMs: 30_000 })
      const control = { leaseId: lease.leaseId, generation: lease.generation }
      const send = async (text: string) => {
        await runtime.send({ sessionId: session.sessionId, text, client: { clientSessionId: 'client' }, ...control })
        const deadline = Date.now() + 3000
        while (runtime.get(session.sessionId)?.status === 'streaming' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
        expect(runtime.get(session.sessionId)?.status, JSON.stringify(events.listAfter('0'))).toBe('idle')
      }
      await send('initial')
      const context = () => ({ identity: { environmentId: 'node' }, client: { scopes: ['session:operate'], clientSessionId: 'client' }, leases, sessions: runtime }) as unknown as RpcContext
      const readContext = () => ({ ...context(), client: { ...context().client, scopes: ['session:read'] } }) as RpcContext
      const lookup = { sessionId: session.sessionId, appInstanceId: 'view', messageId: 'stale-hint' }
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', lookup, context())).toMatchObject({ error: { code: 'forbidden' } })
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', lookup, readContext())).toMatchObject({ result: { ok: true, value: { projectId: 'project', app: { appInstanceId: 'view' }, sessionApprovals: [] } } })
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', { ...lookup, sessionId: 'another-session' }, readContext())).toMatchObject({ result: { ok: false, error: { code: 'denied' } } })
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', { ...lookup, appInstanceId: 'missing' }, readContext())).toMatchObject({ result: { ok: false, error: { code: 'denied' } } })
      const update = { resource: { html: '<html>persisted</html>', hash: 'hash', meta: {} }, modelContext: { structuredContent: { selected: 'b' }, source: { appInstanceId: 'forged', server: 'forged' } } }
      const payload = { sessionId: session.sessionId, appInstanceId: 'view', update, ...control }
      expect(await dispatchMcpAppsRpc('mcpApps.state', payload, context())).toEqual({ result: { ok: true, value: null } })
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', lookup, readContext())).toMatchObject({ result: { ok: true, value: { app: { resource: update.resource } } } })
      expect(findMcpAppAttachment(runtime.listMessages({ sessionId: session.sessionId }).messages, 'view')?.app.modelContext?.source).toEqual({ appInstanceId: 'view', server: 'fixture' })
      expect(await dispatchMcpAppsRpc('mcpApps.state', { ...payload, leaseId: 'wrong' }, context())).toMatchObject({ result: { ok: false, error: { code: 'denied' } } })
      expect(await dispatchMcpAppsRpc('mcpApps.state', { ...payload, appInstanceId: 'missing' }, context())).toMatchObject({ result: { ok: false, error: { code: 'denied' } } })
      const approval = { node: 'node', session: session.sessionId, server: 'fixture', account: 'other', configFingerprint: 'config', tool: 'next_page' }
      expect(await dispatchMcpAppsRpc('mcpApps.state', { ...payload, update: { approvedTools: [approval] } }, context())).toMatchObject({ result: { ok: false, error: { code: 'denied' } } })
      const validApproval = { ...approval, account: 'account' }
      expect(await dispatchMcpAppsRpc('mcpApps.state', { ...payload, update: { approvedTools: [validApproval] } }, context())).toMatchObject({ result: { ok: true } })
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', lookup, readContext())).toMatchObject({ result: { ok: true, value: { sessionApprovals: [validApproval] } } })
      await runtime.dispose()
      runtime = new SessionRuntime(db, events, leases, 'node', runner)
      expect(findMcpAppAttachment(runtime.listMessages({ sessionId: session.sessionId }).messages, 'view')?.app.resource?.html).toBe('<html>persisted</html>')
      expect(await dispatchMcpAppsRpc('mcpApps.resolveAttachment', lookup, readContext())).toMatchObject({ result: { ok: true, value: { app: { resource: update.resource }, sessionApprovals: [validApproval] } } })
      await send('next user turn')
      expect(modelInputs[1]).toContain('"selected":"b"')
      expect(modelInputs[1]!.match(/<mcp-app-context>/g)).toHaveLength(1)
      expect(modelInputs[1]).not.toContain('view-only')
      expect(runtime.get(session.sessionId)?.transcript.at(-2)?.text).toBe('next user turn')
    } finally {
      await runtime.dispose()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
