import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { webcrypto } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { powerSaveBlocker } from 'electron'
import log from './logger'
import type { AgentEvent, RemoteCommand } from '../shared/agent-types'

const subtle = webcrypto.subtle
const encoder = new TextEncoder()

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function importKeyMaterial(masterSecretHex: string): Promise<webcrypto.CryptoKey> {
  const bytes = new Uint8Array(masterSecretHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits'])
}

async function deriveKeys(masterSecretHex: string): Promise<{
  channelKeyHex: string
  aesKey: webcrypto.CryptoKey
}> {
  const channelBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('channel-key') },
    await importKeyMaterial(masterSecretHex),
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
  const bytes = new Uint8Array(keyHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
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

async function computeSignature(timestamp: number, nonce: string, channelKeyHex: string): Promise<string> {
  const parts = [timestamp.toString(), nonce, channelKeyHex].sort()
  const hash = await subtle.digest('SHA-1', encoder.encode(parts.join('')))
  return bytesToHex(hash)
}

function generateNonce(): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(3))).toString('hex')
}

interface IncomingEnvelope {
  timestamp: number
  nonce: string
  signature: string
  data: string
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
  pairingSupabase: SupabaseClient
  pairingChannel: RealtimeChannel
  pendingCode: string | null
  pendingMobileDeviceId: string | null
  pendingDeviceName: string | null
  expiryTimer: ReturnType<typeof setTimeout>
}

export interface RemoteControlCallbacks {
  onCommand: (cmd: RemoteCommand) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  onPairingCodeReceived?: (info: { code: string; deviceName: string }) => void
  onPairingExpired?: () => void
  onPairingConfirmed?: (info: { mobileDeviceId: string; deviceName: string }) => void
  onPairingAlreadyPaired?: (info: { deviceName: string }) => void
  isPairedDevice?: (deviceId: string) => boolean
}

export class RemoteControlService {
  private supabase: SupabaseClient | null = null
  private channel: RealtimeChannel | null = null
  private keys: { channelKeyHex: string; aesKey: webcrypto.CryptoKey } | null = null
  private seenSignatures = new Set<string>()
  private onlineDeviceIds = new Set<string>()
  private currentConfig: RemoteDeviceConfig | null = null
  private sleepBlockerProcess: ChildProcess | null = null
  private powerBlockerId: number | null = null
  private pairingSession: PairingSession | null = null

  constructor(
    private readonly supabaseUrl: string,
    private readonly publishableKey: string,
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
    if (!config.enabled || !this.supabaseUrl || !this.publishableKey) return

    const keys = await deriveKeys(config.masterSecret)
    this.keys = keys
    this.supabase = createClient(this.supabaseUrl, this.publishableKey)
    this.channel = this.supabase.channel(`agent:${config.deviceId}`)

    this.channel.on(
      'broadcast',
      { event: 'command' },
      async ({ payload }: { payload: IncomingEnvelope }) => {
        try {
          const { timestamp, nonce, signature, data } = payload
          if (Math.abs(Date.now() - timestamp) > 30_000) {
            log.warn('[RemoteControl] Envelope expired')
            return
          }
          const expected = await computeSignature(timestamp, nonce, keys.channelKeyHex)
          if (expected !== signature) {
            log.warn('[RemoteControl] Invalid signature')
            return
          }
          if (this.seenSignatures.has(signature)) {
            log.warn('[RemoteControl] Replay attack rejected')
            return
          }
          this.seenSignatures.add(signature)
          setTimeout(() => this.seenSignatures.delete(signature), 30_000)
          const command = (await decryptPayload(keys.aesKey, data)) as RemoteCommand
          this.callbacks.onCommand(command)
        } catch (err) {
          log.error('[RemoteControl] Failed to handle command:', err)
        }
      },
    )

    this.channel.on('broadcast', { event: 'register' }, ({ payload }: { payload: { deviceName?: string; mobileDeviceId?: string } }) => {
      const deviceName = payload?.deviceName ?? 'Unknown Device'
      const deviceId = payload?.mobileDeviceId ?? `unknown-${Date.now()}`
      if (this.callbacks.isPairedDevice && !this.callbacks.isPairedDevice(deviceId)) {
        log.warn('[RemoteControl] Rejecting unrecognized device:', deviceId)
        this.channel?.send({ type: 'broadcast', event: 'kicked', payload: { mobileDeviceId: deviceId } })
        return
      }
      log.info('[RemoteControl] Client registered:', deviceName, deviceId)
      this.onlineDeviceIds.add(deviceId)
      this.callbacks.onClientRegistered?.({ deviceName, deviceId })
      this.channel?.send({ type: 'broadcast', event: 'handshake', payload: { hostName: hostname() } })
    })

    this.channel.on('broadcast', { event: 'disconnect' }, ({ payload }: { payload: { mobileDeviceId?: string } }) => {
      const deviceId = payload?.mobileDeviceId
      if (deviceId) {
        this.onlineDeviceIds.delete(deviceId)
        log.info('[RemoteControl] Client disconnected:', deviceId)
        this.callbacks.onClientDisconnected?.({ deviceId })
      }
    })

    this.channel.subscribe()
    if (config.preventSleep) this.acquirePowerLock()
    log.info('[RemoteControl] Channel started for device:', config.deviceId)
  }

  async stop(): Promise<void> {
    await this.cancelPairing()
    if (this.channel && this.supabase) {
      await this.supabase.removeChannel(this.channel)
    }
    this.channel = null
    this.supabase = null
    this.keys = null
    this.seenSignatures.clear()
    this.releasePowerLock()
  }

  async startPairing(): Promise<{ channelId: string; tempKeyHex: string }> {
    await this.cancelPairing()

    const channelIdBytes = webcrypto.getRandomValues(new Uint8Array(8))
    const channelId = bytesToHex(channelIdBytes.buffer)

    const tempKeyBytes = webcrypto.getRandomValues(new Uint8Array(32))
    const tempKeyHex = bytesToHex(tempKeyBytes.buffer)
    const aesKey = await importRawAesKey(tempKeyHex)

    const pairingSupabase = createClient(this.supabaseUrl, this.publishableKey)
    const pairingChannel = pairingSupabase.channel(`pairing:${channelId}`)

    const expiryTimer = setTimeout(async () => {
      log.info('[RemoteControl] Pairing session expired:', channelId)
      await this.cancelPairing()
      this.callbacks.onPairingExpired?.()
    }, PAIRING_TIMEOUT_MS)

    this.pairingSession = {
      channelId, aesKey, pairingSupabase, pairingChannel,
      pendingCode: null, pendingMobileDeviceId: null, pendingDeviceName: null,
      expiryTimer,
    }

    pairingChannel.on('broadcast', { event: 'pair_request' }, async ({ payload }: { payload: { data: string } }) => {
      if (!this.pairingSession || this.pairingSession.pendingCode !== null) return
      try {
        const { code, mobileDeviceId, deviceName } = await decryptPayload(aesKey, payload.data) as {
          code: string; mobileDeviceId: string; deviceName: string
        }
        const name = deviceName ?? 'Mobile Device'
        if (this.callbacks.isPairedDevice?.(mobileDeviceId)) {
          log.info('[RemoteControl] Device already paired:', mobileDeviceId)
          this.pairingSession?.pairingChannel.send({ type: 'broadcast', event: 'pair_already_paired', payload: {} })
          this.callbacks.onPairingAlreadyPaired?.({ deviceName: name })
          await this.cancelPairing()
          return
        }
        this.pairingSession.pendingCode = code
        this.pairingSession.pendingMobileDeviceId = mobileDeviceId
        this.pairingSession.pendingDeviceName = name
        log.info('[RemoteControl] Pairing code received from:', name)
        this.callbacks.onPairingCodeReceived?.({ code, deviceName: name })
      } catch (err) {
        log.error('[RemoteControl] Failed to handle pair_request:', err)
      }
    })

    pairingChannel.subscribe()
    log.info('[RemoteControl] Pairing session started:', channelId)
    return { channelId, tempKeyHex }
  }

  async confirmPairing(enteredCode: string, masterSecret: string): Promise<void> {
    const session = this.pairingSession
    if (!session || session.pendingCode === null) throw new Error('No pairing request received yet')
    if (session.pendingCode !== enteredCode) throw new Error('Incorrect pairing code')

    const encrypted = await encryptPayload(session.aesKey, { masterSecret, hostName: hostname() })
    session.pairingChannel.send({
      type: 'broadcast',
      event: 'pair_response',
      payload: { data: encrypted },
    })

    const mobileDeviceId = session.pendingMobileDeviceId!
    const deviceName = session.pendingDeviceName!
    log.info('[RemoteControl] Pairing confirmed for:', deviceName)
    this.callbacks.onPairingConfirmed?.({ mobileDeviceId, deviceName })
    await this.cancelPairing()
  }

  async cancelPairing(): Promise<void> {
    if (!this.pairingSession) return
    clearTimeout(this.pairingSession.expiryTimer)
    await this.pairingSession.pairingSupabase.removeChannel(this.pairingSession.pairingChannel)
    this.pairingSession = null
  }

  async broadcastAgentEvent(event: AgentEvent): Promise<void> {
    if (!this.keys || !this.channel) return
    try {
      const nonce = generateNonce()
      const timestamp = Date.now()
      const data = await encryptPayload(this.keys.aesKey, event)
      const signature = await computeSignature(timestamp, nonce, this.keys.channelKeyHex)
      this.channel.send({
        type: 'broadcast',
        event: 'agent_event',
        payload: { timestamp, nonce, signature, data },
      })
    } catch (err) {
      log.error('[RemoteControl] Failed to broadcast event:', err)
    }
  }
}
