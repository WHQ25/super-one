import { webcrypto } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { powerSaveBlocker } from 'electron'
import WebSocket from 'ws'
import log from './logger'
import type { AgentEvent, RemoteCommand } from '../shared/agent-types'

const subtle = webcrypto.subtle
const encoder = new TextEncoder()

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const BATCH_INTERVAL_MS = 50
const MAX_RECONNECT_DELAY_MS = 30_000
const SKIPPED_EVENTS = new Set(['files_persisted', 'elicitation_complete'])
const THROTTLED_EVENTS = new Set(['tool_progress', 'hook_progress'])
const THROTTLE_INTERVAL_MS = 2_000

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const arr = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16))
  return new Uint8Array(arr) as Uint8Array<ArrayBuffer>
}

async function importKeyMaterial(masterSecretHex: string): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', hexToBytes(masterSecretHex), 'HKDF', false, ['deriveBits'])
}

async function deriveKeys(masterSecretHex: string): Promise<{
  channelKeyHex: string
  aesKey: webcrypto.CryptoKey
}> {
  const keyMaterial = await importKeyMaterial(masterSecretHex)
  const channelBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('channel-key') },
    keyMaterial,
    256,
  )
  const channelKeyHex = bytesToHex(channelBits)

  const aesBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('aes-key') },
    await importKeyMaterial(masterSecretHex),
    256,
  )
  const aesKey = await subtle.importKey('raw', aesBits, 'AES-GCM', false, ['encrypt', 'decrypt'])

  return { channelKeyHex, aesKey }
}

async function importRawAesKey(keyHex: string): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptPayload(aesKey: webcrypto.CryptoKey, payload: unknown): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(JSON.stringify(payload)))
  const result = new Uint8Array(12 + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), 12)
  return Buffer.from(result).toString('base64')
}

async function decryptPayload(aesKey: webcrypto.CryptoKey, data: string): Promise<unknown> {
  const bytes = Buffer.from(data, 'base64')
  const iv = bytes.subarray(0, 12)
  const ciphertext = bytes.subarray(12)
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

async function computeHmacToken(channelKeyHex: string, role: string, timestamp: string): Promise<string> {
  const key = await subtle.importKey('raw', hexToBytes(channelKeyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await subtle.sign('HMAC', key, encoder.encode(`${role}:${timestamp}`))
  return bytesToHex(sig)
}

async function computeRoomId(channelKeyHex: string): Promise<string> {
  const hash = await subtle.digest('SHA-256', hexToBytes(channelKeyHex))
  return bytesToHex(hash).substring(0, 32)
}

export interface RemoteDeviceConfig {
  enabled: boolean
  masterSecret: string
  deviceId: string
  preventSleep: boolean
}

interface PairingSession {
  channelId: string
  aesKey: webcrypto.CryptoKey
  ws: WebSocket | null
  pendingCode: string | null
  pendingMobileDeviceId: string | null
  pendingDeviceName: string | null
  expiryTimer: ReturnType<typeof setTimeout>
}

export type RemoteResponder = (requestId: string, data: unknown) => Promise<void>

export interface RemoteControlCallbacks {
  onCommand: (cmd: RemoteCommand, respond: RemoteResponder) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  onPairingCodeReceived?: (info: { code: string; deviceName: string }) => void
  onPairingExpired?: () => void
  onPairingConfirmed?: (info: { mobileDeviceId: string; deviceName: string }) => void
  onPairingAlreadyPaired?: (info: { deviceName: string }) => void
  isPairedDevice?: (deviceId: string) => boolean
}

export class RemoteControlService {
  private relayWs: WebSocket | null = null
  private keys: { channelKeyHex: string; aesKey: webcrypto.CryptoKey } | null = null
  private onlineDeviceIds = new Set<string>()
  private currentConfig: RemoteDeviceConfig | null = null
  private sleepBlockerProcess: ChildProcess | null = null
  private powerBlockerId: number | null = null
  private pairingSession: PairingSession | null = null

  private batchBuffer: AgentEvent[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private intentionallyClosed = false

  private lastThrottledAt = new Map<string, number>()

  constructor(
    private readonly relayUrl: string,
    private readonly callbacks: RemoteControlCallbacks,
  ) {}

  resume(): void {
    if (this.currentConfig) this.start(this.currentConfig)
  }

  getOnlineDeviceIds(): Set<string> {
    return this.onlineDeviceIds
  }

  private acquirePowerLock(): void {
    if (process.platform === 'darwin') {
      if (this.sleepBlockerProcess) return
      this.sleepBlockerProcess = spawn('caffeinate', ['-s', '-i'])
      this.sleepBlockerProcess.on('exit', () => { this.sleepBlockerProcess = null })
      log.info('[RemoteControl] caffeinate started')
    } else if (process.platform === 'linux') {
      if (this.sleepBlockerProcess) return
      this.sleepBlockerProcess = spawn('systemd-inhibit', [
        '--what=sleep', '--who=SuperOne', '--why=Remote control active', '--mode=block',
        'sleep', 'infinity',
      ])
      this.sleepBlockerProcess.on('exit', () => { this.sleepBlockerProcess = null })
      log.info('[RemoteControl] systemd-inhibit started')
    } else if (process.platform === 'win32') {
      if (this.powerBlockerId !== null) return
      this.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      log.info('[RemoteControl] powerSaveBlocker started:', this.powerBlockerId)
    }
  }

  private releasePowerLock(): void {
    if (this.sleepBlockerProcess) {
      this.sleepBlockerProcess.kill()
      this.sleepBlockerProcess = null
      log.info('[RemoteControl] sleep blocker process stopped')
    }
    if (this.powerBlockerId !== null) {
      powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = null
      log.info('[RemoteControl] powerSaveBlocker stopped')
    }
  }

  async start(config: RemoteDeviceConfig): Promise<void> {
    await this.stop()
    this.currentConfig = config
    if (!config.enabled || !this.relayUrl) return

    this.keys = await deriveKeys(config.masterSecret)
    this.intentionallyClosed = false
    await this.connectRelay()
    if (config.preventSleep) this.acquirePowerLock()
    log.info('[RemoteControl] Started for device:', config.deviceId)
  }

  async stop(): Promise<void> {
    await this.cancelPairing()
    this.intentionallyClosed = true
    this.clearBatch()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.relayWs) {
      this.relayWs.close(1000, 'stopping')
      this.relayWs = null
    }
    this.keys = null
    this.releasePowerLock()
  }

  private async connectRelay(): Promise<void> {
    if (!this.keys || !this.relayUrl) return

    const ts = Date.now().toString()
    const token = await computeHmacToken(this.keys.channelKeyHex, 'desktop', ts)
    const room = await computeRoomId(this.keys.channelKeyHex)
    log.info('[RemoteControl] channelKeyHex:', this.keys.channelKeyHex.substring(0, 8) + '...')
    log.info('[RemoteControl] room:', room)
    const url = `${this.relayUrl}/ws?role=desktop&token=${token}&ts=${ts}&room=${room}`

    const ws = new WebSocket(url)
    this.relayWs = ws

    ws.on('open', () => {
      log.info('[RemoteControl] Relay connected')
      this.reconnectDelay = 1_000
      ws.send(JSON.stringify({ type: 'handshake', hostName: hostname() }))
    })

    ws.on('message', (raw) => {
      try {
        this.handleRelayMessage(JSON.parse(raw.toString()))
      } catch (err) {
        log.error('[RemoteControl] Failed to parse relay message:', err)
      }
    })

    ws.on('close', () => {
      if (this.relayWs === ws) this.relayWs = null
      if (!this.intentionallyClosed) this.scheduleReconnect()
    })

    ws.on('error', (err) => {
      log.error('[RemoteControl] Relay WS error:', err.message)
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    log.info(`[RemoteControl] Reconnecting in ${this.reconnectDelay}ms`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      await this.connectRelay()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  private async handleRelayMessage(frame: { type: string; [key: string]: unknown }): Promise<void> {
    switch (frame.type) {
      case 'command': {
        if (!this.keys) return
        const command = (await decryptPayload(this.keys.aesKey, frame.data as string)) as RemoteCommand
        this.callbacks.onCommand(command, (requestId, data) => this.sendResponse(requestId, data))
        break
      }
      case 'register': {
        const deviceName = (frame.deviceName as string) ?? 'Unknown Device'
        const deviceId = (frame.mobileDeviceId as string) ?? `unknown-${Date.now()}`
        if (this.callbacks.isPairedDevice && !this.callbacks.isPairedDevice(deviceId)) {
          log.warn('[RemoteControl] Rejecting unrecognized device:', deviceId)
          this.relayWs?.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
          return
        }
        log.info('[RemoteControl] Client registered:', deviceName, deviceId)
        this.onlineDeviceIds.add(deviceId)
        this.callbacks.onClientRegistered?.({ deviceName, deviceId })
        break
      }
      case 'peer_connected':
        log.info('[RemoteControl] Mobile peer connected')
        this.relayWs?.send(JSON.stringify({ type: 'handshake', hostName: hostname() }))
        break
      case 'peer_disconnected': {
        log.info('[RemoteControl] Mobile peer disconnected')
        for (const id of this.onlineDeviceIds) {
          this.onlineDeviceIds.delete(id)
          this.callbacks.onClientDisconnected?.({ deviceId: id })
        }
        break
      }
    }
  }

  async startPairing(): Promise<{ channelId: string; tempKeyHex: string }> {
    await this.cancelPairing()

    const channelIdBytes = webcrypto.getRandomValues(new Uint8Array(8))
    const channelId = bytesToHex(channelIdBytes.buffer)

    const tempKeyBytes = webcrypto.getRandomValues(new Uint8Array(32))
    const tempKeyHex = bytesToHex(tempKeyBytes.buffer)
    const aesKey = await importRawAesKey(tempKeyHex)

    const expiryTimer = setTimeout(async () => {
      log.info('[RemoteControl] Pairing session expired:', channelId)
      await this.cancelPairing()
      this.callbacks.onPairingExpired?.()
    }, PAIRING_TIMEOUT_MS)

    const pairingUrl = `${this.relayUrl}/pair?channel=${channelId}&role=desktop`
    const ws = new WebSocket(pairingUrl)

    this.pairingSession = {
      channelId, aesKey, ws,
      pendingCode: null, pendingMobileDeviceId: null, pendingDeviceName: null,
      expiryTimer,
    }

    ws.on('message', async (raw) => {
      if (!this.pairingSession || this.pairingSession.pendingCode !== null) return
      try {
        const frame = JSON.parse(raw.toString())
        if (frame.type === 'pair_request') {
          const { code, mobileDeviceId, deviceName } = (await decryptPayload(aesKey, frame.data)) as {
            code: string; mobileDeviceId: string; deviceName: string
          }
          const name = deviceName ?? 'Mobile Device'
          if (this.callbacks.isPairedDevice?.(mobileDeviceId)) {
            log.info('[RemoteControl] Device already paired:', mobileDeviceId)
            ws.send(JSON.stringify({ type: 'pair_already_paired' }))
            this.callbacks.onPairingAlreadyPaired?.({ deviceName: name })
            await this.cancelPairing()
            return
          }
          this.pairingSession.pendingCode = code
          this.pairingSession.pendingMobileDeviceId = mobileDeviceId
          this.pairingSession.pendingDeviceName = name
          log.info('[RemoteControl] Pairing code received from:', name)
          this.callbacks.onPairingCodeReceived?.({ code, deviceName: name })
        }
      } catch (err) {
        log.error('[RemoteControl] Failed to handle pair_request:', err)
      }
    })

    ws.on('error', (err) => {
      log.error('[RemoteControl] Pairing WS error:', err.message)
    })

    log.info('[RemoteControl] Pairing session started:', channelId)
    return { channelId, tempKeyHex }
  }

  async confirmPairing(enteredCode: string, masterSecret: string): Promise<void> {
    const session = this.pairingSession
    if (!session || session.pendingCode === null) throw new Error('No pairing request received yet')
    if (session.pendingCode !== enteredCode) throw new Error('Incorrect pairing code')

    const encrypted = await encryptPayload(session.aesKey, {
      masterSecret,
      hostName: hostname(),
      relayUrl: this.relayUrl,
    })
    session.ws?.send(JSON.stringify({ type: 'pair_response', data: encrypted }))

    const mobileDeviceId = session.pendingMobileDeviceId!
    const deviceName = session.pendingDeviceName!
    log.info('[RemoteControl] Pairing confirmed for:', deviceName)
    this.callbacks.onPairingConfirmed?.({ mobileDeviceId, deviceName })
    await this.cancelPairing()
  }

  async cancelPairing(): Promise<void> {
    if (!this.pairingSession) return
    clearTimeout(this.pairingSession.expiryTimer)
    this.pairingSession.ws?.close(1000, 'cancelled')
    this.pairingSession = null
  }

  async broadcastAgentEvent(event: AgentEvent): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return

    if (SKIPPED_EVENTS.has(event.type)) return

    if (THROTTLED_EVENTS.has(event.type)) {
      const now = Date.now()
      const last = this.lastThrottledAt.get(event.type) ?? 0
      if (now - last < THROTTLE_INTERVAL_MS) return
      this.lastThrottledAt.set(event.type, now)
    }

    if (event.type === 'content_delta' || event.type === 'tool_input_delta') {
      this.batchBuffer.push(event)
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_INTERVAL_MS)
      }
      return
    }

    try {
      const data = await encryptPayload(this.keys.aesKey, event)
      this.relayWs.send(JSON.stringify({ type: 'event', data }))
    } catch (err) {
      log.error('[RemoteControl] Failed to send event:', err)
    }
  }

  private async sendResponse(requestId: string, data: unknown): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return
    try {
      const encrypted = await encryptPayload(this.keys.aesKey, data)
      this.relayWs.send(JSON.stringify({ type: 'response', requestId, data: encrypted }))
    } catch (err) {
      log.error('[RemoteControl] Failed to send response:', err)
    }
  }

  private async flushBatch(): Promise<void> {
    this.batchTimer = null
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN || this.batchBuffer.length === 0) return

    try {
      const events = this.batchBuffer.splice(0)
      const data = await encryptPayload(this.keys.aesKey, events)
      this.relayWs.send(JSON.stringify({ type: 'event', data }))
    } catch (err) {
      log.error('[RemoteControl] Failed to flush batch:', err)
    }
  }

  private clearBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.batchBuffer = []
  }
}
