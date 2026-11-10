import type { WebContents } from 'electron'
import { AgentIpcChannels, type AgentEvent } from '@superone/shared/agent-types'
import {
  GEMINI_DELEGATE_REPEAT,
  GEMINI_DELEGATE_UNHEARD,
  appendGeminiTranscript,
  buildGeminiSetup,
  buildGeminiTranscribeSetup,
  decodeGeminiServerFrame,
  emptyGeminiPartialCaption,
  emptyGeminiVoiceLog,
  geminiRealtimeAudio,
  geminiToolResponse,
  interpretGeminiServerEvent,
  noteGeminiFinal,
  noteGeminiInterim,
  notePartialFinal,
  notePartialInterim,
  parseGeminiServerEvent,
  redactGeminiText,
  rememberGeminiVoiceLine,
  takeGeminiDelegation,
  type GeminiPartialCaption,
  type GeminiPlaybackFrame,
  type GeminiServerNotice,
  type GeminiVoiceLog,
} from '@superone/shared/gemini-realtime'
import {
  VOICE_FALLBACK_SPOKEN,
  closedSpeakableBlocks,
  delegationIdleOutcome,
  voiceDelegationContent,
} from '@superone/shared/voice-delegation'
import type { VoiceIdentity, VoiceStatus } from '@superone/shared/realtime-voice'
import type { VoiceLink } from '@superone/shared/realtime-voice-admission'
import { isAntigravityAcpAgent } from '@superone/shared/harness/acp-brand'
import log from '../logger'
import { enqueueSessionQueueOp, queuedSteerCommand } from './session-queue'
import { getGeminiSpeechKey, getGeminiVoice } from '../gemini/gemini-speech-settings'
import { connectGeminiSocket, type GeminiSocket } from '../gemini/gemini-socket'
import { windowVoiceEndpoint } from '../agent/realtime-voice-control'
import type { RealtimeVoiceHost, VoiceEndpoint } from './realtime-voice-host'
import type { Session } from './types'

const MAX_AUDIO_CHUNK = 64 * 1024

export type GeminiConnector = (apiKey: string) => Promise<GeminiSocket>

interface PendingTool {
  id: string
  name: string
}

interface ActiveCall {
  session: Session
  sender: WebContents
  attemptId: string
  endpoint: VoiceEndpoint
  identity: VoiceIdentity | null
  socket: GeminiSocket | null
  /** `gemini-3.5-transcribe-live`. Captions only. A failure here leaves the call up. */
  captionSocket: GeminiSocket | null
  captionReady: boolean
  captionQueued: Uint8Array[]
  stopping: boolean
  ready: boolean
  reconnecting: boolean
  resumptionHandle: string
  unsubscribe: (() => void) | null
  queuedAudio: Uint8Array[]
  pendingTools: PendingTool[]
  /** delegate_task arrived before any user line. Answer it once that line closes. */
  heldDelegate: PendingTool | null
  replyAfter: number
  spokenBlocks: Set<string>
  pendingSpeech: string[]
  pendingDelegates: number
  settledAssistants: Set<string>
  /** Authoritative user line. Interim text is only the live caption. */
  userText: string
  userInterim: string
  /** Live user caption from the microphone transcribe socket. */
  partial: GeminiPartialCaption
  assistantText: string
  userItem: number
  assistantItem: number
  /** Spoken lines of this call, and how many the backend has already received. */
  voiceLog: GeminiVoiceLog
}

/**
 * Desktop Gemini Live call. The key and socket stay in the main process.
 * `gemini-3.8-live` speaks and calls tools. `gemini-3.5-transcribe-live`
 * transcribes the microphone for live user captions.
 */
export class GeminiVoiceHost {
  private active: ActiveCall | null = null
  private readonly connect: GeminiConnector

  constructor(
    private readonly voices: RealtimeVoiceHost,
    options: { connect?: GeminiConnector } = {},
  ) {
    this.connect = options.connect ?? connectGeminiSocket
  }

  start(session: Session, sender: WebContents, attemptId: string): VoiceStatus {
    const apiKey = getGeminiSpeechKey()
    if (!apiKey) throw Object.assign(new Error('Add a Gemini speech API key in Settings.'), { code: 'failed_precondition' })
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
    const copy = pcm.slice()
    if (!call.ready || !call.socket) {
      call.queuedAudio.push(copy)
      if (call.queuedAudio.length > 50) call.queuedAudio.shift()
      return
    }
    this.sendAudio(call, copy)
  }

  private blank(session: Session, sender: WebContents, attemptId: string, endpoint: VoiceEndpoint): ActiveCall {
    return {
      session,
      sender,
      attemptId,
      endpoint,
      identity: null,
      socket: null,
      captionSocket: null,
      captionReady: false,
      captionQueued: [],
      stopping: false,
      ready: false,
      reconnecting: false,
      resumptionHandle: '',
      unsubscribe: null,
      queuedAudio: [],
      pendingTools: [],
      heldDelegate: null,
      replyAfter: 0,
      spokenBlocks: new Set(),
      pendingSpeech: [],
      pendingDelegates: 0,
      settledAssistants: new Set(),
      userText: '',
      userInterim: '',
      partial: emptyGeminiPartialCaption(),
      assistantText: '',
      userItem: 0,
      assistantItem: 0,
      voiceLog: emptyGeminiVoiceLog(),
    }
  }

  private async open(call: ActiveCall): Promise<void> {
    this.watchSession(call)
    void this.connectCaption(call)
    await this.connectSocket(call)
  }

  private watchSession(call: ActiveCall): void {
    if (call.unsubscribe) return
    call.unsubscribe = call.session.on((event, replay) => {
      if (!replay) this.observeSession(call, event)
    })
  }

  private async connectSocket(call: ActiveCall): Promise<void> {
    const apiKey = getGeminiSpeechKey()
    if (!apiKey) throw new Error('Add a Gemini speech API key in Settings.')
    const socket = await this.connect(apiKey)
    if (call.stopping || this.active !== call) {
      socket.close()
      return
    }
    call.socket = socket
    call.ready = false
    socket.onFrame((data, isBinary) => this.onFrame(call, data, isBinary))
    socket.onClose(error => {
      if (this.active !== call || call.stopping || call.reconnecting) return
      this.fail(call, error?.message ?? 'Gemini voice disconnected.')
    })
    this.send(call, buildGeminiSetup({
      compressContext: true,
      resume: true,
      voice: getGeminiVoice(),
      ...(call.resumptionHandle ? { resumptionHandle: call.resumptionHandle } : {}),
    }))
  }

  /** Same microphone, second socket. The voice call continues if this never connects. */
  private async connectCaption(call: ActiveCall): Promise<void> {
    const apiKey = getGeminiSpeechKey()
    if (!apiKey || call.stopping || this.active !== call) return
    try {
      const socket = await this.connect(apiKey)
      if (call.stopping || this.active !== call) {
        socket.close()
        return
      }
      call.captionSocket = socket
      socket.onFrame((data, isBinary) => this.onCaptionFrame(call, data, isBinary))
      socket.onClose(() => {
        if (call.captionSocket !== socket) return
        call.captionSocket = null
        call.captionReady = false
      })
      socket.send(JSON.stringify(buildGeminiTranscribeSetup()))
    } catch (error) {
      log.info('[gemini-voice] live captions unavailable: %s', redactGeminiText(error instanceof Error ? error.message : String(error)))
    }
  }

  private async stopCall(call: ActiveCall): Promise<void> {
    if (call.stopping) return
    call.stopping = true
    call.socket?.close()
    call.socket = null
    call.captionSocket?.close()
    call.captionSocket = null
    call.captionReady = false
    call.unsubscribe?.()
    call.unsubscribe = null
    if (this.active === call) this.active = null
  }

  private onFrame(call: ActiveCall, data: Buffer | string, isBinary: boolean): void {
    if (this.active !== call) return
    let text: string
    try {
      text = typeof data === 'string' && !isBinary ? data : decodeGeminiServerFrame(Buffer.isBuffer(data) ? data : Buffer.from(data))
    } catch (error) {
      log.info('[gemini-voice] ignored frame: %s', redactGeminiText(error instanceof Error ? error.message : String(error)))
      return
    }
    let notices: GeminiServerNotice[]
    try { notices = interpretGeminiServerEvent(parseGeminiServerEvent(text)) }
    catch (error) {
      log.info('[gemini-voice] ignored frame: %s', redactGeminiText(error instanceof Error ? error.message : String(error)))
      return
    }
    for (const notice of notices) this.onNotice(call, notice)
  }

  private onCaptionFrame(call: ActiveCall, data: Buffer | string, isBinary: boolean): void {
    if (this.active !== call) return
    let text: string
    try {
      text = typeof data === 'string' && !isBinary ? data : decodeGeminiServerFrame(Buffer.isBuffer(data) ? data : Buffer.from(data))
    } catch (error) {
      log.info('[gemini-voice] ignored caption frame: %s', redactGeminiText(error instanceof Error ? error.message : String(error)))
      return
    }
    let notices: GeminiServerNotice[]
    try { notices = interpretGeminiServerEvent(parseGeminiServerEvent(text)) }
    catch (error) {
      log.info('[gemini-voice] ignored caption frame: %s', redactGeminiText(error instanceof Error ? error.message : String(error)))
      return
    }
    for (const notice of notices) this.onCaptionNotice(call, notice)
  }

  private onCaptionNotice(call: ActiveCall, notice: GeminiServerNotice): void {
    if (notice.type === 'setup-complete') {
      call.captionReady = true
      for (const frame of call.captionQueued) this.sendCaptionAudio(call, frame)
      call.captionQueued = []
      return
    }
    if (notice.type === 'input-interim') this.partialInterim(call, notice.text)
    if (notice.type === 'input-transcript') this.partialFinal(call, notice.text)
    if (notice.type === 'error') {
      log.info('[gemini-voice] caption stream stopped: %s', notice.message)
      call.captionSocket?.close()
      call.captionSocket = null
      call.captionReady = false
    }
  }

  private onNotice(call: ActiveCall, notice: GeminiServerNotice): void {
    if (notice.type === 'setup-complete') {
      call.ready = true
      this.ready(call)
      for (const frame of call.queuedAudio) this.sendAudio(call, frame)
      call.queuedAudio = []
      return
    }
    if (notice.type === 'resumption') {
      call.resumptionHandle = notice.handle
      return
    }
    if (notice.type === 'go-away') {
      void this.reconnect(call)
      return
    }
    if (notice.type === 'audio') this.playback(call, { type: 'pcm', pcm: notice.pcm })
    if (notice.type === 'interrupted') this.playback(call, { type: 'drop' })
    if (notice.type === 'input-interim') this.userInterim(call, notice.text)
    if (notice.type === 'input-transcript') this.userTranscript(call, notice.text)
    if (notice.type === 'output-transcript') this.assistantTranscript(call, notice.text)
    if (notice.type === 'turn-complete') this.finishTranscripts(call)
    if (notice.type === 'tool-call') this.onToolCall(call, notice.calls)
    if (notice.type === 'error') this.fail(call, notice.message)
  }

  private async reconnect(call: ActiveCall): Promise<void> {
    if (call.stopping || this.active !== call || call.reconnecting) return
    if (!call.resumptionHandle) {
      this.fail(call, 'Gemini voice connection is ending and has no resumption handle.')
      return
    }
    call.reconnecting = true
    call.socket?.close()
    call.socket = null
    call.ready = false
    try {
      await this.connectSocket(call)
    } catch (error) {
      this.fail(call, error instanceof Error ? error.message : 'Gemini voice reconnect failed.')
    } finally {
      call.reconnecting = false
    }
  }

  private onToolCall(call: ActiveCall, calls: Array<{ id: string; name: string }>): void {
    for (const tool of calls) {
      if (tool.name !== 'delegate_task') {
        this.send(call, geminiToolResponse([{ id: tool.id, name: tool.name, result: 'Unsupported.' }]))
        continue
      }
      const handoff = takeGeminiDelegation(call.voiceLog, this.openUserLine(call))
      if (!handoff) {
        // Transcription can arrive after the tool call. Hold the first one until the line closes.
        if (call.voiceLog.sent === 0 && !call.heldDelegate) {
          call.heldDelegate = tool
          continue
        }
        this.send(call, geminiToolResponse([{
          id: tool.id,
          name: tool.name,
          result: call.voiceLog.sent === 0 ? GEMINI_DELEGATE_UNHEARD : GEMINI_DELEGATE_REPEAT,
          scheduling: 'SILENT',
        }]))
        continue
      }
      this.beginHandoff(call, tool, handoff)
    }
  }

  private openUserLine(call: ActiveCall): string {
    return call.userText.trim() || call.userInterim.trim()
  }

  private beginHandoff(
    call: ActiveCall,
    tool: PendingTool,
    handoff: { log: GeminiVoiceLog; kind: 'opening' | 'turn'; transcript: GeminiVoiceLog['lines'] },
  ): void {
    call.voiceLog = handoff.log
    call.pendingTools.push(tool)
    call.replyAfter = call.session.snapshot.messages.length
    call.spokenBlocks = new Set()
    call.pendingSpeech = []
    call.settledAssistants = new Set()
    call.pendingDelegates = 1
    void this.delegate(call, handoff.kind, handoff.transcript)
  }

  private observeSession(call: ActiveCall, event: AgentEvent): void {
    if (this.active !== call || call.pendingDelegates <= 0) return
    const settle = event.type === 'status_change' && event.status === 'idle'
    if (event.type !== 'content_delta' && event.type !== 'message_complete' && !settle) return
    this.collectSpeech(call, settle)
    if (!settle) return
    const outcome = delegationIdleOutcome(
      call.session.snapshot.messages,
      call.replyAfter,
      call.pendingDelegates,
      call.settledAssistants,
    )
    for (const id of outcome.settledIds) call.settledAssistants.add(id)
    call.pendingDelegates = outcome.pending
    if (!outcome.finishWatch) return
    this.answerTool(call)
  }

  private collectSpeech(call: ActiveCall, settleAll: boolean): void {
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
      if (call.spokenBlocks.has(block.key) || !block.spoken) continue
      call.spokenBlocks.add(block.key)
      call.pendingSpeech.push(block.spoken)
    }
  }

  private answerTool(call: ActiveCall): void {
    const tool = call.pendingTools.shift()
    call.pendingDelegates = 0
    if (!tool) return
    const result = call.pendingSpeech.join('\n\n').trim() || VOICE_FALLBACK_SPOKEN
    call.pendingSpeech = []
    this.send(call, geminiToolResponse([{ id: tool.id, name: tool.name, result }]))
  }

  private async delegate(
    call: ActiveCall,
    kind: 'opening' | 'turn',
    transcript: Array<{ role: 'user' | 'assistant'; text: string }>,
  ): Promise<void> {
    const utterance = transcript.filter(line => line.role === 'user').map(line => line.text).join('\n')
    const clientMessageId = crypto.randomUUID()
    try {
      await enqueueSessionQueueOp(call.session.id, async () => {
        const streaming = call.session.isStreaming()
        await call.session.send({
          content: voiceDelegationContent(utterance, transcript, kind),
          source: 'gemini-voice',
          clientMessageId,
          priority: 'next',
          codexTimeline: { provenance: 'realtime-delegated', turnId: clientMessageId },
        })
        if (!streaming) return
        const steer = queuedSteerCommand(call.session.snapshot.harnessId, clientMessageId, 'now')
        if (!steer) return
        try {
          await call.session.dispatchBackendCommand(steer)
          if (this.steerStartsAnotherTurn(call)) call.pendingDelegates += 1
        } catch (error) {
          log.warn(
            '[gemini-voice] steer failed sid=%s: %s',
            call.session.id,
            redactGeminiText(error instanceof Error ? error.message : String(error)),
          )
        }
      })
    } catch (error) {
      this.fail(call, error instanceof Error ? error.message : 'Gemini voice delegation failed.')
    }
  }

  private steerStartsAnotherTurn(call: ActiveCall): boolean {
    return call.session.snapshot.harnessId === 'acp' && isAntigravityAcpAgent(call.session.snapshot.acpAgentId)
  }

  private partialInterim(call: ActiveCall, incoming: string): void {
    if (call.userText || this.repeatsClosedUserLine(call, incoming)) return
    const change = notePartialInterim(call.partial, incoming)
    if (!change) return
    this.applyPartial(call, change)
  }

  private partialFinal(call: ActiveCall, incoming: string): void {
    if (call.userText || this.repeatsClosedUserLine(call, incoming)) return
    const change = notePartialFinal(call.partial, incoming)
    if (!change) return
    this.applyPartial(call, change)
  }

  /** A caption that arrives after the voice model already closed the line is the same utterance. */
  private repeatsClosedUserLine(call: ActiveCall, incoming: string): boolean {
    if (call.partial.committed || call.partial.interim || call.userInterim) return false
    const last = [...call.voiceLog.lines].reverse().find(line => line.role === 'user')
    const text = incoming.trim()
    return !!last && !!text && (last.text === text || last.text.startsWith(text))
  }

  private applyPartial(
    call: ActiveCall,
    change: { caption: GeminiPartialCaption; text: string; open: boolean; replace: boolean; delta: string },
  ): void {
    call.partial = change.caption
    call.userInterim = change.text
    this.showUserCaption(call, change)
  }

  private userInterim(call: ActiveCall, incoming: string): void {
    const change = noteGeminiInterim({ final: call.userText, interim: call.userInterim }, incoming)
    if (!change) return
    call.userText = change.caption.final
    call.userInterim = change.caption.interim
    this.showUserCaption(call, change)
  }

  private userTranscript(call: ActiveCall, incoming: string): void {
    const change = noteGeminiFinal({ final: call.userText, interim: call.userInterim }, incoming)
    if (!change) return
    call.userText = change.caption.final
    call.userInterim = change.caption.interim
    this.showUserCaption(call, change)
  }

  private showUserCaption(
    call: ActiveCall,
    change: { text: string; open: boolean; replace: boolean; delta: string },
  ): void {
    const itemId = `gemini-user-${call.userItem}`
    if (change.open) this.openTranscript(call, itemId, 'user', change.text)
    else this.transcript(call, itemId, change.replace ? change.text : change.delta, change.replace)
  }

  private assistantTranscript(call: ActiveCall, incoming: string): void {
    const first = call.assistantText.length === 0
    const merged = appendGeminiTranscript(call.assistantText, incoming)
    if (!merged) return
    call.assistantText = merged.text
    const itemId = `gemini-assistant-${call.assistantItem}`
    if (first) this.openTranscript(call, itemId, 'assistant', merged.text)
    else this.transcript(call, itemId, merged.delta)
  }

  private finishTranscripts(call: ActiveCall): void {
    const userLine = call.userText.trim() || call.userInterim.trim()
    if (userLine) {
      this.completeTranscript(call, `gemini-user-${call.userItem}`, 'user', userLine)
      call.voiceLog = rememberGeminiVoiceLine(call.voiceLog, 'user', userLine)
      call.userItem += 1
      call.userText = ''
      call.userInterim = ''
      call.partial = emptyGeminiPartialCaption()
    }
    if (call.assistantText) {
      this.completeTranscript(call, `gemini-assistant-${call.assistantItem}`, 'assistant', call.assistantText)
      call.voiceLog = rememberGeminiVoiceLine(call.voiceLog, 'assistant', call.assistantText)
      call.assistantItem += 1
      call.assistantText = ''
    }
    this.releaseHeldDelegate(call)
  }

  /** A tool call that raced ahead of transcription sends the line once it has closed. */
  private releaseHeldDelegate(call: ActiveCall): void {
    const tool = call.heldDelegate
    if (!tool) return
    call.heldDelegate = null
    const handoff = takeGeminiDelegation(call.voiceLog, this.openUserLine(call))
    if (!handoff) {
      this.send(call, geminiToolResponse([{
        id: tool.id,
        name: tool.name,
        result: GEMINI_DELEGATE_UNHEARD,
        scheduling: 'SILENT',
      }]))
      return
    }
    this.beginHandoff(call, tool, handoff)
  }

  private openTranscript(call: ActiveCall, itemId: string, role: 'user' | 'assistant', text: string): void {
    call.session.emitHostEvent({
      type: 'realtime_transcript_item',
      phase: 'started',
      itemId,
      role,
      text,
      realtimeSessionId: 'gemini',
      startedAtMs: Date.now(),
    })
  }

  private transcript(call: ActiveCall, itemId: string, text: string, replace = false): void {
    call.session.emitHostEvent({
      type: 'realtime_transcript_item',
      phase: 'delta',
      itemId,
      text,
      ...(replace ? { replace: true } : {}),
    })
  }

  private completeTranscript(call: ActiveCall, itemId: string, role: 'user' | 'assistant', text: string): void {
    call.session.emitHostEvent({
      type: 'realtime_transcript_item',
      phase: 'completed',
      itemId,
      role,
      text,
      realtimeSessionId: 'gemini',
    })
  }

  private ready(call: ActiveCall): void {
    this.event(call, { type: 'realtime_started', realtimeSessionId: 'gemini', version: 'gemini' })
    if (!call.identity) return
    try { this.voices.ready(call.session, call.endpoint, call.identity) }
    catch (error) {
      log.info('[gemini-voice] ready failed: %s', redactGeminiText(error instanceof Error ? error.message : String(error)))
    }
  }

  private fail(call: ActiveCall, message: string): void {
    this.event(call, { type: 'realtime_error', error: redactGeminiText(message) })
  }

  private send(call: ActiveCall, event: Record<string, unknown>): void {
    call.socket?.send(JSON.stringify(event))
  }

  private sendAudio(call: ActiveCall, pcm: Uint8Array): void {
    this.send(call, geminiRealtimeAudio(pcm))
    if (!call.captionSocket) return
    if (!call.captionReady) {
      call.captionQueued.push(pcm)
      if (call.captionQueued.length > 50) call.captionQueued.shift()
      return
    }
    this.sendCaptionAudio(call, pcm)
  }

  private sendCaptionAudio(call: ActiveCall, pcm: Uint8Array): void {
    call.captionSocket?.send(JSON.stringify(geminiRealtimeAudio(pcm)))
  }

  private playback(call: ActiveCall, payload: GeminiPlaybackFrame): void {
    if (call.sender.isDestroyed()) return
    call.sender.send(AgentIpcChannels.GEMINI_VOICE_PLAYBACK, payload)
  }

  private event(call: ActiveCall, event: AgentEvent): void {
    if (call.sender.isDestroyed()) return
    call.sender.send(AgentIpcChannels.EVENT, { ...event, sessionId: call.session.id, projectPath: call.session.projectPath })
  }
}
