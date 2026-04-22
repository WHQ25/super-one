vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

import { webcrypto } from 'node:crypto'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveKeys, encryptPayload, decryptPayload, bytesToHex } from './remote-control-crypto'
import { LanServer } from './lan-server'
import type { RemoteCommand } from '../shared/agent-types'

async function makeKeys() {
  const secret = bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)).buffer)
  return { secret, ...(await deriveKeys(secret)) }
}

function nextFrame(ws: WebSocket, predicate?: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame timeout')), 2000)
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(raw.toString())
        if (!predicate || predicate(frame)) {
          clearTimeout(timer)
          ws.off('message', onMessage)
          resolve(frame)
        }
      } catch {}
    }
    ws.on('message', onMessage)
  })
}

describe('LanServer', () => {
  let server: LanServer | null = null
  let client: WebSocket | null = null

  afterEach(async () => {
    client?.close()
    client?.removeAllListeners()
    client = null
    await server?.stop()
    server = null
  })

  it('accepts a paired device and replies with handshake', async () => {
    const { aesKey } = await makeKeys()
    server = new LanServer({
      getAesKey: () => aesKey,
      isPairedDevice: () => true,
      onCommand: vi.fn(),
      hostName: 'test-host',
    })
    const { port } = await server.start({ host: '127.0.0.1' })

    client = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await new Promise<void>((r, reject) => {
      client!.once('open', () => r())
      client!.once('error', reject)
    })
    client.send(JSON.stringify({ type: 'register', deviceName: 'iPhone', mobileDeviceId: 'dev-1' }))

    const handshake = await nextFrame(client, (f) => f.type === 'handshake')
    expect(handshake).toMatchObject({ type: 'handshake', hostName: 'test-host' })
  })

  it('kicks an unpaired device and closes the socket', async () => {
    const { aesKey } = await makeKeys()
    server = new LanServer({
      getAesKey: () => aesKey,
      isPairedDevice: () => false,
      onCommand: vi.fn(),
      hostName: 'test-host',
    })
    const { port } = await server.start({ host: '127.0.0.1' })

    client = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await new Promise<void>((r, reject) => {
      client!.once('open', () => r())
      client!.once('error', reject)
    })
    client.send(JSON.stringify({ type: 'register', deviceName: 'Spoof', mobileDeviceId: 'unknown' }))

    const kicked = await nextFrame(client, (f) => f.type === 'kicked')
    expect(kicked).toMatchObject({ type: 'kicked', mobileDeviceId: 'unknown' })

    await new Promise<void>((r) => client!.once('close', () => r()))
  })

  it('decrypts command frames and passes them to onCommand', async () => {
    const { aesKey } = await makeKeys()
    const onCommand = vi.fn()
    server = new LanServer({
      getAesKey: () => aesKey,
      isPairedDevice: () => true,
      onCommand,
      hostName: 'test-host',
    })
    const { port } = await server.start({ host: '127.0.0.1' })

    client = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await new Promise<void>((r, reject) => {
      client!.once('open', () => r())
      client!.once('error', reject)
    })
    client.send(JSON.stringify({ type: 'register', deviceName: 'iPhone', mobileDeviceId: 'dev-1' }))
    await nextFrame(client, (f) => f.type === 'handshake')

    const command: RemoteCommand = { type: 'list_projects', requestId: 'req-1' } as unknown as RemoteCommand
    const data = await encryptPayload(aesKey, command)
    client.send(JSON.stringify({ type: 'command', data }))

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled(), { timeout: 2000 })
    expect(onCommand.mock.calls[0][0]).toMatchObject({ type: 'list_projects', requestId: 'req-1' })
  })

  it('delivers encrypted response back through sendResponse', async () => {
    const { aesKey } = await makeKeys()
    server = new LanServer({
      getAesKey: () => aesKey,
      isPairedDevice: () => true,
      onCommand: (_cmd, respond) => { void respond('req-1', { ok: true, value: 42 }) },
      hostName: 'test-host',
    })
    const { port } = await server.start({ host: '127.0.0.1' })

    client = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await new Promise<void>((r, reject) => {
      client!.once('open', () => r())
      client!.once('error', reject)
    })
    client.send(JSON.stringify({ type: 'register', deviceName: 'iPhone', mobileDeviceId: 'dev-1' }))
    await nextFrame(client, (f) => f.type === 'handshake')

    const data = await encryptPayload(aesKey, { type: 'ping', requestId: 'req-1' })
    client.send(JSON.stringify({ type: 'command', data }))

    const response = await nextFrame(client, (f) => f.type === 'response')
    const decoded = await decryptPayload(aesKey, response.data as string)
    expect(decoded).toEqual({ ok: true, value: 42 })
    expect(response.requestId).toBe('req-1')
  })

  it('broadcast delivers events to all registered clients', async () => {
    const { aesKey } = await makeKeys()
    server = new LanServer({
      getAesKey: () => aesKey,
      isPairedDevice: () => true,
      onCommand: vi.fn(),
      hostName: 'test-host',
    })
    const { port } = await server.start({ host: '127.0.0.1' })

    const c1 = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    const c2 = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await Promise.all([
      new Promise<void>((r) => c1.once('open', () => r())),
      new Promise<void>((r) => c2.once('open', () => r())),
    ])
    c1.send(JSON.stringify({ type: 'register', deviceName: 'A', mobileDeviceId: 'dev-1' }))
    c2.send(JSON.stringify({ type: 'register', deviceName: 'B', mobileDeviceId: 'dev-2' }))
    await Promise.all([
      nextFrame(c1, (f) => f.type === 'handshake'),
      nextFrame(c2, (f) => f.type === 'handshake'),
    ])

    await server.broadcastEvent({ type: 'pong', seq: 1 })

    const [f1, f2] = await Promise.all([
      nextFrame(c1, (f) => f.type === 'event'),
      nextFrame(c2, (f) => f.type === 'event'),
    ])
    expect(await decryptPayload(aesKey, f1.data as string)).toEqual({ type: 'pong', seq: 1 })
    expect(await decryptPayload(aesKey, f2.data as string)).toEqual({ type: 'pong', seq: 1 })

    c1.close()
    c2.close()
  })

  it('reports isEmpty() correctly as clients come and go', async () => {
    const { aesKey } = await makeKeys()
    server = new LanServer({
      getAesKey: () => aesKey,
      isPairedDevice: () => true,
      onCommand: vi.fn(),
      hostName: 'test-host',
    })
    const { port } = await server.start({ host: '127.0.0.1' })

    expect(server.isEmpty()).toBe(true)

    client = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await new Promise<void>((r) => client!.once('open', () => r()))
    client.send(JSON.stringify({ type: 'register', deviceName: 'A', mobileDeviceId: 'dev-1' }))
    await nextFrame(client, (f) => f.type === 'handshake')
    expect(server.isEmpty()).toBe(false)

    client.close()
    await vi.waitFor(() => expect(server!.isEmpty()).toBe(true), { timeout: 2000 })
  })
})
