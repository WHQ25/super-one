import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { webcrypto } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { WebSocket, WebSocketServer } from 'ws'
import log from './logger'
import { trace } from './agent/event-trace'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { decryptPayload, encryptPayload } from './remote-control-crypto'
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
  getAesKey: () => webcrypto.CryptoKey | null
  isPairedDevice: (deviceId: string) => boolean
  onCommand: (cmd: RemoteCommand, respond: LanRemoteResponder, source: { deviceId: string }) => void
  hostName: string
  onClientRegistered?: (info: { deviceName: string; deviceId: string }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  getFileTokenSigner?: () => LanFileTokenSigner | null
}

interface ClientState {
  deviceId: string
  deviceName: string
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

  async broadcastEvent(event: unknown): Promise<void> {
    const aesKey = this.callbacks.getAesKey()
    if (!aesKey) return
    if (this.registeredTargets().length === 0) return
    try {
      const data = await encryptPayload(aesKey, event)
      this.broadcastFrame(JSON.stringify({ type: 'event', data }))
    } catch (err) {
      log.error('[LanServer] broadcastEvent failed:', err)
    }
  }

  broadcastFrame(frameJson: string, targetDeviceIds?: string[]): void {
    const filter = targetDeviceIds ? new Set(targetDeviceIds) : null
    for (const ws of this.registeredTargets(filter)) {
      try { ws.send(frameJson) } catch { /* ignore */ }
    }
  }

  private registeredTargets(filter?: Set<string> | null): WebSocket[] {
    const targets: WebSocket[] = []
    for (const [ws, state] of this.clients) {
      if (!state.deviceId || ws.readyState !== WebSocket.OPEN) continue
      if (filter && !filter.has(state.deviceId)) continue
      targets.push(ws)
    }
    return targets
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
      if (st.deviceId) this.callbacks.onClientDisconnected?.({ deviceId: st.deviceId })
      this.clients.delete(ws)
    })

    ws.on('error', (err) => {
      log.error('[LanServer] WS error:', err.message)
    })
  }

  private async handleFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const state = this.clients.get(ws)
    if (!state) return

    const type = frame.type as string

    if (!state.deviceId) {
      if (type !== 'register') {
        log.warn('[LanServer] Non-register frame before register, closing:', type)
        ws.close(1008, 'must_register_first')
        return
      }
      await this.handleRegister(ws, state, frame)
      return
    }

    switch (type) {
      case 'command':
        await this.handleCommand(ws, frame)
        break
      default:
        log.warn('[LanServer] Unknown frame type:', type)
    }
  }

  private async handleRegister(ws: WebSocket, state: ClientState, frame: Record<string, unknown>): Promise<void> {
    const deviceName = typeof frame.deviceName === 'string' ? frame.deviceName : 'Unknown Device'
    const deviceId = typeof frame.mobileDeviceId === 'string' ? frame.mobileDeviceId : ''

    if (!deviceId || !this.callbacks.isPairedDevice(deviceId)) {
      log.warn('[LanServer] Rejecting unrecognized device:', deviceId)
      try {
        ws.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
      } catch { /* ignore */ }
      ws.close(1000, 'not_paired')
      return
    }

    if (state.registerTimer) {
      clearTimeout(state.registerTimer)
      state.registerTimer = null
    }
    state.deviceId = deviceId
    state.deviceName = deviceName

    log.info('[CONN-DESK] LAN register received deviceId=%s name=%s', deviceId, deviceName)
    this.callbacks.onClientRegistered?.({ deviceName, deviceId })

    try {
      ws.send(JSON.stringify({ type: 'handshake', hostName: this.callbacks.hostName }))
      log.info('[CONN-DESK] LAN handshake sent deviceId=%s', deviceId)
    } catch (err) {
      log.error('[LanServer] Failed to send handshake:', err)
    }
  }

  private async handleCommand(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const aesKey = this.callbacks.getAesKey()
    if (!aesKey) {
      log.warn('[LanServer] No aesKey available, dropping command')
      return
    }
    const data = frame.data
    if (typeof data !== 'string') return

    let command: RemoteCommand
    try {
      command = (await decryptPayload(aesKey, data)) as RemoteCommand
    } catch (err) {
      log.error('[LanServer] Decryption failed, disconnecting:', err)
      ws.close(1008, 'decryption_failed')
      return
    }

    const client = this.clients.get(ws)
    const deviceId = client?.deviceId
    if (!deviceId) {
      log.warn('[LanServer] command from unregistered client, dropping')
      return
    }
    trace('remote.in', (command as { type?: string }).type ?? 'unknown', command)
    const respond: LanRemoteResponder = (requestId, payload) => this.sendResponse(ws, requestId, payload)
    this.callbacks.onCommand(command, respond, { deviceId })
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

  private async sendResponse(ws: WebSocket, requestId: string, data: unknown): Promise<void> {
    const aesKey = this.callbacks.getAesKey()
    if (!aesKey) return
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      trace('remote.resp', requestId, data)
      const encrypted = await encryptPayload(aesKey, data)
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
