import { frameHostPayload } from './remote/payload-codec'
import type { ChannelEnvelope, PhoneHandshake, PhoneLinkHost, ResolvePhoneKey } from './remote/phone-link-host'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import log from './logger'
import { trace } from './agent/event-trace'
import type { RemoteCommand } from '@superone/shared/agent-types'
import type { LinkHandshakeInfo } from '@superone/relay-client/phone-link'
import type { SecureChannel } from '@superone/relay-client/secure-channel'
import type { LanFileTokenSigner } from './lan-file-token'
import { inferMimeType } from './file-bridge'

export function listLanIpAddresses(): string[] {
  const result: string[] = []
  const ifaces = networkInterfaces()
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4') continue
      if (entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue
      result.push(entry.address)
    }
  }
  return result
}

const REGISTER_TIMEOUT_MS = 5_000
const WS_CHUNK_SIZE = 800_000

export type LanRemoteResponder = (requestId: string, data: unknown) => Promise<void>

export interface LanServerCallbacks {
  /** The loaded phone link module (`loadPhoneLinkHost`). */
  phoneLink: PhoneLinkHost
  /** Key id → paired phone; null once the device is removed. */
  resolveKey: ResolvePhoneKey
  handshakeInfo: () => LinkHandshakeInfo
  onCommand: (cmd: RemoteCommand, respond: LanRemoteResponder, source: { deviceId: string }) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  getFileTokenSigner?: () => LanFileTokenSigner | null
  onUploadProgress?: (info: { savedPath: string; receivedBytes: number; done: boolean; error?: string }) => void
}

interface ClientState {
  /** Set once the phone has proven its key; the device bound to that key. */
  deviceId: string
  deviceName: string
  handshake: PhoneHandshake
  channel: SecureChannel | null
  registerTimer: ReturnType<typeof setTimeout> | null
}

export class LanServer {
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private clients = new Map<WebSocket, ClientState>()

  constructor(private readonly callbacks: LanServerCallbacks) {}

  async start(opts: { port?: number; host?: string } = {}): Promise<{ port: number }> {
    if (this.httpServer) throw new Error('LanServer already started')

    const port = opts.port ?? 0
    const host = opts.host ?? '0.0.0.0'

    const httpServer = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'PUT' && path.startsWith('/files/upload/')) {
        this.handleFileUpload(req, res, path).catch((err) => {
          log.error('[LanServer] file upload handler error:', err)
          if (!res.headersSent) {
            res.writeHead(500)
            res.end('Internal server error')
          }
        })
        return
      }
      if (req.method === 'GET' && path.startsWith('/files/')) {
        this.handleFileRequest(req, res, path).catch((err) => {
          log.error('[LanServer] file request handler error:', err)
          if (!res.headersSent) {
            res.writeHead(500)
            res.end('Internal server error')
          }
        })
        return
      }
      res.writeHead(426)
      res.end('Upgrade required')
    })
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

    wss.on('connection', (ws) => this.handleConnection(ws))

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject)
        resolve()
      })
    })

    this.httpServer = httpServer
    this.wss = wss
    const bound = httpServer.address() as AddressInfo
    log.info(`[LanServer] Listening on ${host}:${bound.port}`)
    return { port: bound.port }
  }

  async stop(): Promise<void> {
    for (const [ws, state] of this.clients) {
      if (state.registerTimer) clearTimeout(state.registerTimer)
      ws.close(1000, 'server_stopping')
    }
    this.clients.clear()

    const wss = this.wss
    const httpServer = this.httpServer
    this.wss = null
    this.httpServer = null

    if (wss) await new Promise<void>((r) => wss.close(() => r()))
    if (httpServer) await new Promise<void>((r) => httpServer.close(() => r()))
  }

  isRunning(): boolean {
    return this.httpServer !== null
  }

  isEmpty(): boolean {
    for (const state of this.clients.values()) {
      if (state.deviceId) return false
    }
    return true
  }

  getPort(): number | null {
    if (!this.httpServer) return null
    const addr = this.httpServer.address() as AddressInfo | null
    return addr?.port ?? null
  }

  /**
   * Seal one framed payload for every target socket's own channel. Sealing and
   * sending stay synchronous so channel sequence numbers follow send order.
   */
  sendFramed(kind: 'event' | 'terminal', framed: Uint8Array, targetDeviceIds?: string[], seq?: number): void {
    const filter = targetDeviceIds ? new Set(targetDeviceIds) : null
    for (const ws of this.registeredTargets(filter)) {
      const channel = this.clients.get(ws)?.channel
      if (!channel) continue
      try {
        const data = this.callbacks.phoneLink.sealHostFrame(channel, { t: kind }, framed)
        ws.send(JSON.stringify(kind === 'event' ? { type: 'event', seq, data } : { type: 'terminal', data }))
      } catch (err) {
        log.warn('[LanServer] send %s failed: %s', kind, err instanceof Error ? err.message : String(err))
      }
    }
  }

  hasRegisteredClient(): boolean {
    return this.registeredTargets().length > 0
  }

  async broadcastShutdown(): Promise<void> {
    const targets = this.registeredTargets()
    if (targets.length === 0) return
    const frame = JSON.stringify({ type: 'desktop_shutdown' })
    await Promise.all(
      targets.map(
        (ws) =>
          new Promise<void>((resolve) => {
            try {
              ws.send(frame, () => resolve())
            } catch {
              resolve()
            }
          }),
      ),
    )
  }

  private registeredTargets(filter?: Set<string> | null): WebSocket[] {
    const targets: WebSocket[] = []
    for (const [ws, state] of this.clients) {
      if (!state.deviceId || !state.channel || ws.readyState !== WebSocket.OPEN) continue
      if (filter && !filter.has(state.deviceId)) continue
      targets.push(ws)
    }
    return targets
  }

  private hasDeviceSocket(deviceId: string): boolean {
    for (const state of this.clients.values()) {
      if (state.deviceId === deviceId) return true
    }
    return false
  }

  kickDevice(deviceId: string): void {
    for (const [ws, state] of this.clients) {
      if (state.deviceId === deviceId) {
        try {
          ws.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
        } catch { /* ignore */ }
        ws.close(1000, 'kicked')
      }
    }
  }

  private handleConnection(ws: WebSocket): void {
    const state: ClientState = {
      deviceId: '',
      deviceName: '',
      handshake: new this.callbacks.phoneLink.PhoneHandshake(this.callbacks.resolveKey),
      channel: null,
      registerTimer: setTimeout(() => {
        log.warn('[LanServer] Register timeout, closing connection')
        ws.close(1008, 'register_timeout')
      }, REGISTER_TIMEOUT_MS),
    }
    this.clients.set(ws, state)

    ws.on('message', (raw) => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(raw.toString())
      } catch {
        return
      }
      this.handleFrame(ws, frame).catch((err) => log.error('[LanServer] frame handler failed:', err))
    })

    ws.on('close', () => {
      const st = this.clients.get(ws)
      if (!st) return
      if (st.registerTimer) clearTimeout(st.registerTimer)
      this.clients.delete(ws)
      if (!st.deviceId) return
      // A phone that redialled already registered its new socket; the old one
      // closing late must not take the device offline and drop its subscriptions.
      const replaced = this.hasDeviceSocket(st.deviceId)
      log.info('[CONN-DESK] LAN socket closed deviceId=%s replaced=%s', st.deviceId, replaced)
      if (!replaced) this.callbacks.onClientDisconnected?.({ deviceId: st.deviceId })
    })

    ws.on('error', (err) => {
      log.error('[LanServer] WS error:', err.message)
    })
  }

  private async handleFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const state = this.clients.get(ws)
    if (!state) return

    const type = frame.type as string

    if (!state.channel) {
      if (type !== 'channel') {
        log.warn('[LanServer] Frame before the channel handshake, closing:', type)
        ws.close(1008, 'channel_required')
        return
      }
      this.handleHandshake(ws, state, frame as ChannelEnvelope)
      return
    }

    switch (type) {
      case 'command':
        this.handleCommand(ws, state, state.channel, frame)
        break
      default:
        log.warn('[LanServer] Unknown frame type:', type)
    }
  }

  private handleHandshake(ws: WebSocket, state: ClientState, frame: ChannelEnvelope): void {
    const step = state.handshake.step(frame)
    if (step.kind === 'challenge') {
      ws.send(JSON.stringify(step.reply))
      return
    }
    if (step.kind === 'rejected') {
      // A removed phone, or one paired before per-device credentials: it must pair again.
      log.warn('[LanServer] Rejecting unpaired channel key: %s', step.reason)
      try {
        ws.send(JSON.stringify({ type: 'kicked' }))
      } catch { /* ignore */ }
      ws.close(1008, 'not_paired')
      return
    }
    if (step.kind === 'failed') {
      log.warn('[LanServer] Channel handshake failed: %s', step.reason)
      ws.close(1008, 'channel_failed')
      return
    }

    const { channel, device } = step
    if (state.registerTimer) {
      clearTimeout(state.registerTimer)
      state.registerTimer = null
    }
    state.deviceId = device.deviceId
    state.deviceName = device.deviceName
    state.channel = channel

    // LAN has no heartbeat, so the socket a suspended phone left behind can
    // still read OPEN here. One socket per device, as on the relay.
    let replacedCount = 0
    for (const [other, otherState] of this.clients) {
      if (other === ws || otherState.deviceId !== device.deviceId) continue
      other.close(1000, 'replaced')
      replacedCount++
    }

    log.info('[CONN-DESK] LAN channel established deviceId=%s replaced=%d', device.deviceId, replacedCount)
    try {
      ws.send(JSON.stringify(this.callbacks.phoneLink.sealHandshake(channel, this.callbacks.handshakeInfo())))
    } catch (err) {
      log.error('[LanServer] Failed to send handshake:', err)
    }
    this.callbacks.onClientRegistered?.({ deviceName: device.deviceName, deviceId: device.deviceId })
  }

  private handleCommand(ws: WebSocket, state: ClientState, channel: SecureChannel, frame: Record<string, unknown>): void {
    const data = frame.data
    if (typeof data !== 'string') return

    let command: RemoteCommand
    try {
      command = this.callbacks.phoneLink.openCommand(channel, data)
    } catch (err) {
      // Tampered, replayed or reordered: this connection can no longer be trusted.
      log.error('[LanServer] Rejected command frame, disconnecting:', err)
      ws.close(1008, 'decryption_failed')
      return
    }

    trace('remote.in', (command as { type?: string }).type ?? 'unknown', command)
    const respond: LanRemoteResponder = (requestId, payload) => this.sendResponse(ws, channel, requestId, payload)
    this.callbacks.onCommand(command, respond, { deviceId: state.deviceId })
  }

  private async handleFileRequest(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const signer = this.callbacks.getFileTokenSigner?.()
    if (!signer) {
      res.writeHead(503)
      res.end('File bridge unavailable')
      return
    }
    const token = decodeURIComponent(path.slice('/files/'.length))
    if (!token) {
      res.writeHead(400)
      res.end('Missing token')
      return
    }
    const payload = await signer.verify(token)
    if (!payload) {
      res.writeHead(403)
      res.end('Invalid or expired token')
      return
    }
    if (payload.mode === 'write') {
      res.writeHead(403)
      res.end('Token not valid for download')
      return
    }
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(payload.path)
    } catch {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    if (!stat.isFile()) {
      res.writeHead(403)
      res.end('Not a regular file')
      return
    }
    const mimeType = inferMimeType(payload.path)
    const fileSize = stat.size
    const range = req.headers.range
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
        res.end()
        return
      }
      const startStr = m[1]
      const endStr = m[2]
      let start: number
      let end: number
      if (startStr === '' && endStr !== '') {
        const suffix = parseInt(endStr, 10)
        if (!Number.isFinite(suffix) || suffix <= 0) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
          res.end()
          return
        }
        start = Math.max(0, fileSize - suffix)
        end = fileSize - 1
      } else {
        start = parseInt(startStr, 10)
        end = endStr === '' ? fileSize - 1 : parseInt(endStr, 10)
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
        res.end()
        return
      }
      end = Math.min(end, fileSize - 1)
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mimeType,
      })
      createReadStream(payload.path, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(payload.path).pipe(res)
  }

  private async handleFileUpload(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const signer = this.callbacks.getFileTokenSigner?.()
    if (!signer) {
      res.writeHead(503)
      res.end('File bridge unavailable')
      return
    }
    const token = decodeURIComponent(path.slice('/files/upload/'.length))
    if (!token) {
      res.writeHead(400)
      res.end('Missing token')
      return
    }
    const payload = await signer.verify(token)
    if (!payload || payload.mode !== 'write') {
      res.writeHead(403)
      res.end('Invalid or expired token')
      return
    }
    const onProgress = this.callbacks.onUploadProgress
    try {
      if (onProgress) {
        let received = 0
        let lastReported = 0
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            received += chunk.length
            if (received - lastReported >= 65_536) {
              lastReported = received
              onProgress({ savedPath: payload.path, receivedBytes: received, done: false })
            }
            cb(null, chunk)
          },
        })
        await pipeline(req, counter, createWriteStream(payload.path))
        onProgress({ savedPath: payload.path, receivedBytes: received, done: true })
      } else {
        await pipeline(req, createWriteStream(payload.path))
      }
    } catch (err) {
      log.error('[LanServer] upload write failed:', err)
      onProgress?.({ savedPath: payload.path, receivedBytes: 0, done: true, error: (err as Error).message })
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('Write failed')
      }
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, savedPath: payload.path }))
  }

  private async sendResponse(ws: WebSocket, channel: SecureChannel, requestId: string, data: unknown): Promise<void> {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      trace('remote.resp', requestId, data)
      const framed = await frameHostPayload(data)
      // A response belongs to the channel its command arrived on.
      if (ws.readyState !== WebSocket.OPEN || this.clients.get(ws)?.channel !== channel) return
      const encrypted = this.callbacks.phoneLink.sealHostFrame(channel, { t: 'response', requestId }, framed)
      if (encrypted.length <= WS_CHUNK_SIZE) {
        ws.send(JSON.stringify({ type: 'response', requestId, data: encrypted }))
      } else {
        const totalChunks = Math.ceil(encrypted.length / WS_CHUNK_SIZE)
        for (let i = 0; i < totalChunks; i++) {
          const chunk = encrypted.slice(i * WS_CHUNK_SIZE, (i + 1) * WS_CHUNK_SIZE)
          ws.send(JSON.stringify({ type: 'response_chunk', requestId, index: i, total: totalChunks, data: chunk }))
        }
      }
    } catch (err) {
      log.error('[LanServer] Failed to send response:', err)
    }
  }
}
