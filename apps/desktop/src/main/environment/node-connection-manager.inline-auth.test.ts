import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateDeviceKeyPair } from './node-auth-client'
import { NodeCredentialStore } from './node-credential-store'

vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

const clients = vi.hoisted(() => [] as Array<{
  opts: {
    authorizeInline?: (exchange: (input: {
      path: '/v1/token' | '/v1/ws-ticket'
      body: Record<string, unknown>
      accessToken?: string
    }) => Promise<{ status: number; body: unknown }>) => Promise<string>
    getWsTicket: () => Promise<string>
  }
}>)

vi.mock('./node-rpc-client', () => {
  class NodeRpcClient {
    opts: (typeof clients)[number]['opts']
    connect = async () => {}
    getDescriptor = async () => ({ environmentId: 'env-b', environmentAliases: [] as string[] })
    setRoute() {}
    setBaseUrl() {}
    close() {}
    invalidateTransport() {}
    connected = false
    constructor(opts: (typeof clients)[number]['opts']) {
      this.opts = opts
      clients.push(this)
    }
  }
  return { NodeRpcClient }
})

const { mintWsTicket, refreshNodeAccess } = vi.hoisted(() => ({
  mintWsTicket: vi.fn(),
  refreshNodeAccess: vi.fn(),
}))

vi.mock('./node-auth-client', async () => {
  const actual = await vi.importActual<typeof import('./node-auth-client')>('./node-auth-client')
  return { ...actual, mintWsTicket, refreshNodeAccess }
})

import { NodeConnectionManager } from './node-connection-manager'

const dirs: string[] = []
afterEach(() => {
  clients.length = 0
  mintWsTicket.mockReset()
  refreshNodeAccess.mockReset()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Exchange = (input: {
  path: '/v1/token' | '/v1/ws-ticket'
  body: Record<string, unknown>
  accessToken?: string
}) => Promise<{ status: number; body: unknown }>

async function boot(accessExpiresAt: number) {
  const dir = mkdtempSync(join(tmpdir(), 'superone-inline-auth-'))
  dirs.push(dir)
  const keys = generateDeviceKeyPair()
  const connectionId = 'c1'
  const store = new NodeCredentialStore(dir)
  store.save({
    connectionId,
    environmentId: 'env-b',
    nodePublicKeyFingerprint: 'fp',
    clientSessionId: 's1',
    devicePrivateKeyPem: keys.privateKeyPem,
    devicePublicKeyPem: keys.publicKeyPem,
    refreshToken: 'refresh-1',
    accessToken: 'access-1',
    accessExpiresAt,
    baseUrl: 'http://127.0.0.1:9',
    label: 'b',
    updatedAt: 1,
  })
  const manager = new NodeConnectionManager({
    credentialStore: store,
    loadKnownEnvironments: () => [{
      connectionId,
      environmentId: 'env-b',
      nodePublicKeyFingerprint: 'fp',
      label: 'b',
      endpointProfiles: [{ endpointId: 'relay', kind: 'relay', label: 'relay', target: 'wss://relay.example' }],
      desired: true,
      createdAt: 1,
      updatedAt: 1,
    }],
    resolveReconnectRoute: async () => ({
      baseUrl: 'http://127.0.0.1:9',
      path: 'relay',
      endpointId: 'relay',
      dial: () => { throw new Error('unused') },
    }),
  })
  await manager.connectExisting(connectionId)
  const client = clients.at(-1)
  if (!client?.opts.authorizeInline) throw new Error('authorizeInline was not installed')
  const authorize = client.opts.authorizeInline
  const getWsTicket = client.opts.getWsTicket
  manager.disconnect(connectionId)
  return { store, connectionId, authorize, getWsTicket }
}

const fresh = () => Date.now() + 60 * 60_000
const expired = () => Date.now() - 1_000

const tokens = (ticket?: string) => ({
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  clientSessionId: 's1',
  expiresAt: fresh(),
  ...(ticket ? { ticket } : {}),
})

describe('authorizeInline', () => {
  it('mints a ticket from a still-valid access token', async () => {
    const { authorize } = await boot(fresh())
    const exchange = vi.fn<Exchange>(async () => ({ status: 200, body: { ticket: 'from-ws' } }))
    await expect(authorize(exchange)).resolves.toBe('from-ws')
    expect(exchange.mock.calls.map(([input]) => input.path)).toEqual(['/v1/ws-ticket'])
  })

  it('uses the ticket from refresh, and an old node falls back to ws-ticket', async () => {
    const refreshed = await boot(expired())
    const withTicket = vi.fn<Exchange>(async (input) => {
      expect(input.path).toBe('/v1/token')
      expect(input.body.issueTicket).toBe(true)
      return { status: 200, body: tokens('from-refresh') }
    })
    await expect(refreshed.authorize(withTicket)).resolves.toBe('from-refresh')
    expect(withTicket).toHaveBeenCalledTimes(1)

    const oldNode = await boot(expired())
    const paths: string[] = []
    const exchange = vi.fn<Exchange>(async (input) => {
      paths.push(input.path)
      if (input.path === '/v1/token') return { status: 200, body: tokens() }
      expect(input.accessToken).toBe('access-2')
      return { status: 200, body: { ticket: 'from-ws' } }
    })
    await expect(oldNode.authorize(exchange)).resolves.toBe('from-ws')
    expect(paths).toEqual(['/v1/token', '/v1/ws-ticket'])
  })

  it('joins an in-flight refresh and mints its own ticket', async () => {
    const { authorize } = await boot(expired())
    const seen: string[] = []
    let release!: (result: { status: number; body: unknown }) => void
    const first = vi.fn<Exchange>(async (input) => {
      seen.push(`1:${input.path}`)
      if (input.path === '/v1/token') return new Promise((resolve) => { release = resolve })
      return { status: 200, body: { ticket: 'ws-1' } }
    })
    const second = vi.fn<Exchange>(async (input) => {
      seen.push(`2:${input.path}:${input.accessToken ?? ''}`)
      return { status: 200, body: { ticket: 'ws-2' } }
    })
    const pendingFirst = authorize(first)
    const pendingSecond = authorize(second)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(seen).toEqual(['1:/v1/token'])
    release({ status: 200, body: tokens('from-refresh') })
    await expect(pendingFirst).resolves.toBe('from-refresh')
    await expect(pendingSecond).resolves.toBe('ws-2')
    expect(seen.filter((line) => line.includes('/v1/token'))).toEqual(['1:/v1/token'])
    expect(seen).toContain('2:/v1/ws-ticket:access-2')
  })

  it.each([
    ['access token expired', true],
    ['unknown client session', true],
    ['invalid issuer', true],
    ['client session revoked', false],
  ])('classifies a ws-ticket 401 (%s) and drops the token only when it is not revoked', async (message, drop) => {
    const { authorize, store, connectionId } = await boot(fresh())
    const exchange = vi.fn<Exchange>(async (input) => {
      if (input.path === '/v1/token') return { status: 200, body: tokens('from-refresh') }
      return { status: 401, body: { error: { code: 'unauthorized', message } } }
    })
    await expect(authorize(exchange)).rejects.toMatchObject({ code: 'unauthorized', message })
    expect(store.get(connectionId)?.accessToken).toBe(drop ? undefined : 'access-1')
    if (!drop) return
    exchange.mockClear()
    await expect(authorize(exchange)).resolves.toBe('from-refresh')
    expect(exchange.mock.calls.map(([input]) => input.path)).toEqual(['/v1/token'])
  })
})

describe('getWsTicket access rejection', () => {
  it('drops a non-revoked 401 so the next attempt refreshes', async () => {
    const { getWsTicket, store, connectionId } = await boot(fresh())
    mintWsTicket
      .mockRejectedValueOnce(Object.assign(new Error('access token expired'), { code: 'unauthorized' }))
      .mockResolvedValueOnce('ticket-2')
    refreshNodeAccess.mockResolvedValue(tokens())
    await expect(getWsTicket()).rejects.toMatchObject({ code: 'unauthorized', message: 'access token expired' })
    expect(store.get(connectionId)?.accessToken).toBeUndefined()
    expect(refreshNodeAccess).not.toHaveBeenCalled()
    await expect(getWsTicket()).resolves.toBe('ticket-2')
    expect(refreshNodeAccess).toHaveBeenCalledTimes(1)
  })

  it('keeps the access token when the session is revoked', async () => {
    const { getWsTicket, store, connectionId } = await boot(fresh())
    mintWsTicket.mockRejectedValueOnce(Object.assign(new Error('client session revoked'), { code: 'unauthorized' }))
    await expect(getWsTicket()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(store.get(connectionId)?.accessToken).toBe('access-1')
    expect(refreshNodeAccess).not.toHaveBeenCalled()
  })
})
