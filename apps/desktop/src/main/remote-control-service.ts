import { webcrypto } from 'node:crypto'
import { hostname } from 'node:os'
import WebSocket from 'ws'
import log from './logger'
import { resolvePairedDeviceDisplayName } from './paired-device-name'
import { variant, variantId } from './variant'
import type { AgentEvent, RemoteCommand, ContentBlock, ChatMessage, RemoteDeviceConfig, TerminalEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'

export type { RemoteDeviceConfig }
import { trace } from './agent/event-trace'
import { readOutputFile } from './agent/claude-session-runtime'
import { listWorkflowAgentsSync } from './workflow-transcripts'
import { initHighlighter, parseAnsiTokens } from './remote-highlighter'

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
import { LanServer, listLanIpAddresses } from './lan-server'
import { LanAdvertiser } from './lan-advertiser'
import { createLanFileTokenSigner, deriveFileTokenKeyFromExtractable, type LanFileTokenSigner } from './lan-file-token'
import { uploadFileToRelay, relayWsToHttp, computeRelayUploadKey, signRelayUploadUrl, downloadAndDecryptRelayFile, deleteRelayFile, type RelayUploadResult, type RelayFileUploadContext } from './relay-file-uploader'

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const MAX_RECONNECT_DELAY_MS = 30_000
const SKIPPED_EVENTS = new Set([
  'files_persisted', 'elicitation_complete', 'tool_input_delta',
  'subagent_usage', 'checkpoint_captured', 'hook_started', 'hook_complete', 'hook_progress',
  'queued_messages_restored',
  'stream_message_start', 'stream_message_stop',
])
/**
 * A slash command's stdout can be the whole deliverable — a review is the
 * answer the user asked for — so it is forwarded rather than dropped. It is
 * still bounded: `/doctor`-style commands emit output the client discards, and
 * a megabyte of it would be paid for over the relay before being thrown away.
 */
const MAX_SLASH_OUTPUT = 200_000
const THROTTLED_EVENTS = new Set(['tool_progress'])

const WS_CHUNK_SIZE = 800_000
import { TODO_TOOLS, stripEventForRemote, truncateBashOutput, resolveTodoToolTodos, parseWorkflowTranscriptDir, stripProjectPath } from './remote-content'
export { computeTodoItems, countLines, countEditDelta, stripProjectPath, computeToolMeta, computeToolLineDelta, truncateBashOutput, stripEventForRemote, stripMessagesForRemote, parseWorkflowMeta, parseWorkflowTranscriptDir, resolveTodoToolTodos } from './remote-content'
export type { TextSegment, SplitResult } from './split-text-blocks'

const THROTTLE_INTERVAL_MS = 2_000

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

export interface RemoteControlCallbacks {
  onCommand: (cmd: RemoteCommand, respond: RemoteResponder, source: RemoteCommandSource) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string; transport: 'lan' | 'relay'; firstConnect: boolean }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  onPairingCodeReceived?: (info: { code: string; deviceName: string }) => void
  onPairingExpired?: () => void
  onPairingConfirmed?: (info: { mobileDeviceId: string; deviceName: string }) => void
  onPairingAlreadyPaired?: (info: { deviceName: string }) => void
  onRelayStatusChanged?: (connected: boolean) => void
  onLanStatusChanged?: (active: boolean) => void
  onLanUploadProgress?: (info: { savedPath: string; receivedBytes: number; done: boolean; error?: string }) => void
  isPairedDevice?: (deviceId: string) => boolean
}

type DeviceTransport = 'lan' | 'relay'
type ConnectedDevice = { name: string; transports: Set<DeviceTransport> }

export class RemoteControlService {
  private relayWs: WebSocket | null = null
  private keys: { channelKeyHex: string; aesKey: webcrypto.CryptoKey } | null = null
  private fileTokenSigner: LanFileTokenSigner | null = null
  private connectedDevices = new Map<string, ConnectedDevice>()
  private lanServer: LanServer | null = null
  private lanAdvertiser: LanAdvertiser | null = null
  private currentConfig: RemoteDeviceConfig | null = null
  private pairingSession: PairingSession | null = null

  private sendQueue: Promise<void> = Promise.resolve()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private intentionallyClosed = false

  private lastThrottledAt = new Map<string, number>()
  private bashToolCommands = new Map<string, string>()
  private todoToolInputs = new Map<string, { toolName: string; input: string }>()
  private widgetToolIds = new Set<string>()
  private agentToolIds = new Set<string>()
  private agentOutputFiles = new Map<string, string>()
  private workflowToolIds = new Set<string>()
  private workflowTranscriptDirs = new Map<string, string>()

  private relayUrl = ''
  private lastLanActive = false

  private lanFrameSeq = 0

  constructor(
    private readonly defaultRelayUrl: string,
    private readonly callbacks: RemoteControlCallbacks,
  ) {
    initHighlighter()
  }

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

  private relayFileContext(): RelayFileUploadContext {
    if (!this.keys || !this.relayUrl) {
      throw new Error('Relay not connected')
    }
    return {
      channelKeyHex: this.keys.channelKeyHex,
      relayHttpUrl: relayWsToHttp(this.relayUrl),
      aesKey: this.keys.aesKey,
    }
  }

  async computeRelayUploadKey(name: string): Promise<string> {
    return computeRelayUploadKey(this.relayFileContext(), name)
  }

  async signRelayUploadUrl(key: string): Promise<string> {
    return signRelayUploadUrl(this.relayFileContext(), key)
  }

  async downloadAndDecryptRelayFile(key: string, onProgress?: (loadedFraction: number) => void): Promise<Buffer> {
    return downloadAndDecryptRelayFile(this.relayFileContext(), key, onProgress)
  }

  async deleteRelayFile(key: string): Promise<void> {
    return deleteRelayFile(this.relayFileContext(), key)
  }

  async uploadFileToRelay(
    realPath: string,
    meta: { mimeType: string; size: number },
    sessionId: string,
    onProgress?: (loadedFraction: number) => void,
  ): Promise<RelayUploadResult> {
    if (!this.keys || !this.relayUrl) {
      throw new Error('Relay not connected')
    }
    return uploadFileToRelay(realPath, meta, sessionId, {
      channelKeyHex: this.keys.channelKeyHex,
      relayHttpUrl: relayWsToHttp(this.relayUrl),
      aesKey: this.keys.aesKey,
    }, onProgress)
  }

  private primaryTransport(info: ConnectedDevice): DeviceTransport {
    return info.transports.has('lan') ? 'lan' : 'relay'
  }

  private markDeviceOnline(deviceName: string, deviceId: string, via: DeviceTransport): void {
    const current = this.connectedDevices.get(deviceId)
    if (!current) {
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

    this.keys = await deriveKeys(config.masterSecret)
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
      getAesKey: () => this.keys?.aesKey ?? null,
      isPairedDevice: (id) => this.callbacks.isPairedDevice?.(id) ?? false,
      onCommand: (cmd, respond, source) => this.callbacks.onCommand(cmd, respond, { deviceId: source.deviceId, transport: 'lan' }),
      hostName: hostname(),
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

  private buildHandshakeFrame(): string {
    const port = this.lanServer?.getPort()
    const hosts = port ? listLanIpAddresses() : []
    return JSON.stringify({
      type: 'handshake',
      hostName: hostname(),
      ...(port && hosts.length > 0 ? { lan: { hosts, port } } : {}),
    })
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
    this.sendQueue = Promise.resolve()
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
    this.keys = null
    this.fileTokenSigner = null
    this.lanFrameSeq = 0
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

    ws.on('open', () => {
      log.info('[RemoteControl] Relay connected')
      this.reconnectDelay = 1_000
      this.callbacks.onRelayStatusChanged?.(true)
      ws.send(this.buildHandshakeFrame())
    })

    ws.on('message', (raw) => {
      try {
        this.handleRelayMessage(JSON.parse(raw.toString()))
      } catch (err) {
        log.error('[RemoteControl] Failed to parse relay message:', err)
      }
    })

    ws.on('close', (code: number, reason: Buffer) => {
      log.info('[RemoteControl] Relay WS closed:', code, reason.toString())
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
        if (!this.keys) return
        const command = (await decryptPayload(this.keys.aesKey, frame.data as string)) as RemoteCommand
        trace('remote.in', command.type, command)
        const deviceId = (frame.mobileDeviceId as string | undefined) ?? null
        if (!deviceId) {
          log.warn('[RemoteControl] relay command missing mobileDeviceId, dropping')
          return
        }
        this.callbacks.onCommand(command, (requestId, data) => this.sendResponse(requestId, data, deviceId), { deviceId, transport: 'relay' })
        break
      }
      case 'register': {
        const deviceName = (frame.deviceName as string) ?? 'Unknown Device'
        const deviceId = (frame.mobileDeviceId as string) ?? `unknown-${Date.now()}`
        if (this.callbacks.isPairedDevice && !this.callbacks.isPairedDevice(deviceId)) {
          log.warn('[RemoteControl] Rejecting unrecognized device:', deviceId)
          this.relayWs?.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
          this.lanServer?.kickDevice(deviceId)
          return
        }
        log.info('[CONN-DESK] register received deviceId=%s name=%s', deviceId, deviceName)
        this.markDeviceOnline(deviceName, deviceId, 'relay')
        break
      }
      case 'peer_connected':
        log.info('[CONN-DESK] peer_connected mobileDeviceId=%s, sending handshake', frame.mobileDeviceId ?? '(unknown)')
        this.relayWs?.send(this.buildHandshakeFrame())
        break
      case 'peer_disconnected': {
        const deviceId = frame.mobileDeviceId as string | undefined
        if (deviceId) {
          log.info('[RemoteControl] Mobile peer disconnected: %s', deviceId)
          this.markDeviceOffline(deviceId, 'relay')
        } else {
          log.info('[RemoteControl] Mobile peer disconnected (no deviceId)')
          for (const [id, info] of Array.from(this.connectedDevices)) {
            if (info.transports.has('relay')) this.markDeviceOffline(id, 'relay')
          }
        }
        break
      }
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
    return { channelId, tempKeyHex, relayUrl: this.relayUrl }
  }

  async confirmPairing(enteredCode: string, masterSecret: string, deviceName?: string): Promise<void> {
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
    const name = resolvePairedDeviceDisplayName(deviceName, session.pendingDeviceName ?? '')
    log.info('[RemoteControl] Pairing confirmed for:', name)
    this.callbacks.onPairingConfirmed?.({ mobileDeviceId, deviceName: name })
    await this.cancelPairing()
  }

  async cancelPairing(): Promise<void> {
    if (!this.pairingSession) return
    clearTimeout(this.pairingSession.expiryTimer)
    this.pairingSession.ws?.close(1000, 'cancelled')
    this.pairingSession = null
  }

  async sendEventToMobile(event: Record<string, unknown>, targetDeviceIds?: string[]): Promise<void> {
    if (!this.keys) return
    if (!this.hasAnyMobileTransport()) return
    try {
      const data = await encryptPayload(this.keys.aesKey, event)
      this.sendEventFrame(data, targetDeviceIds)
    } catch (err) {
      log.error('[RemoteControl] Failed to send event to mobile:', err)
    }
  }

  async sendTerminalFrame(event: TerminalEvent, targetDeviceIds?: string[]): Promise<void> {
    if (!this.keys) return
    if (!this.hasAnyMobileTransport()) return
    try {
      const data = await encryptPayload(this.keys.aesKey, event)
      const payload: Record<string, unknown> = { type: 'terminal', data }
      if (targetDeviceIds && targetDeviceIds.length > 0) payload.targets = targetDeviceIds
      const json = JSON.stringify(payload)
      if (this.relayWs?.readyState === WebSocket.OPEN) this.relayWs.send(json)
      this.lanServer?.broadcastFrame(json, targetDeviceIds)
    } catch (err) {
      log.error('[RemoteControl] Failed to send terminal frame:', err)
    }
  }

  private hasAnyMobileTransport(): boolean {
    const relayOpen = this.relayWs !== null && this.relayWs.readyState === WebSocket.OPEN
    const lanActive = this.lanServer !== null && !this.lanServer.isEmpty()
    return relayOpen || lanActive
  }

  private sendEventFrame(encryptedData: string, targetDeviceIds?: string[]): void {
    const basePayload: Record<string, unknown> = { type: 'event', data: encryptedData }
    if (targetDeviceIds && targetDeviceIds.length > 0) basePayload.targets = targetDeviceIds
    if (this.relayWs?.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify(basePayload))
    }
    if (this.lanServer) {
      const lanFrame = JSON.stringify({ ...basePayload, seq: ++this.lanFrameSeq })
      this.lanServer.broadcastFrame(lanFrame, targetDeviceIds)
    }
  }

  async sendAgentEvent(event: AgentEvent, targetDeviceIds?: string[]): Promise<void> {
    if (!this.keys) return
    if (!this.hasAnyMobileTransport()) return

    if (event.type === 'provider_changed') {
      trace('remote.out', event.type, event)
      this.queueSend([event], targetDeviceIds)
      return
    }
    trace('remote.debug', 'sendAgentEvent:pass', { eventType: event.type, eventProject: event.projectPath, eventSession: event.sessionId, targets: targetDeviceIds })

    if (event.type === 'tool_input_delta' && 'toolUseId' in event) {
      const entry = this.todoToolInputs.get(event.toolUseId as string)
      if (entry) entry.input += (event as { partialJson: string }).partialJson
    }

    if (SKIPPED_EVENTS.has(event.type)) return

    if (event.type === 'slash_command_output' && event.content.length > MAX_SLASH_OUTPUT) {
      this.queueSend([{ ...event, content: `${event.content.slice(0, MAX_SLASH_OUTPUT)}\n\n… output truncated` }], targetDeviceIds)
      return
    }

    if (THROTTLED_EVENTS.has(event.type)) {
      const now = Date.now()
      const last = this.lastThrottledAt.get(event.type) ?? 0
      if (now - last < THROTTLE_INTERVAL_MS) return
      this.lastThrottledAt.set(event.type, now)
    }

    if (event.type === 'message_start') {
      this.bashToolCommands.clear()
      this.todoToolInputs.clear()
      this.widgetToolIds.clear()
      this.agentToolIds.clear()
      this.agentOutputFiles.clear()
      this.workflowToolIds.clear()
      this.workflowTranscriptDirs.clear()
    }

    if (event.type === 'content_delta') {
      if (event.delta.type === 'text' || event.delta.type === 'thinking') {
        // Forward additive deltas unchanged, including whitespace, sequencing and
        // reasoning timestamps. Markdown parsing belongs to the chat renderer.
        trace('remote.out', event.type, event, event.messageId)
        this.queueSend([event], targetDeviceIds)
        return
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName === 'Bash') {
        try { const p = JSON.parse(event.delta.input); this.bashToolCommands.set(event.delta.toolUseId, String(p.command ?? '')) } catch {}
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName.endsWith('__widget_show')) {
        this.widgetToolIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && isSubagentToolName(event.delta.toolName)) {
        this.agentToolIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName === 'Workflow') {
        this.workflowToolIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && TODO_TOOLS.has(event.delta.toolName)) {
        this.todoToolInputs.set(event.delta.toolUseId, { toolName: event.delta.toolName, input: event.delta.input })
        return
      }
      let stripped: AgentEvent
      if (event.delta.type === 'tool_result' && this.todoToolInputs.has(event.delta.toolUseId)) {
        const entry = this.todoToolInputs.get(event.delta.toolUseId)!
        const toolTodos = resolveTodoToolTodos(entry.toolName, entry.input, event.delta.toolTodos)
        stripped = { ...event, delta: { type: 'todo_result', toolUseId: event.delta.toolUseId, summary: event.delta.summary, parentToolUseId: event.delta.parentToolUseId, todoToolName: entry.toolName, toolTodos } }
      } else if (event.delta.type === 'tool_result' && this.widgetToolIds.has(event.delta.toolUseId)) {
        stripped = { ...event, delta: event.delta }
      } else if (event.delta.type === 'tool_result' && this.bashToolCommands.has(event.delta.toolUseId)) {
        const output = truncateBashOutput(event.delta.summary)
        stripped = { ...event, delta: { type: 'bash_result', toolUseId: event.delta.toolUseId, summary: output, parentToolUseId: event.delta.parentToolUseId, outputTokens: parseAnsiTokens(output) } }
      } else if (event.delta.type === 'tool_result' && this.agentToolIds.has(event.delta.toolUseId)) {
        const outputMatch = event.delta.summary?.match(/output_file:\s*(\S+)/)
        if (outputMatch) this.agentOutputFiles.set(event.delta.toolUseId, outputMatch[1])
        stripped = { ...event, delta: event.delta }
      } else if (event.delta.type === 'tool_result' && this.workflowToolIds.has(event.delta.toolUseId)) {
        const dir = parseWorkflowTranscriptDir(event.delta.summary)
        if (dir) this.workflowTranscriptDirs.set(event.delta.toolUseId, dir)
        stripped = stripEventForRemote(event, event.projectPath)
      } else {
        stripped = stripEventForRemote(event, event.projectPath)
      }
      trace('remote.out', stripped.type, stripped, (stripped as Record<string, unknown>).messageId as string ?? '')
      this.queueSend([stripped], targetDeviceIds)
      return
    }

    let enriched = event
    if (event.remoteView !== 'summary' && event.type === 'task_progress' && event.toolUseId) {
      const outputFile = this.agentOutputFiles.get(event.toolUseId)
      if (outputFile) {
        const { resultText: activityText, toolEntries } = readOutputFile(outputFile, event.projectPath)
        enriched = { ...event, ...(activityText ? { activityText } : {}), ...(toolEntries.length > 0 ? { toolEntries } : {}) }
      }
    }
    if (event.remoteView !== 'summary' && (enriched.type === 'task_progress' || enriched.type === 'task_notification') && enriched.toolUseId && this.workflowToolIds.has(enriched.toolUseId)) {
      const dir = this.workflowTranscriptDirs.get(enriched.toolUseId)
      if (dir) {
        const workflowAgents = listWorkflowAgentsSync(dir)
        if (workflowAgents.length > 0) enriched = { ...enriched, workflowAgents }
      }
    }
    if ((enriched.type === 'task_progress' || enriched.type === 'task_started') && enriched.description && event.projectPath) {
      enriched = { ...enriched, description: stripProjectPath(enriched.description, event.projectPath) }
    }
    const stripped = stripEventForRemote(enriched, event.projectPath)
    trace('remote.out', stripped.type, stripped, (stripped as Record<string, unknown>).messageId as string ?? '')
    this.queueSend([stripped], targetDeviceIds)
  }

  private async sendResponse(requestId: string, data: unknown, mobileDeviceId?: string): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return
    try {
      trace('remote.resp', requestId, data)
      const encrypted = await encryptPayload(this.keys.aesKey, data)
      if (encrypted.length <= WS_CHUNK_SIZE) {
        this.relayWs.send(JSON.stringify({ type: 'response', requestId, data: encrypted, ...(mobileDeviceId ? { mobileDeviceId } : {}) }))
      } else {
        const totalChunks = Math.ceil(encrypted.length / WS_CHUNK_SIZE)
        log.info(`[RemoteControl] Chunking response ${requestId}: ${encrypted.length} bytes → ${totalChunks} chunks`)
        for (let i = 0; i < totalChunks; i++) {
          const chunk = encrypted.slice(i * WS_CHUNK_SIZE, (i + 1) * WS_CHUNK_SIZE)
          this.relayWs.send(JSON.stringify({ type: 'response_chunk', requestId, index: i, total: totalChunks, data: chunk, ...(mobileDeviceId ? { mobileDeviceId } : {}) }))
        }
      }
    } catch (err) {
      log.error('[RemoteControl] Failed to send response:', err)
    }
  }

  private queueSend(events: AgentEvent[], targetDeviceIds?: string[]): void {
    if (events.length === 0) return
    this.sendQueue = this.sendQueue.then(async () => {
      if (!this.keys) return
      if (!this.hasAnyMobileTransport()) return
      const data = await encryptPayload(this.keys.aesKey, events)
      this.sendEventFrame(data, targetDeviceIds)
    }).catch(err => log.error('[RemoteControl] Failed to send events:', err))
  }
}
