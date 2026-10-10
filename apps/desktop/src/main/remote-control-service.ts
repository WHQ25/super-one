import { frameHostPayload } from './remote/payload-codec'
import type { ChannelEnvelope, PhoneHandshake, PhoneKey, PhoneLinkHost } from './remote/phone-link-host'
import type { SecureChannel } from '@superone/relay-client/secure-channel'
import type { LinkHandshakeInfo } from '@superone/relay-client/phone-link'
import { RelayDraftSaveThrottle } from './remote/relay-draft-save-throttle'
import { createEventBatcher } from '@superone/runtime/stream'
import { MobileEventProfile } from './stream/mobile-profile'
import { webcrypto } from 'node:crypto'
import { hostname } from 'node:os'
import WebSocket from 'ws'
import log from './logger'
import { resolvePairedDeviceDisplayName } from './paired-device-name'
import { variant, variantId } from './variant'
import type { AgentEvent, RemoteCommand, ContentBlock, ChatMessage, RemoteDeviceConfig, TerminalEvent } from '@superone/shared/agent-types'
import { createRelayHeartbeat } from '@superone/shared/relay-heartbeat'

export type { RemoteDeviceConfig }
import { trace } from './agent/event-trace'
import { initHighlighter } from './remote-highlighter'

/**
 * Machine name published over mDNS. The default variant advertises the bare
 * host name; any other appends its label so a phone can tell two SuperOne
 * installs on one machine apart.
 */
function lanHostLabel(): string {
  const label = variant().displayLabel
  return label ? `${hostname()} (${label})` : hostname()
}
import {
  bytesToHex,
  deriveKeys,
  importRawAesKey,
  encryptPayload,
  decryptPayload,
  computeHmacToken,
  computeRoomId,
} from './remote-control-crypto'
import type { RelayFileKeys } from './relay-file-uploader'
import { LanServer, listLanIpAddresses } from './lan-server'
import { LanAdvertiser } from './lan-advertiser'
import { createLanFileTokenSigner, deriveFileTokenKeyFromExtractable, type LanFileTokenSigner } from './lan-file-token'
import { uploadFileToRelay, relayWsToHttp, computeRelayUploadKey, signRelayUploadUrl, downloadAndDecryptRelayFile, deleteRelayFile, type RelayUploadResult, type RelayFileUploadContext } from './relay-file-uploader'

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const MAX_RECONNECT_DELAY_MS = 30_000
const WS_CHUNK_SIZE = 800_000
export { computeTodoItems, countLines, countEditDelta, stripProjectPath, computeToolMeta, computeToolLineDelta, truncateBashOutput, stripEventForRemote, stripMessagesForRemote, parseWorkflowMeta, parseWorkflowTranscriptDir, resolveTodoToolTodos } from './remote-content'
export type { TextSegment, SplitResult } from './split-text-blocks'


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

export interface RemoteCommandSource {
  deviceId: string
  transport: 'relay' | 'lan'
}

/** A phone paired with a per-device channel key. Rows without a key must re-pair. */
export interface PairedPhone {
  deviceId: string
  deviceName: string
  keyId: string
  enabled: boolean
}

export interface PairedPhoneLookup {
  byKey(keyId: string): PairedPhone | null
  byId(deviceId: string): PairedPhone | null
}

export interface RemoteControlCallbacks {
  onCommand: (cmd: RemoteCommand, respond: RemoteResponder, source: RemoteCommandSource) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string; transport: 'lan' | 'relay'; firstConnect: boolean }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  onPairingCodeReceived?: (info: { code: string; deviceName: string }) => void
  onPairingExpired?: () => void
  onPairingConfirmed?: (info: { mobileDeviceId: string; deviceName: string; keyId: string }) => void
  onPairingAlreadyPaired?: (info: { deviceName: string }) => void
  onRelayStatusChanged?: (connected: boolean) => void
  onLanStatusChanged?: (active: boolean) => void
  onLanUploadProgress?: (info: { savedPath: string; receivedBytes: number; done: boolean; error?: string }) => void
  pairedPhones?: PairedPhoneLookup
  /** Test seam only; production keeps the shared relay heartbeat cadence. */
  relayHeartbeat?: { intervalMs: number; timeoutMs: number }
}

type DeviceTransport = 'lan' | 'relay'
type ConnectedDevice = { name: string; transports: Set<DeviceTransport> }
/** One phone's channel through the relay; replaced whenever the phone says hello again. */
type RelayLink = { handshake: PhoneHandshake; channel: SecureChannel | null; device: PhoneKey | null }

/** The channel crypto loads with remote control, never on the startup path. */
let phoneLinkHost: Promise<PhoneLinkHost> | null = null
function loadPhoneLinkHost(): Promise<PhoneLinkHost> {
  return phoneLinkHost ??= import('./remote/phone-link-host')
}

/** Key ids the host issues at pairing: 16 random bytes, hex. */
function newChannelKeyId(): string {
  return bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)).buffer)
}

export class RemoteControlService {
  private relayWs: WebSocket | null = null
  /**
   * The host root (`RemoteDeviceConfig.masterSecret`): it derives every phone's
   * channel secret and the relay room. `channelKeyHex` names the room and
   * authenticates relay file requests; frames are sealed per phone channel.
   */
  private keys: { rootSecret: string; channelKeyHex: string } | null = null
  private relayLinks = new Map<string, RelayLink>()
  /** Set by `start()`; every path that seals or opens a frame runs after it. */
  private phoneLink: PhoneLinkHost | null = null
  private deviceFileKeys = new Map<string, Promise<RelayFileKeys>>()
  private fileTokenSigner: LanFileTokenSigner | null = null
  private connectedDevices = new Map<string, ConnectedDevice>()
  private lanServer: LanServer | null = null
  private lanAdvertiser: LanAdvertiser | null = null
  private currentConfig: RemoteDeviceConfig | null = null
  private pairingSession: PairingSession | null = null

  private sendQueue: Promise<void> = Promise.resolve()
  private terminalQueue: Promise<void> = Promise.resolve()
  private sendGeneration = 0
  /** Batches stay within one recipient set and a relay frame's size budget. */
  private readonly eventBatcher = createEventBatcher<string[]>(
    (events, targets) => this.enqueueEvents(events, targets),
    { maxBytes: 64 * 1024, maxEvents: 128 },
  )
  private readonly mobileProfile = new MobileEventProfile()
  private readonly draftSaves = new RelayDraftSaveThrottle(
    (event, targets) => this.queueSend([event], targets),
    (targets) => this.draftRecipients(targets),
  )
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private intentionallyClosed = false


  private relayUrl = ''
  private lastLanActive = false


  constructor(
    private readonly defaultRelayUrl: string,
    private readonly callbacks: RemoteControlCallbacks,
  ) {}

  resume(): void {
    if (this.currentConfig) this.start(this.currentConfig)
  }

  getOnlineDevices(): Map<string, { name: string; transport: DeviceTransport }> {
    const online = new Map<string, { name: string; transport: DeviceTransport }>()
    for (const [id, info] of this.connectedDevices) {
      online.set(id, { name: info.name, transport: this.primaryTransport(info) })
    }
    return online
  }

  /**
   * Whether some paired phone can actually receive from this host right now.
   * `connectedDevices` keeps relay entries across a relay outage (the DO
   * re-announces peers on reconnect), so a relay device only counts while the
   * relay socket is open; a LAN device holds its own socket.
   */
  hasReachableDevice(): boolean {
    const relayUp = this.isRelayConnected()
    for (const info of this.connectedDevices.values()) {
      if (info.transports.has('lan') || (relayUp && info.transports.has('relay'))) return true
    }
    return false
  }

  getLanPort(): number | null {
    return this.lanServer?.getPort() ?? null
  }

  async signLanFileUrl(realPath: string, opts: { ttlMs?: number } = {}): Promise<string | null> {
    if (!this.fileTokenSigner) return null
    const port = this.lanServer?.getPort()
    if (!port) return null
    const token = await this.fileTokenSigner.sign(realPath, opts)
    return `http://{lanHost}:${port}/files/${encodeURIComponent(token)}`
  }

  async signLanUploadUrl(savedPath: string, opts: { ttlMs?: number } = {}): Promise<string | null> {
    if (!this.fileTokenSigner) return null
    const port = this.lanServer?.getPort()
    if (!port) return null
    const token = await this.fileTokenSigner.sign(savedPath, { ...opts, mode: 'write' })
    return `http://{lanHost}:${port}/files/upload/${encodeURIComponent(token)}`
  }

  private relayFileContext(deviceId?: string): RelayFileUploadContext {
    if (!this.keys || !this.relayUrl) {
      throw new Error('Relay not connected')
    }
    return {
      roomKeyHex: this.keys.channelKeyHex,
      relayHttpUrl: relayWsToHttp(this.relayUrl),
      ...(deviceId ? { fileKeys: this.fileKeysOf(deviceId) } : {}),
    }
  }

  /** Relay-staged files are sealed under static keys from the phone's own channel secret. */
  private fileKeysOf(deviceId: string): Promise<RelayFileKeys> {
    const phone = this.callbacks.pairedPhones?.byId(deviceId)
    if (!this.keys || !phone) return Promise.reject(new Error('Device is not paired'))
    const cacheKey = `${deviceId}:${phone.keyId}`
    let keys = this.deviceFileKeys.get(cacheKey)
    if (!keys) {
      keys = deriveKeys(this.link().deriveIssuedChannelSecret(this.keys.rootSecret, phone.keyId))
      this.deviceFileKeys.set(cacheKey, keys)
    }
    return keys
  }

  async computeRelayUploadKey(name: string): Promise<string> {
    return computeRelayUploadKey(this.relayFileContext(), name)
  }

  async signRelayUploadUrl(key: string): Promise<string> {
    return signRelayUploadUrl(this.relayFileContext(), key)
  }

  async downloadAndDecryptRelayFile(key: string, deviceId: string, onProgress?: (loadedFraction: number) => void): Promise<Buffer> {
    return downloadAndDecryptRelayFile(this.relayFileContext(deviceId), key, onProgress)
  }

  async deleteRelayFile(key: string): Promise<void> {
    return deleteRelayFile(this.relayFileContext(), key)
  }

  async uploadFileToRelay(
    realPath: string,
    meta: { mimeType: string; size: number },
    sessionId: string,
    deviceId: string,
    onProgress?: (loadedFraction: number) => void,
  ): Promise<RelayUploadResult> {
    return uploadFileToRelay(realPath, meta, sessionId, this.relayFileContext(deviceId), onProgress)
  }

  private draftRecipients(targets?: string[]): { lan: string[]; relay: string[] } {
    const recipients = { lan: [] as string[], relay: [] as string[] }
    for (const [id, info] of this.connectedDevices) {
      if (!targets || targets.includes(id)) recipients[this.primaryTransport(info)].push(id)
    }
    return recipients
  }

  private primaryTransport(info: ConnectedDevice): DeviceTransport {
    return info.transports.has('lan') ? 'lan' : 'relay'
  }

  private markDeviceOnline(deviceName: string, deviceId: string, via: DeviceTransport): void {
    const current = this.connectedDevices.get(deviceId)
    if (!current) {
      // Only phones read highlighted content; warm it once one is actually here.
      initHighlighter()
      this.connectedDevices.set(deviceId, { name: deviceName, transports: new Set([via]) })
      this.callbacks.onClientRegistered?.({ deviceName, deviceId, transport: via, firstConnect: true })
      return
    }
    const previousTransport = this.primaryTransport(current)
    current.name = deviceName
    current.transports.add(via)
    const nextTransport = this.primaryTransport(current)
    if (nextTransport !== previousTransport) {
      this.callbacks.onClientRegistered?.({ deviceName, deviceId, transport: nextTransport, firstConnect: false })
    }
  }

  private markDeviceOffline(deviceId: string, via: DeviceTransport): void {
    const current = this.connectedDevices.get(deviceId)
    if (!current || !current.transports.has(via)) return
    const previousTransport = this.primaryTransport(current)
    current.transports.delete(via)
    if (current.transports.size === 0) {
      this.connectedDevices.delete(deviceId)
      this.callbacks.onClientDisconnected?.({ deviceId })
      return
    }
    const nextTransport = this.primaryTransport(current)
    if (nextTransport !== previousTransport) {
      this.callbacks.onClientRegistered?.({ deviceName: current.name, deviceId, transport: nextTransport, firstConnect: false })
    }
  }

  async start(config: RemoteDeviceConfig): Promise<void> {
    await this.stop()
    this.currentConfig = config
    this.relayUrl = config.relayUrl || this.defaultRelayUrl
    if (!config.enabled || !this.relayUrl) return

    this.phoneLink = await loadPhoneLinkHost()
    this.keys = { rootSecret: config.masterSecret, channelKeyHex: (await deriveKeys(config.masterSecret)).channelKeyHex }
    try {
      const hmacKey = await deriveFileTokenKeyFromExtractable(config.masterSecret)
      this.fileTokenSigner = createLanFileTokenSigner(hmacKey)
    } catch (err) {
      log.error('[RemoteControl] Failed to derive file token signer:', err)
      this.fileTokenSigner = null
    }
    this.intentionallyClosed = false
    await this.connectRelay()
    await this.startLanServer()
    log.info('[RemoteControl] Started for device:', config.deviceId)
  }

  private async startLanServer(): Promise<void> {
    if (this.lanServer) return
    const server = new LanServer({
      phoneLink: this.link(),
      resolveKey: (keyId) => this.resolvePhoneKey(keyId),
      handshakeInfo: () => this.handshakeInfo(),
      onCommand: (cmd, respond, source) => this.callbacks.onCommand(cmd, respond, { deviceId: source.deviceId, transport: 'lan' }),
      onClientRegistered: ({ deviceName, deviceId }) => this.markDeviceOnline(deviceName, deviceId, 'lan'),
      onClientDisconnected: ({ deviceId }) => this.markDeviceOffline(deviceId, 'lan'),
      getFileTokenSigner: () => this.fileTokenSigner,
      onUploadProgress: (info) => this.callbacks.onLanUploadProgress?.(info),
    })
    try {
      const { port } = await server.start()
      this.lanServer = server
      log.info(`[RemoteControl] LAN server listening on port ${port}`)
      await this.startLanAdvertiser(port)
    } catch (err) {
      log.error('[RemoteControl] Failed to start LAN server:', err)
    }
    this.emitLanStatus()
  }

  private async startLanAdvertiser(port: number): Promise<void> {
    if (!this.keys) return
    try {
      const roomId = await computeRoomId(this.keys.channelKeyHex)
      const advertiser = new LanAdvertiser()
      this.lanAdvertiser = advertiser
      await advertiser.publish({
        name: `superone-${roomId.substring(0, 8)}`,
        port,
        // Both variants advertise from the same machine, so the label has to
        // disambiguate them in the phone's picker. Carried in hostName rather
        // than a new TXT key so existing clients show it without a change.
        txt: { roomId, hostName: lanHostLabel(), variant: variantId() },
      })
    } catch (err) {
      log.error('[RemoteControl] Failed to start LAN advertiser:', err)
      this.lanAdvertiser = null
    }
  }

  private link(): PhoneLinkHost {
    if (!this.phoneLink) throw new Error('remote control has not started')
    return this.phoneLink
  }

  private handshakeInfo(): LinkHandshakeInfo {
    const port = this.lanServer?.getPort()
    const hosts = port ? listLanIpAddresses() : []
    return { hostName: hostname(), ...(port && hosts.length > 0 ? { lan: { hosts, port } } : {}) }
  }

  /** Key id → the phone it was issued to and its secret; null once the device is removed. */
  private resolvePhoneKey(keyId: string): PhoneKey | null {
    const phone = this.callbacks.pairedPhones?.byKey(keyId)
    if (!phone || !this.keys) return null
    return {
      keyId,
      deviceId: phone.deviceId,
      deviceName: phone.deviceName,
      secretHex: this.link().deriveIssuedChannelSecret(this.keys.rootSecret, keyId),
      enabled: phone.enabled,
    }
  }

  /**
   * Cut a removed phone off now: its key id no longer resolves, so it cannot
   * open a new channel or finish one it started, and the channels it holds are
   * dropped. Call after deleting the pairing.
   */
  revokeDevice(deviceId: string): void {
    for (const key of this.deviceFileKeys.keys()) if (key.startsWith(`${deviceId}:`)) this.deviceFileKeys.delete(key)
    this.relayLinks.delete(deviceId)
    if (this.relayWs?.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
    }
    this.lanServer?.kickDevice(deviceId)
    this.markDeviceOffline(deviceId, 'relay')
    this.markDeviceOffline(deviceId, 'lan')
  }

  /**
   * Drop a switched-off phone's channels without `kicked`, so it keeps its
   * pairing and gets back in once switched on again.
   */
  disconnectDevice(deviceId: string): void {
    this.relayLinks.delete(deviceId)
    this.lanServer?.disconnectDevice(deviceId)
    this.markDeviceOffline(deviceId, 'relay')
    this.markDeviceOffline(deviceId, 'lan')
  }

  private async stopLanServer(): Promise<void> {
    const advertiser = this.lanAdvertiser
    this.lanAdvertiser = null
    if (advertiser) {
      await advertiser.unpublish().catch((err) => {
        log.error('[RemoteControl] LAN advertiser unpublish failed:', err)
      })
    }
    const server = this.lanServer
    this.lanServer = null
    this.emitLanStatus()
    if (!server) return
    for (const [id, info] of Array.from(this.connectedDevices)) {
      if (info.transports.has('lan')) this.markDeviceOffline(id, 'lan')
    }
    await server.stop()
    log.info('[RemoteControl] LAN server stopped')
  }

  isRelayConnected(): boolean {
    return this.relayWs !== null && this.relayWs.readyState === WebSocket.OPEN
  }

  isLanActive(): boolean {
    return this.lanServer !== null && this.lanAdvertiser?.isPublishing() === true
  }

  private emitLanStatus(): void {
    const active = this.isLanActive()
    if (active === this.lastLanActive) return
    this.lastLanActive = active
    this.callbacks.onLanStatusChanged?.(active)
  }

  async stop(): Promise<void> {
    await this.cancelPairing()
    this.intentionallyClosed = true
    this.eventBatcher.clear()
    this.draftSaves.dispose()
    this.sendGeneration++
    this.sendQueue = Promise.resolve()
    this.terminalQueue = Promise.resolve()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    await this.broadcastShutdown()
    if (this.relayWs) {
      this.relayWs.close(1000, 'stopping')
      this.relayWs = null
      this.callbacks.onRelayStatusChanged?.(false)
    }
    await this.stopLanServer()
    this.relayLinks.clear()
    this.deviceFileKeys.clear()
    this.keys = null
    this.fileTokenSigner = null
  }

  private async broadcastShutdown(): Promise<void> {
    const tasks: Promise<void>[] = []
    const relay = this.relayWs
    if (relay && relay.readyState === WebSocket.OPEN) {
      tasks.push(
        new Promise<void>((resolve) => {
          try {
            relay.send(JSON.stringify({ type: 'desktop_shutdown' }), (err) => {
              if (err) log.warn('[RemoteControl] relay desktop_shutdown send failed:', err.message)
              resolve()
            })
          } catch (err) {
            log.warn('[RemoteControl] relay desktop_shutdown threw:', err)
            resolve()
          }
        }),
      )
    }
    if (this.lanServer) {
      tasks.push(this.lanServer.broadcastShutdown().catch(() => {}))
    }
    if (tasks.length === 0) return
    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ])
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
    // Phones open new channels when the relay announces this socket.
    this.relayLinks.clear()
    // A half-open socket never emits 'close' on its own; terminate() does,
    // which hands the dead link to the reconnect path below.
    const heartbeat = createRelayHeartbeat({
      send: (text) => ws.send(text),
      onTimeout: () => {
        log.warn('[RemoteControl] Relay heartbeat timed out, terminating socket')
        ws.terminate()
      },
      ...this.callbacks.relayHeartbeat,
    })

    ws.on('open', () => {
      log.info('[RemoteControl] Relay connected')
      this.reconnectDelay = 1_000
      this.callbacks.onRelayStatusChanged?.(true)
      heartbeat.start()
    })

    ws.on('message', (raw) => {
      const text = raw.toString()
      if (heartbeat.onMessage(text)) return
      try {
        this.handleRelayMessage(JSON.parse(text))
      } catch (err) {
        log.error('[RemoteControl] Failed to parse relay message:', err)
      }
    })

    ws.on('close', (code: number, reason: Buffer) => {
      log.info('[RemoteControl] Relay WS closed:', code, reason.toString())
      heartbeat.stop()
      if (this.relayWs !== ws) return
      this.relayWs = null
      this.callbacks.onRelayStatusChanged?.(false)
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
        const ws = this.relayWs
        const generation = this.sendGeneration
        const deviceId = typeof frame.mobileDeviceId === 'string' ? frame.mobileDeviceId : null
        const link = deviceId ? this.relayLinks.get(deviceId) : undefined
        const channel = link?.channel
        if (!deviceId || !link?.device || !channel || typeof frame.data !== 'string') {
          log.warn('[RemoteControl] relay command without an open channel, dropping')
          return
        }
        let command: RemoteCommand
        try {
          command = this.link().openCommand(channel, frame.data)
        } catch (err) {
          // Only the relay could have injected it; the channel itself stays usable.
          log.warn('[RemoteControl] rejected relay command from %s: %s', deviceId, err instanceof Error ? err.message : String(err))
          return
        }
        if (!this.link().stillPaired((keyId) => this.resolvePhoneKey(keyId), link.device)) {
          log.warn('[RemoteControl] relay command from removed device %s', deviceId)
          this.revokeDevice(deviceId)
          return
        }
        if (!this.link().phoneAllowed((keyId) => this.resolvePhoneKey(keyId), link.device)) {
          log.info('[RemoteControl] relay command from switched-off device %s', deviceId)
          this.disconnectDevice(deviceId)
          return
        }
        trace('remote.in', command.type, command)
        this.callbacks.onCommand(command, (requestId, data) => this.sendResponse(requestId, data, deviceId, channel, ws, generation), { deviceId, transport: 'relay' })
        break
      }
      case 'channel':
        this.handleRelayChannel(frame as ChannelEnvelope & { mobileDeviceId?: unknown })
        break
      case 'peer_connected':
        log.info('[CONN-DESK] peer_connected mobileDeviceId=%s, awaiting its channel', frame.mobileDeviceId ?? '(unknown)')
        break
      case 'peer_disconnected': {
        const deviceId = frame.mobileDeviceId as string | undefined
        if (deviceId) {
          log.info('[RemoteControl] Mobile peer disconnected: %s', deviceId)
          this.relayLinks.delete(deviceId)
          this.markDeviceOffline(deviceId, 'relay')
        } else {
          log.info('[RemoteControl] Mobile peer disconnected (no deviceId)')
          this.relayLinks.clear()
          for (const [id, info] of Array.from(this.connectedDevices)) {
            if (info.transports.has('relay')) this.markDeviceOffline(id, 'relay')
          }
        }
        break
      }
    }
  }

  private handleRelayChannel(frame: ChannelEnvelope & { mobileDeviceId?: unknown }): void {
    const deviceId = typeof frame.mobileDeviceId === 'string' ? frame.mobileDeviceId : null
    const ws = this.relayWs
    if (!deviceId || !ws || ws.readyState !== WebSocket.OPEN) return
    let link = this.relayLinks.get(deviceId)
    if ((frame.msg as { type?: unknown } | undefined)?.type === 'channel_hello' || !link) {
      // A hello starts over: whatever channel this phone had is abandoned.
      link = { handshake: new (this.link().PhoneHandshake)((keyId) => this.resolvePhoneKey(keyId), deviceId), channel: null, device: null }
      this.relayLinks.set(deviceId, link)
    }
    const step = link.handshake.step(frame)
    switch (step.kind) {
      case 'challenge':
        ws.send(JSON.stringify({ ...step.reply, mobileDeviceId: deviceId }))
        return
      case 'rejected':
        log.warn('[RemoteControl] Rejecting relay phone %s: %s', deviceId, step.reason)
        this.relayLinks.delete(deviceId)
        ws.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
        return
      case 'failed':
        log.warn('[RemoteControl] Relay channel handshake failed for %s: %s', deviceId, step.reason)
        this.relayLinks.delete(deviceId)
        return
      case 'established':
        if (!step.device.enabled) {
          log.info('[RemoteControl] Relay phone %s is switched off; not opening its channel', deviceId)
          this.relayLinks.delete(deviceId)
          return
        }
        link.channel = step.channel
        link.device = step.device
        log.info('[CONN-DESK] relay channel established deviceId=%s', deviceId)
        ws.send(JSON.stringify({ ...this.link().sealHandshake(step.channel, this.handshakeInfo()), mobileDeviceId: deviceId }))
        this.markDeviceOnline(step.device.deviceName, deviceId, 'relay')
    }
  }

  async startPairing(): Promise<{ channelId: string; tempKeyHex: string; relayUrl: string }> {
    if (!this.relayUrl) this.relayUrl = this.defaultRelayUrl
    if (!this.relayUrl) throw new Error('No relay URL configured')
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
          if (this.callbacks.pairedPhones?.byId(mobileDeviceId)) {
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
    return { channelId, tempKeyHex, relayUrl: this.relayUrl }
  }

  async confirmPairing(enteredCode: string, masterSecret: string, deviceName?: string): Promise<void> {
    const session = this.pairingSession
    if (!session || session.pendingCode === null) throw new Error('No pairing request received yet')
    if (session.pendingCode !== enteredCode) throw new Error('Incorrect pairing code')

    // The phone gets its own channel secret, derived from the root and a fresh
    // key id, under the QR's temporary key; the root itself never leaves.
    const phoneLink = await loadPhoneLinkHost()
    const keyId = newChannelKeyId()
    const encrypted = await encryptPayload(session.aesKey, {
      credential: { keyId, secretHex: phoneLink.deriveIssuedChannelSecret(masterSecret, keyId) },
      roomId: await computeRoomId((await deriveKeys(masterSecret)).channelKeyHex),
      hostName: hostname(),
      relayUrl: this.relayUrl,
    })
    session.ws?.send(JSON.stringify({ type: 'pair_response', data: encrypted }))

    const mobileDeviceId = session.pendingMobileDeviceId!
    const name = resolvePairedDeviceDisplayName(deviceName, session.pendingDeviceName ?? '')
    log.info('[RemoteControl] Pairing confirmed for:', name)
    this.callbacks.onPairingConfirmed?.({ mobileDeviceId, deviceName: name, keyId })
    await this.cancelPairing()
  }

  async cancelPairing(): Promise<void> {
    if (!this.pairingSession) return
    clearTimeout(this.pairingSession.expiryTimer)
    this.pairingSession.ws?.close(1000, 'cancelled')
    this.pairingSession = null
  }

  async sendEventToMobile(event: Record<string, unknown>, targetDeviceIds?: string[]): Promise<void> {
    this.eventBatcher.flush()
    return this.enqueuePayload(event, targetDeviceIds)
  }

  async sendTerminalFrame(event: TerminalEvent, targetDeviceIds?: string[]): Promise<void> {
    const generation = this.sendGeneration
    this.terminalQueue = this.terminalQueue.then(async () => {
      if (!this.keys || generation !== this.sendGeneration || !this.hasAnyMobileTransport()) return
      const framed = await frameHostPayload(event)
      if (generation !== this.sendGeneration) return
      this.sendRelayFramed('terminal', framed, targetDeviceIds)
      this.lanServer?.sendFramed('terminal', framed, targetDeviceIds)
    }).catch(err => {
      log.error('[RemoteControl] Failed to send terminal frame:', err)
    })
    return this.terminalQueue
  }

  private hasAnyMobileTransport(): boolean {
    const relayOpen = this.relayWs !== null && this.relayWs.readyState === WebSocket.OPEN
    const relayChannel = relayOpen && [...this.relayLinks.values()].some((link) => link.channel)
    return relayChannel || this.lanServer?.hasRegisteredClient() === true
  }

  /**
   * Seal a framed payload once per phone holding a relay channel, skipping
   * phones on the LAN, and address each copy to that phone alone. A frame
   * sealed for a channel is unreadable on any other, so phones without a
   * channel get nothing; the channel's own sequence numbers order each copy.
   */
  private sendRelayFramed(kind: 'event' | 'terminal', framed: Uint8Array, targetDeviceIds?: string[]): void {
    const ws = this.relayWs
    if (ws?.readyState !== WebSocket.OPEN) return
    const targets = targetDeviceIds?.length ? new Set(targetDeviceIds) : null
    for (const [deviceId, link] of this.relayLinks) {
      if (!link.channel || (targets && !targets.has(deviceId))) continue
      if (this.connectedDevices.get(deviceId)?.transports.has('lan')) continue
      ws.send(JSON.stringify({ type: kind, targets: [deviceId], data: this.link().sealHostFrame(link.channel, { t: kind }, framed) }))
    }
  }

  private sendEventFrame(framed: Uint8Array, targetDeviceIds?: string[]): void {
    this.sendRelayFramed('event', framed, targetDeviceIds)
    this.lanServer?.sendFramed('event', framed, targetDeviceIds)
  }

  async sendAgentEvent(event: AgentEvent, targetDeviceIds?: string[]): Promise<void> {
    if (!this.keys) return
    if (!this.hasAnyMobileTransport()) return
    if (event.type === 'draft_changed') {
      this.draftSaves.route(event, targetDeviceIds)
      return
    }
    const events = this.mobileProfile.apply(event)
    if (events.length) this.queueSend(events, targetDeviceIds)
  }

  private async sendResponse(
    requestId: string,
    data: unknown,
    mobileDeviceId: string,
    channel: SecureChannel,
    ws = this.relayWs,
    generation = this.sendGeneration,
  ): Promise<void> {
    const current = () => !!ws && this.relayWs === ws && ws.readyState === WebSocket.OPEN && generation === this.sendGeneration
      && this.relayLinks.get(mobileDeviceId)?.channel === channel
    if (!this.keys || !current()) return
    try {
      trace('remote.resp', requestId, data)
      const framed = await frameHostPayload(data)
      // A response belongs to the channel its command arrived on.
      if (!current()) return
      const encrypted = this.link().sealHostFrame(channel, { t: 'response', requestId }, framed)
      if (encrypted.length <= WS_CHUNK_SIZE) {
        ws!.send(JSON.stringify({ type: 'response', requestId, data: encrypted, mobileDeviceId }))
      } else {
        const totalChunks = Math.ceil(encrypted.length / WS_CHUNK_SIZE)
        log.info(`[RemoteControl] Chunking response ${requestId}: ${encrypted.length} bytes → ${totalChunks} chunks`)
        for (let i = 0; i < totalChunks; i++) {
          const chunk = encrypted.slice(i * WS_CHUNK_SIZE, (i + 1) * WS_CHUNK_SIZE)
          ws!.send(JSON.stringify({ type: 'response_chunk', requestId, index: i, total: totalChunks, data: chunk, mobileDeviceId }))
        }
      }
    } catch (err) {
      log.error('[RemoteControl] Failed to send response:', err)
    }
  }

  private queueSend(events: AgentEvent[], targetDeviceIds?: string[]): void {
    const targets = targetDeviceIds?.length ? [...new Set(targetDeviceIds)].sort() : undefined
    for (const event of events) this.eventBatcher.push(event, targets)
  }

  private enqueueEvents(events: AgentEvent[], targetDeviceIds?: string[]): void {
    if (events.length) void this.enqueuePayload(events, targetDeviceIds)
  }

  private enqueuePayload(payload: unknown, targetDeviceIds?: string[]): Promise<void> {
    const generation = this.sendGeneration
    this.sendQueue = this.sendQueue.then(async () => {
      if (!this.keys || generation !== this.sendGeneration) return
      if (!this.hasAnyMobileTransport()) return
      const framed = await frameHostPayload(payload)
      if (generation === this.sendGeneration) this.sendEventFrame(framed, targetDeviceIds)
    }).catch(err => log.error('[RemoteControl] Failed to send events:', err))
    return this.sendQueue
  }
}
