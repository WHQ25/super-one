import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { McpAppsError, type McpAppsBinding } from '@superone/shared/mcp-apps'
import { FIXTURE_PRIVATE_META_KEY, FIXTURE_VIEW_URI, startFixtureHttpServer, type FixtureHttpServer } from '../../test/fixtures/mcp-apps/fixture-server'

vi.mock('../shell-path', () => ({ ensureShellPath: async () => undefined }))
import { HostClients, bearerFetch, hostClientConfig, type HostClientProviderDeps } from './host-client'

const fixture = fileURLToPath(new URL('../../test/fixtures/mcp-apps/fixture-server.ts', import.meta.url))
const stdio = { type: 'stdio', command: process.execPath, args: [fixture, '--stdio'] }
const binding: McpAppsBinding = { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'f', hostClient: true }

const pools: HostClients[] = []
let http: FixtureHttpServer | undefined
afterEach(async () => {
  pools.splice(0).forEach(pool => pool.close())
  await http?.close(); http = undefined
})

function setup(config: unknown, overrides: Partial<HostClientProviderDeps> = {}, idleCloseMs?: number) {
  const pool = new HostClients('host-client-test', idleCloseMs)
  pools.push(pool)
  const deps: HostClientProviderDeps = { config: () => config, cwd: () => process.cwd(), providerSessionId: () => 'thread', assertBinding: () => undefined, ...overrides }
  return { pool, provider: pool.provider(binding, deps) }
}

const signal = () => new AbortController().signal
const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: McpAppsError) => error.code)

describe('hostClientConfig', () => {
  it('accepts stdio, http and sse configs and nothing a harness hosts itself', () => {
    expect(hostClientConfig({ command: 'node', args: ['a', 1], env: { A: 'x', B: 2 } })).toEqual({ type: 'stdio', command: 'node', args: [], env: { A: 'x' } })
    expect(hostClientConfig({ type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } }))
      .toEqual({ type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } })
    expect(hostClientConfig({ type: 'sse', url: 'http://127.0.0.1:1/sse' })).toMatchObject({ type: 'sse' })
    expect(hostClientConfig({ type: 'claudeai-proxy', url: 'https://claude.ai/x', id: 'c' })).toBeNull()
    expect(hostClientConfig({ type: 'sdk', name: 'superone' })).toBeNull()
    expect(hostClientConfig({ type: 'http', url: 'file:///etc/passwd' })).toBeNull()
    expect(hostClientConfig(undefined)).toBeNull()
  })
})

describe('HostClients', () => {
  it('reaches a stdio server for tools, View documents and calls with request _meta', async () => {
    const { provider } = setup(stdio)
    const tools = await provider.tools()
    expect(tools.get('fixture_next_page')?._meta?.ui?.visibility).toEqual(['app'])
    const read = await provider.readResource({ uri: FIXTURE_VIEW_URI }, signal())
    expect(read.contents[0]?.uri).toBe(FIXTURE_VIEW_URI)
    const { result } = await provider.callTool({ tool: 'fixture_next_page', args: { page: 2 }, meta: { 'openai/resource': { path: '/x' } } }, signal())
    expect(result._meta?.[FIXTURE_PRIVATE_META_KEY]).toEqual({ visibility: 'app', token: 'private-2' })
  })

  it('reuses one connection per server until the config changes', async () => {
    let config: unknown = stdio
    const { provider } = setup(undefined, { config: () => config })
    const first = await provider.tools()
    expect(await provider.tools()).toBe(first)
    config = { ...stdio, env: { CHANGED: '1' } }
    expect(await provider.tools()).not.toBe(first)
  })

  it('reconnects when the credentials behind the connection change', async () => {
    let scope = 'account-a'
    const { provider } = setup(stdio, { credentialScope: () => scope })
    const first = await provider.tools()
    expect(await provider.tools()).toBe(first)
    scope = 'account-b'
    expect(await provider.tools()).not.toBe(first)
  })

  it('closes an idle connection and reconnects on the next request', async () => {
    const { provider } = setup(stdio, {}, 50)
    const first = await provider.tools()
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(await provider.tools()).not.toBe(first)
  })

  it('uses config headers for HTTP and reads a rejected credential as sign-in', async () => {
    http = await startFixtureHttpServer({ token: 'secret' })
    const { provider } = setup({ type: 'http', url: http.url, headers: { Authorization: 'Bearer secret' } })
    expect((await provider.tools()).has('fixture_list_items')).toBe(true)
    const { provider: unsigned } = setup({ type: 'http', url: http.url })
    expect(await code(unsigned.tools())).toBe('auth_required')
  })

  it('sends the harness token when the config has none, renewing it on a 401 or before expiry', async () => {
    http = await startFixtureHttpServer({ token: 'secret' })
    const url = http.url
    let stored = { accessToken: 'revoked' } as { accessToken: string; expiresAt?: number }
    const renew = vi.fn(async () => { stored = { accessToken: 'secret' } })
    expect((await setup({ type: 'http', url }, { token: { read: () => stored, renew } }).provider.tools()).size).toBeGreaterThan(0)
    expect(renew).toHaveBeenCalledOnce()

    stored = { accessToken: 'revoked', expiresAt: Date.now() + 1_000 }
    renew.mockClear()
    expect((await setup({ type: 'http', url }, { token: { read: () => stored, renew } }).provider.tools()).size).toBeGreaterThan(0)
    expect(renew).toHaveBeenCalledOnce()
  })

  it('reads a missing harness token as sign-in, and leaves a config Authorization header alone', async () => {
    http = await startFixtureHttpServer({ token: 'secret' })
    const renew = vi.fn(async () => undefined)
    expect(await code(setup({ type: 'http', url: http.url }, { token: { read: () => null, renew } }).provider.tools())).toBe('auth_required')
    expect(renew).not.toHaveBeenCalled()
    const read = vi.fn(() => ({ accessToken: 'wrong' }))
    expect((await setup({ type: 'http', url: http.url, headers: { authorization: 'Bearer secret' } }, { token: { read, renew } }).provider.tools()).size).toBeGreaterThan(0)
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses before connecting: other sessions, changed bindings, non-ui documents, unreachable configs, after close', async () => {
    const { provider, pool } = setup(stdio)
    expect(await code(provider.readResource({ uri: FIXTURE_VIEW_URI, origin: { providerSessionId: 'other' } }, signal()))).toBe('invalid')
    expect(await code(provider.readResource({ uri: 'file:///etc/hosts' }, signal()))).toBe('invalid')
    const changed = setup(stdio, { assertBinding: () => { throw new McpAppsError('not_connected', 'changed') } }).provider
    expect(await code(changed.tools())).toBe('not_connected')
    expect(await code(setup({ type: 'claudeai-proxy', url: 'https://claude.ai/x' }).provider.tools())).toBe('not_connected')
    pool.close()
    expect(await code(provider.tools())).toBe('not_connected')
  })

  it('reconnects after the harness signs the server in', async () => {
    const authenticate = vi.fn(async () => ({ completion: 'done' as const }))
    const { provider } = setup(stdio, { authenticate })
    const first = await provider.tools()
    expect((await provider.ready(signal())).authenticate).toBe(true)
    await provider.authenticate!({}, signal())
    expect(authenticate).toHaveBeenCalledOnce()
    expect(await provider.tools()).not.toBe(first)
  })
})

describe('bearerFetch', () => {
  it('sends the token to the server origin only', async () => {
    const seen: Array<[string, string | null]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      seen.push([String(url), new Headers(init?.headers).get('authorization')])
      return new Response('{}')
    }))
    try {
      const send = bearerFetch({ type: 'sse', url: 'https://mcp.example.com/sse', headers: {} }, { read: () => ({ accessToken: 't' }), renew: async () => undefined })
      await send('https://mcp.example.com/messages?session=1', { method: 'POST' })
      await send('https://elsewhere.example.net/collect', { method: 'POST' })
      expect(seen).toEqual([['https://mcp.example.com/messages?session=1', 'Bearer t'], ['https://elsewhere.example.net/collect', null]])
    } finally { vi.unstubAllGlobals() }
  })
})
