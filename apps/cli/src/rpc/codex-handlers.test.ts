import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { dispatchCodexRpc, type CodexRpcContext } from './codex-handlers'
import { clearCodexAdminAuthForTest } from '../session/codex-admin-service'
import type { CodexSpawnFn } from '@superone/codex'
import { nodeCodexAccountStore } from '../session/codex-accounts'
import { codexAccountProviderId } from '@superone/shared/codex-accounts'

function fakeClient(scopes: string[] = ['environment:read', 'workspace:read', 'node:admin']) {
  return {
    clientSessionId: 'c1',
    scopes,
  } as CodexRpcContext['client']
}

function fakeProjects(path: string) {
  return {
    get: (id: string) => (id === 'p1' ? { path, projectId: 'p1' } : null),
    touch: () => {},
  } as unknown as CodexRpcContext['projects']
}

function fakeHarnesses(command: string | null) {
  return {
    get: (id: string) =>
      id === 'codex' && command
        ? { enabled: true, state: 'ready', command }
        : { enabled: false, state: 'missing', command: null },
  } as unknown as CodexRpcContext['harnesses']
}

type FakeChild = {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill: (sig?: NodeJS.Signals | number) => boolean
  on: EventEmitter['on']
  once: EventEmitter['once']
  emit: EventEmitter['emit']
}

function createFakeChild(): FakeChild {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const ee = new EventEmitter()
  const child: FakeChild = {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill() {
      child.killed = true
      queueMicrotask(() => ee.emit('exit', 0, null))
      stdout.end()
      return true
    },
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    emit: ee.emit.bind(ee),
  }
  return child
}

async function pump(ms = 25) {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Respond to app-server JSON-RPC: initialize, then any request with a canned result map.
 */
function attachAutoResponder(
  child: FakeChild,
  handlers: Record<string, (params: Record<string, unknown>) => Record<string, unknown>>,
) {
  child.stdin.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (!line.trim()) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof msg.method !== 'string' || msg.id == null) continue
      const method = msg.method
      queueMicrotask(() => {
        if (method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })}\n`)
          return
        }
        if (method === 'initialized') return
        const handler = handlers[method]
        const result = handler
          ? handler((msg.params as Record<string, unknown>) ?? {})
          : {}
        child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`)
      })
    }
  })
}

describe('dispatchCodexRpc', () => {
  let dir: string
  let bin: string

  beforeEach(() => {
    clearCodexAdminAuthForTest()
    dir = mkdtempSync(join(tmpdir(), 'codex-rpc-'))
    bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
  })

  afterEach(() => {
    clearCodexAdminAuthForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it('requires admin scope to remove a signed-out card and needs no binary or logout request', async () => {
    const store = nodeCodexAccountStore(dir)
    const removed = store.allocate()
    const kept = store.allocate()
    const ctx: CodexRpcContext = {
      nodeHome: dir, client: fakeClient(['environment:read']), projects: fakeProjects(dir),
      harnesses: fakeHarnesses(null), providers: null as never,
    }
    const params = { projectId: 'p1', apiProviderId: codexAccountProviderId(removed) }
    expect((await dispatchCodexRpc('codex.removeAccount', params, ctx))?.error).toBeDefined()
    expect(store.list()).toHaveLength(2)
    ctx.client = fakeClient(['environment:read', 'node:admin'])
    expect((await dispatchCodexRpc('codex.removeAccount', params, ctx))?.result).toEqual({ ok: true })
    expect(store.list().map((a) => a.id)).toEqual([kept])
  })

  it('codex.getAuthStatus returns default auto status without binary', async () => {
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(null),
      providers: { listCredentials: () => [] } as never,
    }
    const res = await dispatchCodexRpc('codex.getAuthStatus', { projectId: 'p1' }, ctx)
    expect(res?.error).toBeUndefined()
    expect(res?.result).toMatchObject({
      mode: 'auto',
      hasSessionApiKey: false,
    })
  })

  it('codex.setAuth requires node:admin', async () => {
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: { listCredentials: () => [] } as never,
    }
    const res = await dispatchCodexRpc(
      'codex.setAuth',
      { projectId: 'p1', mode: 'chatgpt' },
      ctx,
    )
    expect(res?.error?.code).toBe('forbidden')
  })

  it('codex.setAuth persists mode for getAuthStatus', async () => {
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read', 'node:admin']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: { listCredentials: () => [] } as never,
    }
    const set = await dispatchCodexRpc(
      'codex.setAuth',
      { projectId: 'p1', mode: 'chatgpt' },
      ctx,
    )
    expect(set?.result).toMatchObject({ mode: 'chatgpt', resolvedMode: 'chatgpt' })
    const get = await dispatchCodexRpc('codex.getAuthStatus', { projectId: 'p1' }, ctx)
    expect(get?.result).toMatchObject({ mode: 'chatgpt', resolvedMode: 'chatgpt' })
  })

  it('codex.getAccountUsage fails closed when binary not ready', async () => {
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read', 'node:admin']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(null),
      providers: { listCredentials: () => [] } as never,
    }
    // set chatgpt so usage would attempt connection
    await dispatchCodexRpc('codex.setAuth', { projectId: 'p1', mode: 'chatgpt' }, {
      ...ctx,
      client: fakeClient(['environment:read', 'node:admin']),
    })
    const res = await dispatchCodexRpc('codex.getAccountUsage', { projectId: 'p1' }, ctx)
    expect(res?.error?.code).toBe('failed_precondition')
  })

  it('codex.getAccountUsage parses app-server account/usage/read', async () => {
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'account/usage/read': (params) => {
          expect(params).toEqual({ threadId: 'thread-1' })
          return {
          summary: {
            lifetimeTokens: 42,
            peakDailyTokens: 7,
            longestRunningTurnSec: 3,
            currentStreakDays: 1,
            longestStreakDays: 2,
          },
          }
        },
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })

    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read', 'node:admin']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }
    await dispatchCodexRpc('codex.setAuth', { projectId: 'p1', mode: 'chatgpt' }, ctx)
    const res = await dispatchCodexRpc('codex.getAccountUsage', { projectId: 'p1', threadId: 'thread-1' }, ctx)
    expect(res?.error).toBeUndefined()
    expect(res?.result).toMatchObject({
      lifetimeTokens: 42,
      peakDailyTokens: 7,
    })
  })

  it('shares automatic usage readings and forwards manual refresh through the node RPC', async () => {
    const fetchLimits = vi.fn(() => ({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null } } }))
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'account/read': () => ({ account: { type: 'chatgpt', email: 'rpc-refresh@example.test', planType: 'plus' } }),
        'account/rateLimits/read': fetchLimits,
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir, client: fakeClient(['environment:read', 'node:admin']), projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin), providers: null as never, spawnFn,
    }
    await dispatchCodexRpc('codex.setAuth', { projectId: 'p1', mode: 'chatgpt' }, ctx)
    for (const force of [false, false, true]) {
      const result = await dispatchCodexRpc('codex.getRateLimits', { projectId: 'p1', force }, ctx)
      expect(result?.error).toBeUndefined()
      expect(result?.result).toMatchObject({ primary: { usedPercent: 25 } })
    }
    expect(fetchLimits).toHaveBeenCalledTimes(2)
  })

  it('codex.getServerDiagnostics exposes app-server process gauges', async () => {
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'server/diagnostics': () => ({
          process: { id: 42, residentMemoryBytes: 1024, physicalFootprintBytes: 2048 },
          gauges: [{ name: 'threads', value: 3 }],
        }),
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }

    const res = await dispatchCodexRpc('codex.getServerDiagnostics', { projectId: 'p1' }, ctx)

    expect(res?.error).toBeUndefined()
    expect(res?.result).toEqual({
      process: { id: 42, residentMemoryBytes: 1024, physicalFootprintBytes: 2048 },
      gauges: [{ name: 'threads', value: 3 }],
    })
  })

  it('codex.getConfigRequirements exposes managed policy without dropping future fields', async () => {
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'configRequirements/read': () => ({
          requirements: { allowManagedHooksOnly: true, futurePolicy: { enabled: true } },
        }),
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }

    const res = await dispatchCodexRpc('codex.getConfigRequirements', { projectId: 'p1' }, ctx)

    expect(res?.error).toBeUndefined()
    expect(res?.result).toEqual({ allowManagedHooksOnly: true, futurePolicy: { enabled: true } })
  })

  it('codex.getAccountStatus reports the actual ChatGPT account', async () => {
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'account/read': (params) => {
          expect(params).toEqual({ refreshToken: false })
          return {
            account: { type: 'chatgpt', email: 'dev@example.com', planType: 'pro' },
            requiresOpenaiAuth: true,
          }
        },
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['environment:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }

    const res = await dispatchCodexRpc('codex.getAccountStatus', { projectId: 'p1' }, ctx)

    expect(res?.error).toBeUndefined()
    expect(res?.result).toEqual({
      signedIn: true,
      authMode: 'chatgpt',
      email: 'dev@example.com',
      planType: 'pro',
      requiresOpenaiAuth: true,
    })
  })

  it('codex.accountLoginStart uses device-code login on a remote node', async () => {
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'account/login/start': (params) => {
          expect(params).toEqual({ type: 'chatgptDeviceCode' })
          setTimeout(() => {
            child.stdout.write(`${JSON.stringify({
              jsonrpc: '2.0',
              method: 'account/login/completed',
              params: { loginId: 'login-1', success: true },
            })}\n`)
          }, 10)
          return {
            type: 'chatgptDeviceCode',
            loginId: 'login-1',
            verificationUrl: 'https://auth.openai.com/device',
            userCode: 'ABCD-EFGH',
          }
        },
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['node:admin']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }

    const res = await dispatchCodexRpc('codex.accountLoginStart', { projectId: 'p1' }, ctx)

    expect(res?.error).toBeUndefined()
    expect(res?.result).toMatchObject({
      type: 'chatgptDeviceCode',
      loginId: 'login-1',
      userCode: 'ABCD-EFGH',
    })
    await pump()
  })

  it('codex.loginMcpOauth hands back the URL and completes on the forwarded callback', async () => {
    let child!: FakeChild
    // Codex's loopback listener on the node: the callback completes the sign-in.
    const listener = createServer((req, res) => {
      res.end('done')
      child.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        method: 'mcpServer/oauthLogin/completed',
        params: { name: 'linear', success: new URL(req.url!, 'http://x').searchParams.get('code') === 'c1' },
      })}\n`)
    })
    await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r))
    const redirect = `http://127.0.0.1:${(listener.address() as { port: number }).port}/callback`
    const authorizationUrl = `https://mcp.example/authorize?state=s1&redirect_uri=${encodeURIComponent(redirect)}`
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      child = createFakeChild()
      attachAutoResponder(child, { 'mcpServer/oauth/login': () => ({ authorizationUrl }) })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['node:admin']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }

    try {
      const started = await dispatchCodexRpc('codex.loginMcpOauth', { projectId: 'p1', serverName: 'linear' }, ctx)
      expect(started?.result).toEqual({ loginId: expect.any(String), authorizationUrl })
      const { loginId } = started!.result as { loginId: string }
      const other = await dispatchCodexRpc('codex.completeMcpOauth', { loginId }, { ...ctx, client: { ...fakeClient(['node:admin']), clientSessionId: 'c2' } })
      expect(other?.error?.code).toBe('not_found')
      const done = await dispatchCodexRpc('codex.completeMcpOauth', { loginId, callbackUrl: `${redirect}?code=c1&state=s1` }, ctx)
      expect(done?.result).toMatchObject({ success: true, authorizationUrl })
    } finally {
      listener.close()
    }
  })

  it.each(['local', 'remote'] as const)('lists and installs %s plugins through the node RPC', async (source) => {
    let installed = false
    const installRequests: Record<string, unknown>[] = []
    const spawnFn: CodexSpawnFn = vi.fn(() => {
      const child = createFakeChild()
      attachAutoResponder(child, {
        'plugin/list': () => ({
          marketplaces: [
            {
              name: 'demo-mp',
              path: source === 'local' ? '/mp' : null,
              plugins: [
                {
                  id: 'demo@demo-mp',
                  remotePluginId: source === 'remote' ? 'plugin_backend_123' : null,
                  name: 'demo',
                  installed,
                  enabled: installed,
                  source: source === 'local' ? { type: 'local', path: '/mp/demo' } : { type: 'remote' },
                },
              ],
            },
          ],
        }),
        'plugin/install': (params) => {
          installRequests.push(params)
          installed = true
          return {}
        },
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['workspace:read', 'node:admin', 'environment:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: null as never,
      spawnFn,
    }

    const list1 = await dispatchCodexRpc('codex.plugins.list', { projectId: 'p1' }, ctx)
    expect(list1?.error).toBeUndefined()
    expect((list1?.result as { plugins: unknown[] }).plugins).toEqual([])

    const marketplace = await dispatchCodexRpc('codex.plugins.list', { projectId: 'p1', marketplace: true }, ctx)
    expect((marketplace?.result as { plugins: unknown[] }).plugins).toEqual([
      expect.objectContaining({ key: 'demo@demo-mp', installed: false }),
    ])

    const install = await dispatchCodexRpc(
      'codex.plugins.install',
      { projectId: 'p1', key: 'demo@demo-mp' },
      ctx,
    )
    expect(install?.error).toBeUndefined()
    expect(install?.result).toMatchObject({ ok: true, key: 'demo@demo-mp' })
    expect(installRequests).toEqual([source === 'local'
      ? { marketplacePath: '/mp', pluginName: 'demo' }
      : { remoteMarketplaceName: 'demo-mp', pluginName: 'plugin_backend_123' }])

    const list2 = await dispatchCodexRpc('codex.plugins.list', { projectId: 'p1' }, ctx)
    expect((list2?.result as { plugins: Array<{ key: string }> }).plugins[0]?.key).toBe(
      'demo@demo-mp',
    )
  })

  it('codex.marketplace.add requires node:admin', async () => {
    const ctx: CodexRpcContext = {
      nodeHome: dir,
      client: fakeClient(['workspace:read']),
      projects: fakeProjects(dir),
      harnesses: fakeHarnesses(bin),
      providers: { listCredentials: () => [] } as never,
    }
    const res = await dispatchCodexRpc(
      'codex.marketplace.add',
      { projectId: 'p1', source: 'https://example.com/mp.git' },
      ctx,
    )
    expect(res?.error?.code).toBe('forbidden')
  })
})
