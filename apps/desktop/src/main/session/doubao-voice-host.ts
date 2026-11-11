import type { WebContents } from 'electron'
import { AgentIpcChannels, type AgentEvent } from '@superone/shared/agent-types'
import {
  encodeSeeduplexEvent,
  inputAudioAppend,
  interpretDoubaoServerEvent,
  parseSeeduplexEvent,
  recoverLeadingVoiceUsers,
  redactDoubaoText,
} from '@superone/shared/doubao-realtime'
import {
  VOICE_UPLINK_FRAME_BYTES,
  VOICE_UPLINK_FRAME_MS,
  VOICE_UPLINK_MAX_QUEUED_FRAMES,
  closedSpeakableBlocks,
  delegationIdleOutcome,
  slicePcm20ms,
  voiceDelegationContent,
} from '@superone/shared/voice-delegation'
import { DoubaoCallController, type DoubaoCallCommand, type DoubaoPlaybackFrame } from '@superone/shared/doubao-call'
import type { VoiceIdentity, VoiceStatus } from '@superone/shared/realtime-voice'
import type { VoiceLink } from '@superone/shared/realtime-voice-admission'
import log from '../logger'
import { enqueueSessionQueueOp, queuedSteerCommand } from './session-queue'
import { loadRealtimeTimeline } from './realtime-timeline-repo'
import { getDoubaoSpeaker, getDoubaoSpeechKey } from '../doubao/doubao-speech-settings'
import { connectDoubaoSocket, type DoubaoConnection, type DoubaoSocket } from '../doubao/doubao-socket'
import { windowVoiceEndpoint } from '../agent/realtime-voice-control'
import type { RealtimeVoiceHost, VoiceEndpoint } from './realtime-voice-host'
import type { Session } from './types'

const MAX_AUDIO_CHUNK = 64 * 1024
/** A late timer may send a few due frames. A larger burst is faster than realtime. */
const UPLINK_CATCHUP_FRAMES = 5
/** Mic energy above this, sustained, interrupts playback without waiting for server ASR. */
const BARGE_RMS = 0.08
/** 30 uplink frames is 600 ms. A cough is shorter than that. */
const BARGE_FRAMES = 30
/**
 * Seeduplex stops answering when uplink frames stop without a mute event.
 * Healthy capture arrives about every 100 ms, so this only fills a real gap.
 */
const UPLINK_KEEPALIVE_MS = 400
const SILENT_UPLINK_FRAME = new Uint8Array(VOICE_UPLINK_FRAME_BYTES)

export type DoubaoConnector = (apiKey: string) => Promise<DoubaoConnection>

interface ActiveCall {
  session: Session
  sender: WebContents
  attemptId: string
  endpoint: VoiceEndpoint
  identity: VoiceIdentity | null
  controller: DoubaoCallController
  socket: DoubaoSocket | null
  stopping: boolean
  unsubscribe: (() => void) | null
  uplink: Uint8Array[]
  remainder: Uint8Array
  paceDue: number
  dropLoggedAt: number
  bargeFrames: number
  /** Server mute is on. Silence must not be sent in place of `input_audio_mute.commit`. */
  serverMuted: boolean
  /** Last time an uplink frame was sent. A long gap without mute makes the model stop. */
  lastUplinkAt: number
  pace: (() => void) | null
  openedAt: Map<string, number>
  /** Snapshot length when this handoff was sent. Older assistant text is not the report. */
  replyAfter: number
  /** `${messageId}:${blockId}` already given to the voice queue. */
  spokenBlocks: Set<string>
  /** `delegate_task` sends whose assistant has not finished. */
  pendingDelegates: number
  /** Assistant messages already counted against `pendingDelegates`. */
  settledAssistants: Set<string>
}

/**
 * Desktop Seeduplex call. The API key and socket stay in the main process.
 * Finalized speech becomes one user turn. Host speech uses cancel then commit.
 */
export class DoubaoVoiceHost {
  private active: ActiveCall | null = null
  private readonly connect: DoubaoConnector
  private readonly now: () => number

  constructor(
    private readonly voices: RealtimeVoiceHost,
    options: { connect?: DoubaoConnector; now?: () => number } = {},
  ) {
    this.connect = options.connect ?? connectDoubaoSocket
    this.now = options.now ?? Date.now
  }

  start(session: Session, sender: WebContents, attemptId: string): VoiceStatus {
    const apiKey = getDoubaoSpeechKey()
    if (!apiKey) throw Object.assign(new Error('Add a Doubao speech API key in Settings.'), { code: 'failed_precondition' })
    const endpoint = windowVoiceEndpoint(sender, session)
    const call = this.blank(session, sender, attemptId, endpoint)
    const link: VoiceLink = {
      start: async () => { await this.open(call) },
      stop: async () => { await this.stopCall(call) },
    }
    this.active = call
    try {
      const status = this.voices.startShell(session, endpoint, attemptId, link)
      const admitted = status.call
      if (admitted) {
        call.identity = {
          hostEpoch: admitted.hostEpoch,
          callId: admitted.callId,
          generation: admitted.generation,
          attemptId: admitted.attemptId,
        }
      }
      return status
    } catch (error) {
      if (this.active === call) this.active = null
      throw error
    }
  }

  pushAudio(senderId: number, sessionId: string, pcm: Uint8Array): void {
    const call = this.active
    if (!call || call.sender.id !== senderId || call.session.id !== sessionId || call.stopping) return
    if (pcm.byteLength === 0 || pcm.byteLength > MAX_AUDIO_CHUNK) return
    // IPC may reuse the buffer. Copy before the pacer holds the frame.
    const merged = concat(call.remainder, pcm.slice())
    const sliced = slicePcm20ms(merged)
    call.remainder = sliced.remainder
    if (sliced.frames.length === 0) return
    call.uplink.push(...sliced.frames)
    this.ensurePace(call)
  }

  setMuted(senderId: number, sessionId: string, muted: boolean): void {
    const call = this.active
    if (!call || call.sender.id !== senderId || call.session.id !== sessionId) return
    if (muted) {
      call.uplink = []
      call.remainder = new Uint8Array()
    } else {
      call.lastUplinkAt = this.now()
    }
    call.serverMuted = muted
    this.apply(call, call.controller.mute(muted))
  }

  private blank(session: Session, sender: WebContents, attemptId: string, endpoint: VoiceEndpoint): ActiveCall {
    return {
      session, sender, attemptId, endpoint,
      identity: null,
      controller: new DoubaoCallController({
        speaker: getDoubaoSpeaker(),
        history: recoverLeadingVoiceUsers(
          (loadRealtimeTimeline(session.id)?.segments ?? []).map(segment => ({
            role: segment.role,
            text: segment.text,
            id: segment.sourceItemId,
          })),
          session.snapshot.messages.flatMap(message => (
            message.role === 'user'
              ? message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
              : []
          )),
        ),
      }),
      socket: null,
      stopping: false,
      unsubscribe: null,
      uplink: [],
      remainder: new Uint8Array(),
      paceDue: 0,
      dropLoggedAt: 0,
      bargeFrames: 0,
      serverMuted: false,
      lastUplinkAt: 0,
      pace: null,
      openedAt: new Map(),
      replyAfter: 0,
      spokenBlocks: new Set(),
      pendingDelegates: 0,
      settledAssistants: new Set(),
    }
  }

  private async open(call: ActiveCall): Promise<void> {
    this.watchSession(call)
    await this.connectSocket(call)
  }

  /** One session listener for the whole call, including the single reconnect. */
  private watchSession(call: ActiveCall): void {
    if (call.unsubscribe) return
    call.unsubscribe = call.session.on((event, replay) => {
      if (!replay) this.observeSession(call, event)
    })
  }

  private async connectSocket(call: ActiveCall): Promise<void> {
    const apiKey = getDoubaoSpeechKey()
    if (!apiKey) throw new Error('Add a Doubao speech API key in Settings.')
    const connection = await this.connect(apiKey)
    if (call.stopping || this.active !== call) {
      connection.socket.close()
      return
    }
    call.socket = connection.socket
    if (connection.logid) log.info('[doubao-voice] handshake logid=%s', connection.logid)
    connection.socket.onMessage(text => this.onSocketMessage(call, text))
    connection.socket.onClose(error => {
      if (this.active !== call || call.stopping) return
      this.apply(call, call.controller.ingest({
        type: 'error',
        message: redactDoubaoText(error?.message ?? 'Doubao voice disconnected.'),
        retryable: false,
      }))
    })
    this.apply(call, call.controller.open())
  }

  private async stopCall(call: ActiveCall): Promise<void> {
    if (call.stopping) return
    call.stopping = true
    this.apply(call, call.controller.stop())
    this.clearPace(call)
    call.socket?.close()
    call.unsubscribe?.()
    call.unsubscribe = null
    if (this.active === call) this.active = null
  }

  private onSocketMessage(call: ActiveCall, text: string): void {
    if (this.active !== call) return
    let event: Record<string, unknown>
    try { event = parseSeeduplexEvent(text) }
    catch (error) {
      log.info('[doubao-voice] ignored frame: %s', redactDoubaoText(error instanceof Error ? error.message : String(error)))
      return
    }
    this.apply(call, call.controller.ingest(interpretDoubaoServerEvent(event)))
  }

  private observeSession(call: ActiveCall, event: AgentEvent): void {
    if (this.active !== call || !call.controller.wantsSummary()) return
    const settle = event.type === 'status_change' && event.status === 'idle'
    if (event.type !== 'content_delta' && event.type !== 'message_complete' && !settle) return
    this.speakClosedBlocks(call, settle)
    if (!settle) return
    // A delegation while the session is idle starts a normal turn. One inserted
    // into a turn that is already running is steered, so it stays on that turn.
    // An idle with no assistant after replyAfter must not say 做完了 or close the watch.
    const outcome = delegationIdleOutcome(
      call.session.snapshot.messages,
      call.replyAfter,
      call.pendingDelegates,
      call.settledAssistants,
    )
    for (const id of outcome.settledIds) call.settledAssistants.add(id)
    call.pendingDelegates = outcome.pending
    if (!outcome.finishWatch) return
    this.apply(call, call.controller.noteIdleWithoutSummary())
    call.pendingDelegates = 0
  }

  /** Show each closed text block, and read only its prose. */
  private speakClosedBlocks(call: ActiveCall, settleAll: boolean): void {
    const blocks = closedSpeakableBlocks(
      call.session.snapshot.messages.map(message => ({
        id: message.id,
        role: message.role,
        status: message.status,
        content: message.content.map(block => (
          block.type === 'text'
            ? { type: block.type, id: block.id, text: block.text }
            : { type: block.type }
        )),
      })),
      call.replyAfter,
      settleAll,
    )
    for (const block of blocks) {
      if (call.spokenBlocks.has(block.key)) continue
      call.spokenBlocks.add(block.key)
      this.apply(call, call.controller.queueSummary(block.display, block.spoken))
    }
  }

  private apply(call: ActiveCall, commands: DoubaoCallCommand[]): void {
    for (const command of commands) {
      if (command.type === 'send') this.send(call, command.event)
      else if (command.type === 'delegate') {
        if (!command.continuing) {
          // A fresh task starts after the messages already on screen.
          call.replyAfter = call.session.snapshot.messages.length
          call.spokenBlocks = new Set()
          call.settledAssistants = new Set()
          call.pendingDelegates = 1
        }
        void this.delegate(call, command.kind, command.utterance, command.transcript, command.continuing)
      }
      else if (command.type === 'play') this.playback(call, { type: 'pcm', pcm: command.pcm })
      else if (command.type === 'drop-playback') this.playback(call, { type: 'drop' })
      else if (command.type === 'transcript') this.transcript(call, command)
      else if (command.type === 'ready') this.ready(call, command.dialogId)
      else if (command.type === 'retry') void this.retry(call)
      else if (command.type === 'error') this.event(call, { type: 'realtime_error', error: command.message })
      else if (command.type === 'hangup') this.hangup(call, command.reason)
    }
  }

  private send(call: ActiveCall, event: Record<string, unknown>): void {
    call.socket?.send(encodeSeeduplexEvent(event))
  }

  private async delegate(
    call: ActiveCall,
    kind: 'opening' | 'turn',
    utterance: string,
    transcript: Array<{ role: string; text: string }>,
    continuing: boolean,
  ): Promise<void> {
    const clientMessageId = crypto.randomUUID()
    try {
      await enqueueSessionQueueOp(call.session.id, async () => {
        // Checked before send. A busy turn parks priority next; an idle turn
        // promotes it to a normal send. Steer only the parked one.
        const streaming = call.session.isStreaming()
        await call.session.send({
          content: voiceDelegationContent(utterance, transcript, kind),
          source: 'doubao-voice',
          clientMessageId,
          priority: 'next',
          codexTimeline: { provenance: 'realtime-delegated', turnId: clientMessageId },
        })
        if (!streaming) {
          this.countParkedDelegate(call, continuing)
          return
        }
        const steer = queuedSteerCommand(call.session.snapshot.harnessId, clientMessageId, 'now')
        if (!steer) {
          this.countParkedDelegate(call, continuing)
          return
        }
        try {
          await call.session.dispatchBackendCommand(steer)
          // Antigravity now cancels the live turn and starts another. Grok
          // interjects into the same turn, so one idle still closes the watch.
          if (this.steerStartsAnotherTurn(call)) this.countParkedDelegate(call, continuing)
        } catch (error) {
          this.countParkedDelegate(call, continuing)
          log.warn(
            '[doubao-voice] steer failed sid=%s: %s',
            call.session.id,
            redactDoubaoText(error instanceof Error ? error.message : String(error)),
          )
        }
      })
    } catch (error) {
      this.apply(call, [{ type: 'error', message: redactDoubaoText(error instanceof Error ? error.message : String(error)) }])
    }
  }

  /** A second task that waits for its own turn. A same-turn steer does not. */
  private countParkedDelegate(call: ActiveCall, continuing: boolean): void {
    if (continuing) call.pendingDelegates += 1
  }

  private steerStartsAnotherTurn(call: ActiveCall): boolean {
    return call.session.snapshot.harnessId === 'acp-antigravity'
  }

  private ready(call: ActiveCall, dialogId: string): void {
    this.event(call, { type: 'realtime_started', realtimeSessionId: dialogId, version: 'doubao' })
    if (!call.identity) return
    try { this.voices.ready(call.session, call.endpoint, call.identity) }
    catch (error) {
      log.info('[doubao-voice] ready failed: %s', redactDoubaoText(error instanceof Error ? error.message : String(error)))
    }
  }

  private transcript(call: ActiveCall, command: Extract<DoubaoCallCommand, { type: 'transcript' }>): void {
    if (command.phase === 'started') call.openedAt.set(command.itemId, this.now())
    const startedAtMs = call.openedAt.get(command.itemId)
    // The session assigns the same event order the delegated rows use, so the
    // voice activity card can attach this utterance to that work.
    call.session.emitHostEvent({
      type: 'realtime_transcript_item',
      phase: command.phase,
      itemId: command.itemId,
      text: command.text,
      ...(command.replace ? { replace: true } : {}),
      ...(command.phase === 'delta' ? {} : {
        role: command.role,
        realtimeSessionId: call.controller.sessionId || 'doubao',
        ...(startedAtMs === undefined ? {} : { startedAtMs }),
      }),
    })
  }

  private playback(call: ActiveCall, payload: DoubaoPlaybackFrame): void {
    if (call.sender.isDestroyed()) return
    call.sender.send(AgentIpcChannels.DOUBAO_VOICE_PLAYBACK, payload)
  }

  private event(call: ActiveCall, event: AgentEvent): void {
    if (call.sender.isDestroyed()) return
    call.sender.send(AgentIpcChannels.EVENT, { ...event, sessionId: call.session.id, projectPath: call.session.projectPath })
  }

  private hangup(call: ActiveCall, reason: string): void {
    if (call.stopping) return
    log.info('[doubao-voice] hangup reason=%s', reason)
    void this.voices.stop(call.session, call.endpoint, call.attemptId)
  }

  private async retry(call: ActiveCall): Promise<void> {
    if (call.stopping || this.active !== call) return
    call.socket?.close()
    call.socket = null
    try {
      await this.connectSocket(call)
    } catch (error) {
      this.apply(call, call.controller.ingest({
        type: 'error',
        message: redactDoubaoText(error instanceof Error ? error.message : String(error)),
        retryable: false,
      }))
    }
  }

  private ensurePace(call: ActiveCall): void {
    if (call.pace) return
    call.paceDue = Date.now()
    const timer = setInterval(() => {
      if (this.active !== call) return
      // The model's speaker tail has no socket event when it ends. Speak then.
      const paced = call.controller.pump()
      if (paced.length > 0) this.apply(call, paced)
      const now = this.now()
      if (call.uplink.length === 0) {
        call.paceDue = now
        this.keepUplink(call, now)
        return
      }
      const overflow = call.uplink.length - VOICE_UPLINK_MAX_QUEUED_FRAMES
      if (overflow > 0) {
        call.uplink.splice(0, overflow)
        if (now - call.dropLoggedAt > 1000) {
          call.dropLoggedAt = now
          log.info('[doubao-voice] uplink behind, dropped %d frames', overflow)
        }
      }
      const late = Math.max(1, Math.round((now - call.paceDue) / VOICE_UPLINK_FRAME_MS))
      let budget = Math.min(UPLINK_CATCHUP_FRAMES, late)
      while (budget > 0 && call.uplink.length > 0) {
        const frame = call.uplink.shift()
        budget -= 1
        call.paceDue += VOICE_UPLINK_FRAME_MS
        if (!frame || frame.byteLength !== VOICE_UPLINK_FRAME_BYTES) continue
        this.send(call, inputAudioAppend(frame))
        call.lastUplinkAt = now
        this.noteBarge(call, frame)
      }
      if (now - call.paceDue > VOICE_UPLINK_FRAME_MS * UPLINK_CATCHUP_FRAMES) call.paceDue = now
    }, VOICE_UPLINK_FRAME_MS)
    timer.unref?.()
    call.pace = () => clearInterval(timer)
  }

  /** One silent frame after a real uplink gap. Do not send it while the server is muted. */
  private keepUplink(call: ActiveCall, now: number): void {
    if (call.serverMuted || now - call.lastUplinkAt < UPLINK_KEEPALIVE_MS) return
    call.lastUplinkAt = now
    this.send(call, inputAudioAppend(SILENT_UPLINK_FRAME))
  }

  /** Full duplex: talking over playback stops it. The server's transcript event is often later. */
  private noteBarge(call: ActiveCall, frame: Uint8Array): void {
    if (!call.controller.isSpeaking()) {
      call.bargeFrames = 0
      return
    }
    if (frameRms(frame) < BARGE_RMS) {
      call.bargeFrames = 0
      return
    }
    call.bargeFrames += 1
    if (call.bargeFrames < BARGE_FRAMES) return
    call.bargeFrames = 0
    this.apply(call, call.controller.barge())
  }

  private clearPace(call: ActiveCall): void {
    call.pace?.()
    call.pace = null
    call.uplink = []
    call.remainder = new Uint8Array()
  }
}

function frameRms(frame: Uint8Array): number {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const count = Math.floor(frame.byteLength / 2)
  if (count === 0) return 0
  let energy = 0
  for (let index = 0; index < count; index += 1) {
    const sample = view.getInt16(index * 2, true) / 0x8000
    energy += sample * sample
  }
  return Math.sqrt(energy / count)
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right
  const merged = new Uint8Array(left.byteLength + right.byteLength)
  merged.set(left, 0)
  merged.set(right, left.byteLength)
  return merged
}
