import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { mapInteractionUpdate } from '@superone/cursor'
import { McpAppsError, type McpAppHostOperation } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, mcpAppModelContextText, updateMcpAppAttachments, type McpAppMessage } from '@superone/shared/mcp-apps-state'
import { McpAppExecutor, type McpAppExecutorPorts } from './executor-core'
import { executeMiniappCall, executeMiniappList, type MiniappToolDeps } from '../mcp/miniapp-mcp-tools'
import { resolveMiniappCallConfirm } from '../mcp/miniapp-call-confirm'
import { closeCompatSession, getCompatSession } from './compat-registry'
import type { McpServerConfig } from '@superone/shared/agent-types'

vi.mock('../shell-path', () => ({ ensureShellPath: async () => undefined }))
vi.mock('../logger', () => ({ default: { debug: () => undefined } }))
const { listed } = vi.hoisted(() => ({ listed: [] as McpServerConfig[] }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => listed }))
import { LocalCompatSession, compatConfigFingerprint, prepareCompatSession } from './compat-session'

const fixture = fileURLToPath(new URL('../../test/fixtures/mcp-apps/fixture-server.ts', import.meta.url))
const config = { name: 'fixture', type: 'stdio' as const, scope: 'project' as const,
  command: process.execPath, args: [fixture, '--stdio'] }
const sessions: LocalCompatSession[] = []
const dirs: string[] = []
afterEach(async () => {
  await closeCompatSession('prepare'); listed.length = 0
  await Promise.all(sessions.splice(0).map(s => s.close()))
  dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }))
})
async function connect(id = 'session'): Promise<LocalCompatSession> {
  const session = new LocalCompatSession(id, process.cwd())
  sessions.push(session)
  await session.discover([config])
  return session
}

function deps(session: LocalCompatSession, approved = true): MiniappToolDeps {
  return {
    getAuthorizedApps: () => session.catalog(),
    getAppEntry: (_session, id) => {
      const app = session.catalog().find(a => a.appId === id)
      return app ? { projectDir: '', tools: app.tools } : null
    },
    dispatchAppToolCall: vi.fn(async () => { throw new Error('must not enter the MiniApp Host') }),
    dispatchCompatToolCall: async (_session, id, tool, input) => session.call(id, tool, input),
    isAppToolPreapproved: () => approved,
    markAppToolPreapproved: () => undefined,
    getEmitHostEvent: () => event => {
      if (event.type === 'permission_request') resolveMiniappCallConfirm(event.request.requestId, 'decline')
    },
  }
}

describe('Cursor compatibility with the real stdio MCP Apps fixture', () => {
  it('discovers UI, exposes model tools, preserves host data and serves View calls through the gate', async () => {
    const session = await connect()
    expect([...session.omittedServers]).toEqual(['fixture'])
    const [app] = session.catalog()
    expect(app.tools.map(t => t.name)).toContain('fixture_model_echo')
    expect(app.tools.map(t => t.name)).not.toContain('fixture_next_page')
    const list = await executeMiniappList('session', { appId: app.appId }, deps(session))
    expect(JSON.parse(list.content[0].text).tools[0].inputSchema).toBeDefined()
    const info = await session.call(app.appId, 'fixture_client_info', {})
    expect(info.content[0].text).toContain('io.modelcontextprotocol/ui')
    const reply = await executeMiniappCall('session', { appId: app.appId, tool: 'fixture_list_items', input: { page: 1 } }, deps(session))
    expect(reply.structuredContent).toMatchObject({ page: 1 })
    expect(JSON.stringify(reply)).not.toContain('fixture/private')
    const events = mapInteractionUpdate('m', { type: 'tool-call-completed', callId: 'cursor-call', toolCall: {
      type: 'mcp', args: { providerIdentifier: 'superone', toolName: 'miniapp_call', args: {} },
      result: { status: 'success', value: { content: reply.content, isError: reply.isError } },
    } } as never).map(e => session.attach(e))
    const last = events.at(-1)!
    if (last.type !== 'content_delta' || last.delta.type !== 'tool_result' || !last.delta.app) throw new Error('no App record')
    const record = last.delta.app
    expect(record.toolResult?._meta).toMatchObject({ 'fixture/private': { token: 'private-1' } })
    expect(record.toolResult?.structuredContent).toMatchObject({ page: 1 })
    const provider = () => session.provider(record.binding, record.origin!)
    const read = await dispatchMcpAppsProviderRequest({ binding: record.binding, operation: 'readResource', uri: record.resourceUri }, provider())
    expect(read).toMatchObject({ ok: true, value: { contents: [{ mimeType: 'text/html;profile=mcp-app', text: expect.stringContaining('Next page') }] } })
    const next = await dispatchMcpAppsProviderRequest({ binding: record.binding, operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } }, provider())
    expect(next).toMatchObject({ ok: true, value: { outcome: 'completed', result: { structuredContent: { page: 2 } } } })
    const denied = await dispatchMcpAppsProviderRequest({ binding: record.binding, operation: 'callTool', tool: 'fixture_model_echo', args: { text: 'no' } }, provider())
    expect(denied).toMatchObject({ ok: false, error: { code: 'denied' } })
    await expect(session.call(app.appId, 'fixture_next_page', { page: 2 })).rejects.toMatchObject({ code: 'denied' })
    expect(() => session.provider({ ...record.binding, session: 'other' }, record.origin!)).toThrow('binding mismatch')

    // A real host record supplies View data independently of Cursor's text-only reply.
    let messages: McpAppMessage[] = [{ id: 'm', content: [last.delta] }]
    const ports: McpAppExecutorPorts = {
      resolve: async (ref, id, hint) => {
        const found = findMcpAppAttachment(messages, id, hint)
        if (!found) throw new McpAppsError('denied', 'Unknown View')
        return { ref, node: 'local', projectPath: process.cwd(), ...found }
      },
      persist: async (_target, update) => { messages = updateMcpAppAttachments(messages, record.appInstanceId, update) },
      provider: async (target, operation, signal) => dispatchMcpAppsProviderRequest({ ...operation,
        binding: target.app.binding, origin: target.app.origin }, provider(), signal),
      sendMessage: vi.fn(async () => undefined),
    }
    const executor = new McpAppExecutor(ports)
    executor.observeLive({ environmentId: 'local', sessionId: 'session' }, record)
    const run = (host: McpAppExecutor, operation: McpAppHostOperation) => host.execute({
      sessionKey: 'local:session', appInstanceId: record.appInstanceId, messageId: 'm', ...operation,
    }, { kind: 'desktop' }, new AbortController().signal)
    expect(await run(executor, { operation: 'load' })).toMatchObject({ ok: true,
      value: { html: expect.stringContaining('Next page'), meta: { prefersBorder: true } } })
    expect(findMcpAppAttachment(messages, record.appInstanceId)?.app.resource?.hash).toHaveLength(64)
    expect(await run(executor, { operation: 'callTool', tool: 'fixture_next_page', args: { page: 3 } })).toMatchObject({
      ok: true, value: { result: { structuredContent: { page: 3 }, _meta: { 'fixture/private': { token: 'private-3' } } } },
    })
    expect(await run(executor, { operation: 'callTool', tool: 'fixture_model_echo', args: { text: 'no' } })).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(ports.sendMessage).not.toHaveBeenCalled()
    const restored = new McpAppExecutor(ports)
    const providerCalls = vi.spyOn(session, 'provider')
    expect(await run(restored, { operation: 'load' })).toMatchObject({ ok: true })
    expect(providerCalls).not.toHaveBeenCalled()
    expect(await run(restored, { operation: 'callTool', tool: 'fixture_next_page', args: { page: 4 } })).toMatchObject({ ok: false, error: { code: 'inactive' } })
    expect(await run(restored, { operation: 'activate' })).toMatchObject({ ok: true, value: { mode: 'gateway' } })
    expect(await run(restored, { operation: 'callTool', tool: 'fixture_next_page', args: { page: 4 } })).toMatchObject({ ok: true, value: { result: { structuredContent: { page: 4 } } } })
    expect(await run(restored, { operation: 'updateModelContext', context: { content: [{ type: 'text', text: 'Selected item-10' }],
      source: { appInstanceId: 'forged', server: 'forged' } } })).toMatchObject({ ok: true })
    const context = mcpAppModelContextText(messages)
    expect(context).toContain('Selected item-10')
    expect(context).toContain(record.appInstanceId)
    expect(context).not.toContain('fixture/private')
    expect(context).not.toContain('forged')
    providerCalls.mockRestore()
    const handle = provider()
    await session.close()
    expect(await dispatchMcpAppsProviderRequest({ binding: record.binding, operation: 'ready' }, handle)).toMatchObject({ ok: false })
  })

  it('denies before dispatch and returns completed isError results without retry', async () => {
    const session = await connect('permissions')
    const [app] = session.catalog()
    const call = vi.spyOn(session, 'call')
    const denied = await executeMiniappCall('permissions', { appId: app.appId, tool: 'fixture_list_items' }, deps(session, false))
    expect(denied.content[0].text).toContain('denied')
    expect(call).not.toHaveBeenCalled()
    const hidden = await executeMiniappCall('permissions', { appId: app.appId, tool: 'fixture_next_page', input: { page: 2 } }, deps(session))
    expect(hidden.isError).toBe(true)
    expect(call).not.toHaveBeenCalled()
    const failed = await executeMiniappCall('permissions', { appId: app.appId, tool: 'fixture_fail' }, deps(session))
    expect(failed).toMatchObject({ isError: true, content: [{ type: 'text', text: 'fixture failure' }] })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('caches non-App discovery so later sessions do not spawn a second probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-apps-compat-')); dirs.push(dir)
    const require = createRequire(import.meta.url)
    const server = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href
    const stdio = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href
    const source = `import { appendFileSync } from 'node:fs'; import { McpServer } from ${JSON.stringify(server)}; import { StdioServerTransport } from ${JSON.stringify(stdio)}; appendFileSync(${JSON.stringify(join(dir, 'starts'))}, 'x'); const s = new McpServer({name:'plain',version:'1'}); s.registerTool('plain',process.env.FEATURE ? {_meta:{ui:{visibility:['model']}}}:{},async()=>({content:[]})); if (process.env.FEATURE) s.registerTool('malformed',{_meta:{ui:{visibility:'model'}}},async()=>({content:[]})); await s.connect(new StdioServerTransport());`
    writeFileSync(join(dir, 'plain.mjs'), source)
    const plain = { ...config, name: 'plain', args: [join(dir, 'plain.mjs')] }
    for (const id of ['a', 'b']) {
      const session = new LocalCompatSession(id, dir); sessions.push(session)
      await session.discover([plain])
      expect(session.catalog()).toEqual([])
      expect(session.omittedServers.size).toBe(0)
    }
    expect(readFileSync(join(dir, 'starts'), 'utf8')).toBe('x')
    const changed = new LocalCompatSession('changed', dir); sessions.push(changed)
    await changed.discover([{ ...plain, env: { FEATURE: 'changed' } }])
    expect(readFileSync(join(dir, 'starts'), 'utf8')).toBe('xx')
    expect([...changed.omittedServers]).toEqual(['plain'])
    expect(changed.catalog()[0].tools.map(tool => tool.name)).toEqual(['plain'])
    expect(compatConfigFingerprint(dir, plain)).not.toBe(compatConfigFingerprint('/another', plain))
  })

  it('keeps disabled, remote and timed-out servers native and cleans up the child', async () => {
    const session = new LocalCompatSession('timeout', process.cwd(), 25); sessions.push(session)
    await session.discover([
      { ...config, disabled: true },
      { ...config, name: 'http', type: 'http', url: 'http://127.0.0.1:9/mcp' },
      { ...config, name: 'timeout', args: ['-e', 'setInterval(()=>{},1000)'] },
    ])
    expect(session.catalog()).toEqual([])
    expect(session.omittedServers.size).toBe(0)
  })

  it('shares prewarm/start discovery and replaces its connection when configuration changes', async () => {
    listed.push(config)
    const [prewarm, start] = await Promise.all([
      prepareCompatSession('prepare', process.cwd()), prepareCompatSession('prepare', process.cwd()),
    ])
    expect(start).toBe(prewarm)
    expect(start.catalog()).toHaveLength(1)
    listed[0] = { ...config, disabled: true }
    const next = await prepareCompatSession('prepare', process.cwd())
    expect(next).not.toBe(start)
    expect(next.catalog()).toEqual([])
    expect(start.catalog()).toEqual([])
  })

  it('cannot resurrect a closed session or clear a later preparation', async () => {
    listed.push(config)
    const first = prepareCompatSession('prepare', process.cwd())
    const rejected = expect(first).rejects.toMatchObject({ code: 'cancelled' })
    await closeCompatSession('prepare')
    const next = prepareCompatSession('prepare', process.cwd())
    await rejected
    expect((await next).catalog()).toHaveLength(1)
    expect(await prepareCompatSession('prepare', process.cwd())).toBe(await next)
  })

  it('keeps a replacement client alive when an old runtime finishes closing late', async () => {
    listed.push(config)
    const old = await prepareCompatSession('prepare', process.cwd())
    await closeCompatSession('prepare', old)
    const replacement = await prepareCompatSession('prepare', process.cwd())
    await closeCompatSession('prepare', old)
    expect(getCompatSession('prepare')).toBe(replacement)
    expect(replacement.catalog()).toHaveLength(1)
  })
})
