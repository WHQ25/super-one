import type { AgentEvent } from '@superone/shared/agent-types'
import { controlHeldBy, isControlReleasedError } from '@superone/shared/environment'
import {
  acceptVoiceMirrorEvent,
  applyVoiceAgentEvent,
  toVoiceMirrorMessage,
  voiceMirrorStreaming,
  type VoiceDelegationSource,
  type VoiceMirrorMessage,
} from '@superone/shared/voice-delegation'
import log from '../logger'
import { getEnvironmentHost } from '../environment/environment-host'
import { enqueueSessionQueueOp, queuedSteerCommand } from './session-queue'
import { subscribeVoiceRemoteEvents } from './voice-remote-events'
import type { Session } from './types'

export type { VoiceMirrorMessage }

/**
 * The session a desktop voice call delegates into.
 * The speech socket stays on this desktop either way.
 */
export interface VoiceConversation {
  readonly id: string
  readonly projectPath: string
  harnessId(): string
  messages(): VoiceMirrorMessage[]
  isStreaming(): boolean
  /** True when the task was parked instead of steered into the live turn. */
  send(input: { content: string; clientMessageId: string }): Promise<boolean>
  subscribe(listener: (event: AgentEvent) => void): () => void
  publish(event: AgentEvent): void
  close(): void
}

export class LocalVoiceConversation implements VoiceConversation {
  constructor(
    private readonly session: Session,
    private readonly source: VoiceDelegationSource,
  ) {}

  get id(): string { return this.session.id }
  get projectPath(): string { return this.session.projectPath }

  harnessId(): string { return this.session.snapshot.harnessId }
  messages(): VoiceMirrorMessage[] { return this.session.snapshot.messages.map(toVoiceMirrorMessage) }
  isStreaming(): boolean { return this.session.isStreaming() }

  send(input: { content: string; clientMessageId: string }): Promise<boolean> {
    return enqueueSessionQueueOp(this.session.id, async () => {
      const streaming = this.session.isStreaming()
      await this.session.send({
        content: input.content,
        source: this.source,
        clientMessageId: input.clientMessageId,
        priority: 'next',
        codexTimeline: { provenance: 'realtime-delegated', turnId: input.clientMessageId },
      })
      if (!streaming) return true
      const steer = queuedSteerCommand(this.session.snapshot.harnessId, input.clientMessageId)
      if (!steer) return true
      try {
        await this.session.dispatchBackendCommand(steer)
        return false
      } catch (error) {
        log.warn(
          '[voice] steer failed sid=%s: %s',
          this.session.id,
          error instanceof Error ? error.message : String(error),
        )
        return true
      }
    })
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.session.on((event, replay) => { if (!replay) listener(event) })
  }

  publish(event: AgentEvent): void { this.session.emitHostEvent(event) }
  close(): void {}
}

/**
 * A remote session followed from this desktop. The mirror is only for the
 * voice report. The chat keeps its own copy from the same remote events.
 */
const VOICE_LEASE_RENEW_MS = 30_000

export class RemoteVoiceConversation implements VoiceConversation {
  private rows: VoiceMirrorMessage[] = []
  private streaming = false
  private harness = 'claude'
  private baseline = 0
  private eventSeq = 0
  private ready = false
  private readonly buffered: AgentEvent[] = []
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private unsubscribe: (() => void) | null = null
  private leaseHeartbeat: ReturnType<typeof setInterval> | null = null
  lostControl = false
  onControlLost: (() => void) | null = null

  constructor(
    private readonly target: {
      connectionId: string
      projectPath: string
      sessionId: string
      source: VoiceDelegationSource
    },
    private readonly publishEvent: (event: AgentEvent) => void,
  ) {}

  get id(): string { return this.target.sessionId }
  get projectPath(): string { return this.target.projectPath }

  harnessId(): string { return this.harness }
  messages(): VoiceMirrorMessage[] { return this.rows }
  isStreaming(): boolean { return this.streaming }

  async open(): Promise<void> {
    const host = getEnvironmentHost()
    await host.holdSession(this.target.connectionId, this.target.sessionId)
    this.unsubscribe = subscribeVoiceRemoteEvents(event => {
      if (event.sessionId !== this.id) return
      if (event.projectPath && event.projectPath !== this.projectPath) return
      if (!this.ready) {
        this.buffered.push(event)
        return
      }
      this.ingest(event)
    })
    try {
      const loaded = await host.openRemoteSession(this.target.connectionId, {
        sessionId: this.id,
        projectPath: this.projectPath,
        limit: 50,
      })
      const provider = loaded.state.sessionProvider
      if (typeof provider === 'string' && provider) this.harness = provider
      this.streaming = loaded.state.status === 'streaming'
      this.baseline = loaded.cursor.version
      this.eventSeq = loaded.cursor.version
      const seeded = [...loaded.messages]
      for (const row of loaded.activeTurn ?? []) {
        if (!seeded.some(message => message.id === row.id)) seeded.push(row)
      }
      this.rows = seeded.map(toVoiceMirrorMessage)
      this.ready = true
      const pending = this.buffered.splice(0)
      for (const event of pending) this.ingest(event)
      if (!this.lostControl) this.startLeaseHeartbeat()
    } catch (error) {
      this.close()
      throw error
    }
  }

  send(input: { content: string; clientMessageId: string }): Promise<boolean> {
    return enqueueSessionQueueOp(`remote:${this.target.connectionId}:${this.id}`, async () => {
      const host = getEnvironmentHost()
      const streaming = this.streaming
      await host.sendSessionMessage(this.target.connectionId, {
        sessionId: this.id,
        projectPath: this.projectPath,
        text: input.content,
        source: this.target.source,
        clientMessageId: input.clientMessageId,
        priority: 'next',
        codexTimeline: { provenance: 'realtime-delegated', turnId: input.clientMessageId },
      })
      if (!streaming) return true
      const steer = queuedSteerCommand(this.harness, input.clientMessageId)
      if (!steer) {
        log.warn('[voice] remote steer unsupported sid=%s harness=%s', this.id, this.harness)
        return true
      }
      try {
        await host.callSession(this.target.connectionId, this.id, 'session.steer', { clientMessageId: input.clientMessageId })
        return false
      } catch (error) {
        log.warn(
          '[voice] remote steer failed sid=%s: %s',
          this.id,
          error instanceof Error ? error.message : String(error),
        )
        return true
      }
    })
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(event: AgentEvent): void {
    const seq = event.seq === undefined && event.type === 'realtime_transcript_item' && event.phase !== 'delta'
      ? this.eventSeq + 1
      : event.seq
    this.publishEvent({
      ...event,
      sessionId: this.id,
      projectPath: this.projectPath,
      ...(seq === undefined ? {} : { seq }),
    })
  }

  close(): void {
    this.stopLeaseHeartbeat()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
    this.ready = false
  }

  private startLeaseHeartbeat(): void {
    this.stopLeaseHeartbeat()
    const timer = setInterval(() => {
      if (!this.ready || this.lostControl) return
      void getEnvironmentHost().holdSession(this.target.connectionId, this.id).catch(error => {
        if (isControlReleasedError(error) || controlHeldBy(error)) this.noteLost()
      })
    }, VOICE_LEASE_RENEW_MS)
    timer.unref?.()
    this.leaseHeartbeat = timer
  }

  private stopLeaseHeartbeat(): void {
    if (!this.leaseHeartbeat) return
    clearInterval(this.leaseHeartbeat)
    this.leaseHeartbeat = null
  }

  private ingest(event: AgentEvent): void {
    if (!acceptVoiceMirrorEvent(event, this.baseline)) return
    if (typeof event.seq === 'number') this.eventSeq = Math.max(this.eventSeq, event.seq)
    if (event.type === 'remote_control_changed' && event.released) {
      this.noteLost()
      return
    }
    if (event.type === 'session_control_holder' && event.holder) {
      this.noteLost()
      return
    }
    this.rows = applyVoiceAgentEvent(this.rows, event)
    if (event.type === 'status_change') {
      const streaming = voiceMirrorStreaming(event.status)
      if (streaming !== null) this.streaming = streaming
    }
    for (const listener of this.listeners) listener(event)
  }

  private noteLost(): void {
    if (this.lostControl) return
    this.lostControl = true
    this.stopLeaseHeartbeat()
    this.onControlLost?.()
  }
}
