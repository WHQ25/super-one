import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'

vi.mock('./remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  highlightCodeSync: vi.fn(() => null),
  highlightCodeByLang: vi.fn(() => null),
  parseAnsiTokens: vi.fn(() => []),
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./agent/claude-session-runtime', () => ({ readOutputFile: vi.fn(() => ({ resultText: '', toolEntries: [] })) }))
vi.mock('./split-text-blocks', () => ({
  splitTextIntoBlocks: vi.fn((text: string) => ({ segments: [{ type: 'text', text }], remainder: '' })),
}))

import { RemoteControlService } from './remote-control-service'
import { bytesToHex } from './remote-control-crypto'

/**
 * A stand-in relay: accepts the desktop's socket and either echoes the relay's
 * auto-response or, when `mute` is on, swallows pings like a half-open link.
 */
async function startFakeRelay(opts: { mute: boolean }) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const desktops: ServerSocket[] = []
  const pings: string[] = []
  const closes: number[] = []
  server.on('connection', (socket) => {
    desktops.push(socket)
    socket.on('message', (raw) => {
      const text = raw.toString()
      if (text !== 'ping') return
      pings.push(text)
      if (!opts.mute) socket.send('pong')
    })
    socket.on('close', (code) => closes.push(code))
  })
  const port = (server.address() as { port: number }).port
  return { server, desktops, pings, closes, url: `ws://127.0.0.1:${port}` }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('RemoteControlService relay heartbeat', () => {
  let service: RemoteControlService | null = null
  let relay: Awaited<ReturnType<typeof startFakeRelay>> | null = null

  afterEach(async () => {
    await service?.stop()
    service = null
    relay?.server.close()
    relay = null
  })

  async function startService(relayUrl: string) {
    service = new RemoteControlService(relayUrl, {
      onCommand: vi.fn(),
      isPairedDevice: () => true,
      relayHeartbeat: { intervalMs: 40, timeoutMs: 40 },
    })
    await service.start({
      enabled: true,
      masterSecret: bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)).buffer),
      deviceId: 'desktop-test',
      relayUrl,
    })
  }

  it('keeps one socket alive while the relay answers pings', async () => {
    relay = await startFakeRelay({ mute: false })
    await startService(relay.url)
    const { pings, desktops } = relay
    await waitFor(() => pings.length >= 3)
    expect(desktops).toHaveLength(1)
    expect(service!.isRelayConnected()).toBe(true)
  })

  it('terminates a socket whose pings go unanswered and dials the relay again', async () => {
    relay = await startFakeRelay({ mute: true })
    await startService(relay.url)
    const { closes, desktops } = relay
    // First socket dies on the missed pong; the reconnect path opens a second.
    await waitFor(() => closes.length >= 1 && desktops.length >= 2)
    expect(closes[0]).not.toBe(1000)
  })
})
