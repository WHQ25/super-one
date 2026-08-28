import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import net, { type Socket } from 'net'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpRoot = mkdtempSync(join(tmpdir(), 'superone-mcp-ipc-'))
const collaborationSettings = vi.hoisted(() => ({ enabled: false }))
const requestSessionAgentsMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpRoot) },
  BrowserWindow: vi.fn(),
}))
vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({}),
}))
vi.mock('../session/session-collaboration', () => ({
  requestSessionAgents: requestSessionAgentsMock,
}))
vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node', env: {} })),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({}))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function (this: Record<string, unknown>) {
    this.tool = vi.fn()
    this.registerTool = vi.fn(() => ({ remove: vi.fn() }))
    this.sendToolListChanged = vi.fn()
    this.isConnected = vi.fn(() => true)
  }),
}))
vi.mock('../miniapp/miniapp-service', () => ({
  createMiniApp: vi.fn(),
  cacheAppEntry: vi.fn(),
}))
vi.mock('../miniapp/miniapp-packager', () => ({
  packApp: vi.fn(),
  getPreapprovedByPath: vi.fn(() => []),
}))
vi.mock('./guides/overview.md?raw', () => ({ default: 'overview content' }))
vi.mock('./guides/manifest.md?raw', () => ({ default: 'manifest' }))
vi.mock('./guides/permissions.md?raw', () => ({ default: 'permissions' }))
vi.mock('./guides/api/theme.md?raw', () => ({ default: 'theme' }))
vi.mock('./guides/api/locale.md?raw', () => ({ default: 'locale' }))
vi.mock('./guides/api/agent.md?raw', () => ({ default: 'agent' }))
vi.mock('./guides/api/system.md?raw', () => ({ default: 'system' }))
vi.mock('./guides/api/ui.md?raw', () => ({ default: 'ui' }))
vi.mock('./guides/api/host.md?raw', () => ({ default: 'miniapp-host' }))
vi.mock('./guides/packaging.md?raw', () => ({ default: 'packaging' }))
vi.mock('./guides/icon.md?raw', () => ({ default: 'icon' }))
vi.mock('./guides/recipes.md?raw', () => ({ default: 'recipes' }))
vi.mock('./guides/tools.md?raw', () => ({ default: 'tools' }))

const {
  startSuperoneMcpStdioBridge,
  stopSuperoneMcpStdioBridge,
} = await import('./superone-mcp-stdio-ipc')
const { getCodexSuperoneMcpConfig, getSuperoneMcpStdioConfig } = await import('./superone-mcp-stdio-state')
const {
  createSuperoneMcpServer,
  disposeSuperoneMcpServer,
  registerAppTools,
  unregisterAppTools,
  markAppToolPreapproved,
  initSuperoneMcpServer,
  setAppToolExecutor,
  setSessionHostProvider,
} = await import('./superone-mcp-server')
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'

const PROJ = '/proj-stdio'
const pluginExecutor = vi.fn<(
  projectDir: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>>()

function makeTools(name: string): MiniAppToolDefinition[] {
  return [{
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
  }]
}

interface IpcResponseMessage {
  id?: number
  result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> }
  error?: { message?: string }
  method?: string
  params?: { sessionId?: string }
}

class TestClient {
  private socket: Socket
  private buffer = ''
  private seq = 1
  private readonly pending = new Map<number, (msg: IpcResponseMessage) => void>()
  readonly notifications: IpcResponseMessage[] = []
  readonly closed: Promise<void>

  constructor(endpoint: string) {
    this.socket = net.createConnection(endpoint)
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.onData(chunk))
    this.closed = new Promise((resolve) => this.socket.once('close', resolve))
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('connect', resolve)
      this.socket.once('error', reject)
    })
  }

  send(method: string, token: string, params: Record<string, unknown>): Promise<IpcResponseMessage> {
    const id = this.seq++
    return new Promise<IpcResponseMessage>((resolve) => {
      this.pending.set(id, resolve)
      this.socket.write(`${JSON.stringify({ id, method, token, params })}\n`)
    })
  }

  close(): void {
    this.socket.destroy()
  }

  notify(method: string, token: string, params: Record<string, unknown>): void {
    this.socket.write(`${JSON.stringify({ method, token, params })}\n`)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) {
        const msg = JSON.parse(line) as IpcResponseMessage
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const resolver = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          resolver(msg)
        } else {
          this.notifications.push(msg)
        }
      }
      idx = this.buffer.indexOf('\n')
    }
  }
}

function getToken(sessionId = PROJ): string {
  const cfg = getSuperoneMcpStdioConfig(sessionId)
  return cfg?.env.SUPERONE_MCP_IPC_TOKEN ?? ''
}

function getEndpoint(): string {
  const cfg = getSuperoneMcpStdioConfig('/x')
  return cfg?.env.SUPERONE_MCP_IPC_ENDPOINT ?? ''
}

describe('superone-mcp-stdio-ipc', () => {
  beforeEach(async () => {
    requestSessionAgentsMock.mockReset()
    pluginExecutor.mockReset().mockResolvedValue({ ok: true })
    setAppToolExecutor(pluginExecutor)
    initSuperoneMcpServer(() => null)
    createSuperoneMcpServer(PROJ)
    await startSuperoneMcpStdioBridge()
  })

  afterEach(async () => {
    stopSuperoneMcpStdioBridge()
    unregisterAppTools(PROJ, PROJ, 'test-app')
    disposeSuperoneMcpServer(PROJ)
    setSessionHostProvider(null)
  })

  it('registers a config with endpoint + token after start', () => {
    const cfg = getSuperoneMcpStdioConfig(PROJ)
    expect(cfg).not.toBeNull()
    expect(cfg!.env.SUPERONE_MCP_SESSION_ID).toBe(PROJ)
    expect(cfg!.env.SUPERONE_MCP_IPC_TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cfg!.env.SUPERONE_MCP_IPC_ENDPOINT).toBeTruthy()
  })

  it('returns null config after stop', () => {
    stopSuperoneMcpStdioBridge()
    expect(getCodexSuperoneMcpConfig(PROJ)).toBeNull()
    expect(getSuperoneMcpStdioConfig(PROJ)).toBeNull()
  })

  it('chmods the unix socket to 0600 on non-Windows platforms', () => {
    if (process.platform === 'win32') return
    const endpoint = getEndpoint()
    const mode = statSync(endpoint).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('rejects requests with the wrong token', async () => {
    const client = new TestClient(getEndpoint())
    await client.ready()
    const res = await client.send('tools/list', 'wrong-token', { sessionId: PROJ })
    expect(res.error?.message).toMatch(/Unauthorized/)
    client.close()
  })

  it('lists built-in superone tools + fixed miniapp tools (not per-app)', async () => {
    registerAppTools(PROJ, PROJ, 'test-app', makeTools('do_thing'))
    markAppToolPreapproved('test-app', 'do_thing')

    const client = new TestClient(getEndpoint())
    await client.ready()
    const res = await client.send('tools/list', getToken(), { sessionId: PROJ })
    const names = (res.result?.tools ?? []).map((t) => t.name)
    expect(names).toContain('read_manual')
    expect(names).toContain('config_read')
    expect(names).toContain('miniapp_list')
    expect(names).toContain('miniapp_call')
    expect(names).not.toContain('myapp__do_thing')
    expect(names).toContain('browser_snapshot')
    expect(names).toContain('browser_act')
    expect(names).toContain('browser_action')
    // The legacy per-verb primitives stay executable but are no longer advertised.
    expect(names).not.toContain('browser_click')
    expect(names).not.toContain('browser_navigate')
    expect(names).not.toContain('browser_action_list')
    client.close()
  })

  it('rejects tools/list without sessionId', async () => {
    const client = new TestClient(getEndpoint())
    await client.ready()
    const res = await client.send('tools/list', getToken(), {})
    expect(res.error?.message).toMatch(/Missing sessionId/)
    client.close()
  })

  it('does not push tools/changed when mini-app authorization changes', async () => {
    const clientA = new TestClient(getEndpoint())
    await clientA.ready()
    await clientA.send('tools/list', getToken(), { sessionId: PROJ })

    const clientB = new TestClient(getEndpoint())
    await clientB.ready()
    await clientB.send('tools/list', getToken('/other-proj'), { sessionId: '/other-proj' })

    registerAppTools(PROJ, PROJ, 'test-app', makeTools('do_thing'))
    markAppToolPreapproved('test-app', 'do_thing')
    await new Promise((r) => setTimeout(r, 30))

    expect(clientA.notifications.some((n) => n.method === 'tools/changed')).toBe(false)
    expect(clientB.notifications.some((n) => n.method === 'tools/changed')).toBe(false)

    clientA.close()
    clientB.close()
  })

  it('executes built-in tools through the bridge', async () => {
    const client = new TestClient(getEndpoint())
    await client.ready()
    const res = await client.send('tools/call', getToken(), {
      sessionId: PROJ,
      name: 'read_manual',
      arguments: { domain: 'miniapp', topic: 'overview' },
    })
    expect(res.result?.content?.[0]?.text).toBe('overview content')
    client.close()
  })

  it('forwards tool cancellation to an in-flight collaboration request', async () => {
    setSessionHostProvider(() => ({
      getSession: () => null,
      createSession: vi.fn(),
      disposeSession: vi.fn(),
    } as never))
    requestSessionAgentsMock.mockImplementation((
      _sessionId: string,
      _args: Record<string, unknown>,
      _host: unknown,
      signal?: AbortSignal,
    ) => new Promise((resolve) => {
      const finish = () => resolve({
        content: [{ type: 'text', text: JSON.stringify({ status: 'cancelled' }) }],
      })
      if (signal?.aborted) finish()
      else signal?.addEventListener('abort', finish, { once: true })
    }))

    const client = new TestClient(getEndpoint())
    await client.ready()
    const inflight = client.send('tools/call', getToken(), {
      sessionId: PROJ,
      name: 'session_collab_request',
      arguments: { launches: [] },
    })
    await vi.waitFor(() => expect(requestSessionAgentsMock).toHaveBeenCalledOnce())
    const signal = requestSessionAgentsMock.mock.calls[0][3] as AbortSignal

    client.notify('requests/cancel', getToken(), { sessionId: PROJ, requestId: 1 })

    const response = await inflight
    expect(signal.aborted).toBe(true)
    expect(response.result?.content?.[0]?.text).toContain('cancelled')
    client.close()
  })

  it('routes miniapp_call to the MiniApp Host scoped by sessionId', async () => {
    registerAppTools(PROJ, PROJ, 'test-app', makeTools('do_thing'))
    markAppToolPreapproved('test-app', 'do_thing')

    const client = new TestClient(getEndpoint())
    await client.ready()
    const res = await client.send('tools/call', getToken(), {
      sessionId: PROJ,
      name: 'miniapp_call',
      arguments: { appId: 'test-app', tool: 'do_thing', input: { x: 'hello' } },
    })

    expect(pluginExecutor).toHaveBeenCalledWith(
      PROJ,
      'test-app',
      'do_thing',
      { x: 'hello' },
    )
    expect(res.result?.content?.[0]?.text).toContain('"ok":true')
    client.close()
  })
})

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
})
