import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import type { McpAppsProvider, ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment } from '@superone/shared/mcp-apps-state'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `m-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { NodeConnectionManager } from '../environment/node-connection-manager'
import { NodeCredentialStore } from '../environment/node-credential-store'
import { RemoteEnvironmentGateway } from '../environment/remote-environment-gateway'
import { startTestDesktopNode } from './node-host-test-fixtures'

/** Desktop A using the MCP Apps and the sync zone of sessions on desktop B. */

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** B with one project, A paired with it, and a session A started on B under A's lease. */
async function controllerSession() {
  const userData = tempDir('superone-mcp-b-')
  const projectDir = tempDir('superone-mcp-project-')
  const { host, sessions, close } = await startTestDesktopNode({ userDataDir: userData, projectDir, listen: { bindPort: 0 } })
  cleanup.push(close)
  const pairing = host.mintPairingToken()
  const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-mcp-a-')) })
  cleanup.push(() => manager.disconnectAll())
  const { connectionId } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
  const client = manager.getClient(connectionId)!
  const { sessionId } = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
  const control = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId })
  const gateway = new RemoteEnvironmentGateway(client)
  await gateway.getDescriptor()
  return { userData, projectDir, sessions, client, gateway, sessionId, live: sessions.live.get(sessionId)!, control: { leaseId: control.leaseId, generation: control.generation } }
}

describe('DesktopNodeHost MCP Apps', () => {
  it("serves a controller the Apps of B's sessions: attachment, host state, saved HTML and provider calls", async () => {
    const { gateway, sessionId, live, control } = await controllerSession()
    // B's own backends bind its Apps to `local`.
    const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: sessionId, server: 'fixture', configGeneration: 0, configFingerprint: 'config' },
      origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result' }
    live.emitHostEvent({ type: 'message_start', message: { id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude',
      content: [{ type: 'tool_use', toolUseId: 'call', toolName: 'fixture.view', input: '{}', status: 'complete', app }] } } as AgentEvent)
    const lookup = { sessionId, appInstanceId: 'view' }

    expect(await gateway.resolveMcpAppAttachment(lookup)).toMatchObject({ ok: true, value: { projectId: 'p1', messageId: 'm', app: { binding: { node: 'local', session: sessionId } } } })
    expect(await gateway.resolveMcpAppAttachment({ ...lookup, appInstanceId: 'missing' })).toMatchObject({ ok: false, error: { code: 'denied' } })

    // A's View writes host state under its lease; the context is attributed to the App, never to what A claims.
    const html = '<html>picked</html>'
    const update = { resource: { html, hash: createHash('sha256').update(html).digest('hex'), meta: {} },
      modelContext: { updateId: 'u1', content: [{ type: 'text' as const, text: 'Selected b' }], source: { appInstanceId: 'forged', server: 'forged' } } }
    expect(await gateway.updateMcpAppState({ ...lookup, update, ...control })).toEqual({ ok: true, value: null })
    expect(findMcpAppAttachment(live.snapshot.messages, 'view')?.app.modelContext?.source).toEqual({ appInstanceId: 'view', server: 'fixture' })
    expect(await gateway.loadMcpAppResource(lookup)).toMatchObject({ ok: true, value: { html } })
    expect(await gateway.updateMcpAppState({ ...lookup, update, ...control, leaseId: 'stale' })).toMatchObject({ ok: false, error: { code: 'denied' } })

    // Provider operations reach the session's MCP connection with the binding as B wrote it.
    live.mcpAppsProvider = {
      tools: async () => new Map([['pick', { name: 'pick', inputSchema: { type: 'object' } }]]),
      callTool: async () => ({ result: { content: [{ type: 'text', text: 'picked b' }] } }),
      dispose: () => {},
    } as unknown as McpAppsProvider
    const provider = { binding: app.binding, origin: app.origin!, ...control }
    expect(await gateway.requestMcpAppsProvider({ ...provider, operation: 'tools' })).toMatchObject({ ok: true, value: [{ name: 'pick' }] })
    expect(await gateway.requestMcpAppsProvider({ ...provider, operation: 'callTool', tool: 'pick', args: {} }, new AbortController().signal))
      .toMatchObject({ ok: true, value: { result: { content: [{ text: 'picked b' }] } } })
    await expect(gateway.requestMcpAppsProvider({ ...provider, operation: 'callTool', tool: 'pick', args: {}, leaseId: 'stale' }))
      .rejects.toMatchObject({ code: 'failed_precondition' })
  })
})

describe('DesktopNodeHost sync zone', () => {
  it("takes a controller's artifact into B's own sync zone and wakes the session once", async () => {
    const { userData, gateway, sessionId, live, control } = await controllerSession()
    const syncRoot = join(userData, 'sync')
    expect(gateway.syncZone()).toMatchObject({ syncRoot })
    const bytes = Buffer.from('screenshot bytes')
    const shot = { sessionId, relativePath: 'browser/shot.png' }

    expect(await gateway.artifacts.put({ ...shot, transferId: 't1', offset: 0, total: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      chunk: bytes.toString('base64'), final: true }, control)).toMatchObject({ ok: true, bytesWritten: bytes.length })
    expect(readFileSync(join(syncRoot, sessionId, 'browser', 'shot.png'), 'utf8')).toBe('screenshot bytes')
    expect(await gateway.artifacts.stat(shot)).toMatchObject({ exists: true, size: bytes.length })
    expect(await gateway.artifacts.list({ sessionId, relativePath: 'browser' })).toMatchObject({ exists: true, entries: [{ relativePath: 'browser/shot.png', size: bytes.length }] })
    const read = await gateway.artifacts.get({ ...shot, offset: 0, maxBytes: 1024 })
    expect(Buffer.from(read.chunk, 'base64').toString()).toBe('screenshot bytes')

    // The wake names the file as B resolved it, once per notification however often A retries.
    const notify = { sessionId, notificationId: 'job-1', relativePaths: ['browser/shot.png'] }
    expect(await gateway.artifacts.notifyCompleted(notify)).toEqual({ delivered: true })
    expect(await gateway.artifacts.notifyCompleted(notify)).toEqual({ delivered: true })
    expect(live.wakes).toHaveLength(1)
    expect(live.wakes[0]).toContain(JSON.stringify(join(realpathSync(syncRoot), sessionId, 'browser', 'shot.png')))
    expect(await gateway.artifacts.notifyCompleted({ ...notify, notificationId: 'job-2', relativePaths: ['browser/missing.png'] })).toEqual({ delivered: false })

    await expect(gateway.artifacts.delete(shot, { ...control, leaseId: 'stale' })).rejects.toBeTruthy()
    expect(await gateway.artifacts.delete(shot, control)).toEqual({ ok: true })
    expect(existsSync(join(syncRoot, sessionId, 'browser', 'shot.png'))).toBe(false)
  })

  it("keeps B's own sessions' zones from a controller", async () => {
    const { sessions, projectDir, gateway } = await controllerSession()
    sessions.createSession({ id: 'own-session', projectPath: projectDir })
    await expect(gateway.artifacts.stat({ sessionId: 'own-session', relativePath: 'agent/a.txt' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(gateway.artifacts.notifyCompleted({ sessionId: 'own-session', notificationId: 'n', relativePaths: ['agent/a.txt'] })).rejects.toMatchObject({ code: 'forbidden' })
    expect(sessions.live.get('own-session')!.wakes).toEqual([])
  })
})
