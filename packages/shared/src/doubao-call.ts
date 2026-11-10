import {
  buildDoubaoStartSession,
  inputAudioMute,
  responseCancel,
  sessionClose,
  historyItemsEvent,
  speechTextCommit,
  toolResultEvent,
  type DoubaoFunctionCall,
  type DoubaoHistoryLine,
  type DoubaoServerNotice,
} from './doubao-realtime'
import type { RealtimeTranscriptLine } from './realtime-timeline'
import {
  VOICE_DELEGATE_TOOL,
  VOICE_FALLBACK_SPOKEN,
  mergeAsrText,
  stripVoiceAsides,
} from './voice-delegation'

export type DoubaoPlaybackFrame = { type: 'pcm'; pcm: Uint8Array } | { type: 'drop' }

export type DoubaoCallActivity = 'listening' | 'user-speaking' | 'thinking' | 'assistant-speaking'

export type DoubaoCallCommand =
  | { type: 'send'; event: Record<string, unknown> }
  | { type: 'delegate'; kind: 'opening' | 'turn'; utterance: string; continuing: boolean; transcript: RealtimeTranscriptLine[] }
  | { type: 'play'; pcm: Uint8Array }
  | { type: 'drop-playback' }
  | { type: 'transcript'; phase: 'started' | 'delta' | 'completed'; role: 'user' | 'assistant'; itemId: string; text: string; replace?: boolean }
  | { type: 'activity'; activity: DoubaoCallActivity }
  | { type: 'ready'; dialogId: string }
  | { type: 'hangup'; reason: string }
  | { type: 'retry' }
  | { type: 'error'; message: string }

const IDLE_END = '45000003'
/** Host TTS is pcm_s16le at 24 kHz. One second is 48000 bytes. */
const HOST_PCM_RATE = 24_000
/**
 * A mic open with no words. Releasing it at once cancels the turn the user just
 * started. An empty end-of-speech still releases immediately.
 */
const WORDLESS_MIC_MS = 800
/**
 * `response.done` often arrives before the start sentence. Releasing the
 * readout in that same event cancels it. Wait this long with no model audio,
 * then the agent's block may be read.
 */
const VOICE_QUIET_MS = 800
/**
 * The confirmation is generated only after the tool result. The 800 ms readout
 * gap was cancelling that sentence before it started.
 */
const CONFIRM_WAIT_MS = 2_000

const TOOL_SPOKEN = 'Already spoken to the user. Stay silent about the delegated task. If the user speaks again, answer them.'
const TOOL_CONFIRM = 'The task has started and is still running. It is not finished. Say one short sentence now, in the user\'s language, that it has started. Do not add anything else. Do not say it is finished, done, or already handled. Then stay silent. The host reads the agent reply aloud. If the user speaks again, answer them.'
const TOOL_SILENT = 'Handed to the backend agent. The work is not done yet. Stay silent now. Do not tell the user it is finished. The host reads the agent reply aloud. If the user speaks again, answer them.'
const TOOL_REPEAT = 'Already handed to the backend agent. Stay silent. Do not call delegate_task again until the user speaks a new request.'
const TOOL_INTERRUPTED = 'The user interrupted. Answer what they say. Do not answer the delegated task.'
const TOOL_UNAVAILABLE = 'This tool is not available.'

/**
 * Seeduplex call decisions with no socket.
 * Doubao talks normally. It calls `delegate_task` without a confirmation.
 * The tool result asks for one short sentence that the work has started,
 * then silence. The host reads each finished agent text block after that
 * sentence, and after any of its audio still in the speakers.
 * Only the user's voice interrupts.
 */
export class DoubaoCallController {
  private live = false
  private closed = false
  private retried = false
  private dialogId = ''
  private hostTurn: 'none' | 'summary' = 'none'
  private playing = false
  private ttsHost = false
  private dropModel = false
  private muteModel = false
  private suppressFollowup = false
  /** The reply already playing may finish. The next model utterance stays hidden. */
  private suppressAfterAck = false
  /** The tool result asked for one confirmation. Do not mute or cancel it. */
  private confirmDue = false
  /** When that wait is given up so the host can read. */
  private confirmUntil = 0
  private modelItemOpen = false
  /** Doubao is still saying the handoff. Agent blocks wait behind it. */
  private modelWindow = false
  /** Tool result asked Doubao to invent the handoff, so the next audio is that sentence. */
  private ackPrompted = false
  /** `response.done` for the handoff arrived before any of its audio. */
  private ackUsageSeen = false
  private modelAudioSeen = false
  /** Trailing audio of an utterance the user already interrupted. */
  private ignorePlayback = false
  /**
   * Host PCM may still be in the speakers after the server finishes sending it.
   * The next host sentence appends. Clearing the queue there cuts the first sentence.
   */
  private hostAudioQueued = false
  /** Host PCM accepted for playback, and when that stretch started. 24 kHz s16le. */
  private hostHeardBytes = 0
  private hostHeardAt = 0
  /** Model PCM still in the speakers after the server finishes sending it. */
  private modelHeardBytes = 0
  private modelHeardAt = 0
  /**
   * When a held readout may start if the model never speaks.
   * 0 means it is not waiting on that quiet gap.
   */
  private voiceQuietAt = 0
  /** The next `chat_tts_text` start is a commit that was cancelled before it played. */
  private suppressNextStart = false
  /** The next audio end still belongs to the cancelled utterance, not the one just accepted. */
  private staleEnd = false
  /** `response.canceled` already arrived, so the next start is not racing an old end. */
  private cancelSettled = false
  /** The user spoke again. Doubao answers before the host reads a queued block. */
  private holdReport = false
  /** Audio of that answer has started, so its end may release the report. */
  private replyAudioSeen = false
  /** A model utterance is open. Host speech waits so it does not cancel that turn. */
  private modelUtteranceOpen = false
  /**
   * A host sentence is in flight, or a later block is already queued behind it.
   * Cleared when that sentence ends and the queue is empty, even if the agent
   * is still working. An interrupt while this is set drops the rest of the readout.
   */
  private readoutOpen = false
  private userSpeaking = false
  /** When this mic open started. A wordless open is a blip only after {@link WORDLESS_MIC_MS}. */
  private userSpeakingAt = 0
  /** `asr-info` or a hypothesis opened the current user item. The next hypothesis must not extend a finished line. */
  private userTurnOpen = false
  private toolReleased = false
  private pendingSpeech: string[] = []
  private spokeAny = false
  private awaitingSummary = false
  private pendingCalls: DoubaoFunctionCall[] = []
  private userItem = 0
  private assistantItem = 0
  /** Unique per call. Reusing doubao-user-1 on the next call would overwrite the saved transcript. */
  private readonly itemNonce = globalThis.crypto.randomUUID()
  private userText = ''
  private assistantText = ''
  /** Model text before stage directions are removed. The transcript stores {@link assistantText}. */
  private assistantRaw = ''
  /** The rest of this model utterance is a spoken aside. Drop its audio. Do not cancel the turn. */
  private skipModelAsideAudio = false
  /** Spoken lines since this call started. A delegation sends only the lines not yet handed off. */
  private voiceLines: RealtimeTranscriptLine[] = []
  /** First voiceLines index that has not been put in a delegation envelope. */
  private voiceSent = 0
  /** Set once this call has told the coding agent that voice is open. */
  private voiceOpened = false
  /** Last user words actually handed off. Another call before the user speaks is not a new task. */
  private lastDelegatedTask = ''
  /**
   * Prior pairs for a new dialog. Sent once, after the first session.created.
   * A retry already passed session.id, so the server still has those rounds.
   */
  private historyEvent: Record<string, unknown> | null
  private readonly speaker: string | undefined
  private readonly now: () => number

  constructor(options: { speaker?: string; now?: () => number; history?: readonly DoubaoHistoryLine[] } = {}) {
    this.speaker = options.speaker
    this.now = options.now ?? (() => Date.now())
    this.historyEvent = historyItemsEvent(options.history ?? [])
  }

  get sessionId(): string { return this.dialogId }

  /** True from the handoff until the agent turn goes idle or the user barges in. */
  wantsSummary(): boolean {
    return this.awaitingSummary && !this.closed
  }

  /** True while assistant audio is accepted, or PCM is still in the speakers. */
  isSpeaking(): boolean {
    return !this.closed && (this.playing || this.hostStillAudible() || this.modelStillAudible())
  }

  /**
   * Speak a queued block once the voice model has finished, including audio
   * still in the speakers. The uplink pacer calls this; no socket event fires
   * when that tail ends.
   */
  pump(): DoubaoCallCommand[] {
    if (this.closed || !this.live) return []
    return this.flushSummary()
  }

  /**
   * The microphone heard the user over playback. Stop that audio now.
   * Server transcription can arrive later; this does not wait for it.
   * Host audio can still be playing after the server has finished sending it.
   */
  barge(): DoubaoCallCommand[] {
    if (this.closed) return []
    const modelTail = !this.playing && this.modelStillAudible() && !this.hostStillAudible()
    if (!this.playing && !this.hostStillAudible() && !this.modelStillAudible()) return []
    // This is a new turn. The previous line is already stored.
    this.userSpeaking = true
    this.userSpeakingAt = this.now()
    this.userText = ''
    if (this.playing) return this.interruptPlayback()
    if (modelTail) return this.dropModelTail()
    // The server already finished. A 600 ms barge ends the readout.
    // A transcription start does not: speaker echo is shorter than that.
    const commands = this.dropAudibleTail()
    this.allowConversation()
    return commands
  }

  open(): DoubaoCallCommand[] {
    if (this.closed) return []
    return [{ type: 'send', event: buildDoubaoStartSession({
      ...(this.speaker ? { speaker: this.speaker } : {}),
      ...(this.dialogId ? { dialogId: this.dialogId } : {}),
    }) }]
  }

  stop(): DoubaoCallCommand[] {
    if (this.closed) return []
    this.closed = true
    this.awaitingSummary = false
    return this.live
      ? [{ type: 'send', event: sessionClose() }]
      : [{ type: 'hangup', reason: 'stopped' }]
  }

  mute(muted: boolean): DoubaoCallCommand[] {
    if (!this.live || this.closed) return []
    return [{ type: 'send', event: inputAudioMute(muted) }]
  }

  /**
   * Show one closed block in the voice transcript.
   * `spoken` is the prose TTS reads. It is empty for a table, a code block, or an image.
   * When omitted, the whole block is spoken.
   */
  queueSummary(display: string, spoken: string = display): DoubaoCallCommand[] {
    const shown = display.trim()
    if (!shown || !this.awaitingSummary || this.closed) return []
    const say = spoken.trim()
    if (say) this.pendingSpeech.push(say)
    // Shown text counts even when there is nothing to say, so idle does not add 做完了.
    this.spokeAny = true
    this.rememberVoice('assistant', shown)
    this.assistantItem += 1
    // The voice transcript shows the block as soon as it closes. Speech can wait.
    const visible: DoubaoCallCommand = {
      type: 'transcript',
      phase: 'completed',
      role: 'assistant',
      itemId: this.assistantId(),
      text: shown,
    }
    return [visible, ...this.flushSummary()]
  }

  /** The agent turn ended. Speak a short fallback only when nothing else was readable. */
  noteIdleWithoutSummary(): DoubaoCallCommand[] {
    if (!this.awaitingSummary || this.closed) return []
    const commands: DoubaoCallCommand[] = []
    // Model audio that never sends output_audio.done would leave `playing` set and skip every block.
    // A real utterance already barged in; leave that audio decision to the barge path.
    // Doubao's answer to a follow-up is not stuck handoff audio.
    if (this.playing && this.hostTurn !== 'summary' && !this.replyAudioSeen && !(this.userSpeaking && this.userText.trim())) {
      this.playing = false
      this.ttsHost = false
      this.modelUtteranceOpen = false
      commands.push({ type: 'drop-playback' })
    } else if (this.modelUtteranceOpen && this.hostTurn !== 'summary' && !this.replyAudioSeen && !(this.userSpeaking && this.userText.trim())) {
      this.modelUtteranceOpen = false
    }
    if (this.modelWindow && !this.playing) {
      commands.push(...this.completeIdleTranscript(), ...this.dismissModelWindow())
    }
    this.releaseWordlessMic()
    if (!this.spokeAny && this.pendingSpeech.length === 0 && this.hostTurn !== 'summary' && !this.holdReport) {
      this.pendingSpeech.push(VOICE_FALLBACK_SPOKEN)
    }
    this.awaitingSummary = false
    // A readout leaves the model muted. Once the watch ends, the next reply must be audible.
    if (this.hostTurn === 'none' && !this.playing && !this.modelWindow) this.allowConversation()
    return [...commands, ...this.flushSummary()]
  }

  ingest(notice: DoubaoServerNotice): DoubaoCallCommand[] {
    if (this.closed) return []
    switch (notice.type) {
      case 'session-started': {
        const resumed = this.dialogId.length > 0
        this.live = true
        this.dialogId = notice.dialogId
        const commands: DoubaoCallCommand[] = []
        if (!resumed && this.historyEvent) {
          commands.push({ type: 'send', event: this.historyEvent })
          this.historyEvent = null
        }
        commands.push({ type: 'ready', dialogId: notice.dialogId }, { type: 'activity', activity: 'listening' })
        return commands
      }
      case 'session-finished':
        this.live = false
        this.closed = true
        return [{ type: 'hangup', reason: 'finished' }]
      case 'asr-info':
        return this.beginUserTurn()
      case 'asr':
        return this.noteAsr(notice.text)
      case 'asr-ended':
        return this.finishUserTurn(notice.text)
      case 'asr-failed':
        this.userSpeaking = false
        this.userTurnOpen = false
        return [{ type: 'error', message: notice.message }, { type: 'activity', activity: 'listening' }, ...this.flushSummary()]
      case 'function-calls':
        return this.takeFunctionCalls(notice.calls)
      case 'tts-start':
        return this.beginPlayback(notice)
      case 'tts-audio':
        if (this.ignorePlayback) return []
        if (!this.ttsHost && this.skipModelAsideAudio) return []
        // muteModel drops the model's follow-up. The host commit that set it still plays.
        if (!this.ttsHost && this.shouldDropModelAudio()) return []
        if (this.modelWindow && !this.ttsHost) this.modelAudioSeen = true
        this.playing = true
        if (this.ttsHost) this.noteHostPcm(notice.pcm)
        else this.noteModelPcm(notice.pcm)
        return [{ type: 'play', pcm: notice.pcm }]
      case 'tts-ended':
        if (this.staleEnd && !notice.exitIntent) {
          this.staleEnd = false
          return []
        }
        return this.finishTts(notice)
      case 'error':
        return this.fail(notice.code, notice.message, notice.retryable)
      case 'chat':
        return this.noteChat(notice.content)
      case 'chat-ended':
        return this.finishModelText()
      case 'usage':
        return this.noteModelFinished()
      case 'response-canceled':
        this.cancelSettled = true
        return []
      case 'session-updated':
      case 'ignored':
        return []
      default:
        return []
    }
  }

  private beginUserTurn(): DoubaoCallCommand[] {
    this.userSpeaking = true
    this.userSpeakingAt = this.now()
    this.userTurnOpen = true
    // Server audio often finishes before the speakers do. Drop that tail even
    // when generation has already ended. Cancel only audio the server is still sending.
    // An open-mic `asr-info` must not drop a report that has not started, and must
    // not drop one whose audio is only still estimated in the speakers.
    const commands = this.playing ? this.interruptPlayback() : this.stopQueuedReadout()
    // The server has heard the user. Their reply must not be cancelled or muted.
    this.allowConversation()
    this.userItem += 1
    this.userText = ''
    commands.push(
      { type: 'activity', activity: 'user-speaking' },
      { type: 'transcript', phase: 'started', role: 'user', itemId: this.userId(), text: '' },
    )
    return commands
  }

  private noteAsr(fragment: string): DoubaoCallCommand[] {
    if (!fragment) return []
    const commands: DoubaoCallCommand[] = []
    // The previous line is already stored. A hypothesis with no asr-info is a new line.
    if (!this.userTurnOpen) commands.push(...this.beginUserTurn())
    if (!this.userItem) return commands
    const merged = mergeAsrText(this.userText, fragment)
    if (!merged) return commands
    this.userText = merged.text
    // Words from the user reopen the conversation. The queued report waits.
    if (this.hostTurn !== 'summary') this.allowConversation()
    commands.push({
      type: 'transcript',
      phase: 'delta',
      role: 'user',
      itemId: this.userId(),
      text: merged.replace ? merged.text : merged.delta,
      ...(merged.replace ? { replace: true } : {}),
    })
    return commands
  }

  private finishUserTurn(text: string): DoubaoCallCommand[] {
    this.userSpeaking = false
    this.userTurnOpen = false
    const utterance = (text || this.userText).trim()
    // Leave the line empty so the next hypothesis cannot grow this one.
    this.userText = ''
    const lastLine = this.voiceLines[this.voiceLines.length - 1]
    const echo = !!utterance && lastLine?.role === 'user' && lastLine.text === utterance
    if (utterance) this.rememberVoice('user', utterance)
    // A new request replaces the confirmation this result asked for.
    if (utterance && !echo) this.clearConfirmWait()
    if (!this.userItem) this.userItem += 1
    const itemId = this.userId()
    // A real follow-up belongs to Doubao. Reading the report here would cancel that reply.
    const commands: DoubaoCallCommand[] = [
      { type: 'transcript', phase: 'completed', role: 'user', itemId, text: utterance },
    ]
    if (utterance && this.hostTurn !== 'summary') {
      this.allowConversation()
      this.ignorePlayback = false
      this.holdReport = true
      this.disarmVoiceQuiet()
      commands.push({ type: 'activity', activity: 'thinking' })
    } else {
      commands.push(
        { type: 'activity', activity: utterance ? 'thinking' : 'listening' },
        ...this.flushSummary(),
      )
    }
    // Small talk stays on Doubao. The backend starts on the first delegate_task.
    return commands
  }

  /** Stop audio the user is talking over, and let the next reply through. */
  private interruptPlayback(): DoubaoCallCommand[] {
    const reporting = this.hostTurn === 'summary'
    const modelAck = this.modelWindow
    this.playing = false
    this.hostTurn = 'none'
    this.ttsHost = false
    this.modelItemOpen = false
    this.assistantRaw = ''
    this.skipModelAsideAudio = false
    this.hostAudioQueued = false
    this.clearHostHeard()
    this.ignorePlayback = true
    this.suppressNextStart = false
    this.staleEnd = false
    this.cancelSettled = false
    this.replyAudioSeen = false
    this.suppressFollowup = false
    this.clearConfirmWait()
    this.clearModelHeard()
    this.armVoiceQuiet(true)
    const commands: DoubaoCallCommand[] = [
      { type: 'drop-playback' },
      { type: 'send', event: responseCancel() },
    ]
    if (reporting || this.readoutOpen) {
      // The user talked over the readout. Drop this block and every block still waiting.
      this.dropReport()
      this.allowConversation()
      return commands
    }
    this.allowConversation()
    if (modelAck) {
      this.modelWindow = false
      this.ackPrompted = false
      commands.push(...this.releaseTools(TOOL_INTERRUPTED))
    }
    return commands
  }

  /**
   * The server already finished the current sentence, but more blocks may be waiting.
   * Speaking now still counts as an interrupt: do not start the next one.
   */
  private stopQueuedReadout(): DoubaoCallCommand[] {
    // Speakers can still have this sentence after the server finished it.
    // Drop that playback. Only a block already queued, or a commit in flight,
    // ends the readout. A 600 ms barge drops the audible tail. A true gap,
    // after that audio has played out, must not drop a block that is not written yet.
    const stillAudible = this.hostStillAudible()
    this.hostAudioQueued = false
    this.clearHostHeard()
    this.clearModelHeard()
    const commands: DoubaoCallCommand[] = [{ type: 'drop-playback' }]
    const cancelCommit = this.hostTurn === 'summary'
    if (!this.readoutOpen && !cancelCommit) {
      if (stillAudible) this.ignoreFinishedTail()
      return commands
    }
    this.dropReport()
    if (cancelCommit) {
      // The commit has not started. Its chat_tts_text start is still that commit.
      this.ignorePlayback = true
      this.suppressNextStart = true
      this.staleEnd = false
      this.cancelSettled = false
      commands.push({ type: 'send', event: responseCancel() })
    } else if (stillAudible) {
      this.ignoreFinishedTail()
    }
    return commands
  }

  /** Late frames of a sentence the server already finished. The next reply's end still lands. */
  private ignoreFinishedTail(): void {
    this.ignorePlayback = true
    this.cancelSettled = true
    this.staleEnd = false
    this.suppressNextStart = false
  }

  /** The user talked over model audio the server already finished. The queued report stays. */
  private dropModelTail(): DoubaoCallCommand[] {
    this.clearModelHeard()
    this.ignoreFinishedTail()
    this.allowConversation()
    this.armVoiceQuiet(true)
    return [{ type: 'drop-playback' }]
  }

  /** A barge over host audio the server already finished. The rest of that readout is dropped. */
  private dropAudibleTail(): DoubaoCallCommand[] {
    const cancelCommit = this.hostTurn === 'summary'
    this.hostAudioQueued = false
    this.clearHostHeard()
    this.clearModelHeard()
    this.dropReport()
    this.ignorePlayback = true
    this.staleEnd = false
    const commands: DoubaoCallCommand[] = [{ type: 'drop-playback' }]
    if (cancelCommit) {
      this.suppressNextStart = true
      this.cancelSettled = false
      commands.push({ type: 'send', event: responseCancel() })
    } else {
      this.suppressNextStart = false
      this.cancelSettled = true
    }
    return commands
  }

  /** An interrupt ends the host readout. Later blocks are not spoken. */
  private dropReport(): void {
    this.pendingSpeech = []
    this.awaitingSummary = false
    this.holdReport = false
    this.assistantText = ''
    this.assistantRaw = ''
    this.skipModelAsideAudio = false
    this.readoutOpen = false
    this.hostTurn = 'none'
  }

  /** The user is in the conversation again. Do not keep cancelling Doubao. */
  private allowConversation(): void {
    this.muteModel = false
    this.dropModel = false
    this.suppressFollowup = false
  }

  private takeFunctionCalls(calls: DoubaoFunctionCall[]): DoubaoCallCommand[] {
    if (!calls.some(call => call.name === VOICE_DELEGATE_TOOL)) {
      return [{ type: 'send', event: toolResultEvent(calls.map(call => ({ callId: call.callId, text: TOOL_UNAVAILABLE }))) }]
    }
    // The tool can fire before end-of-speech. Seal the line so a draft session can keep it.
    // The model does not write the task. The first delegate opens the backend session.
    const sealed = this.sealOpenUserLine()
    const transcript = this.pendingDelegationLines()
    // No new user speech. The model restated the request, or the first line was already sent.
    if (!transcript.some(line => line.role === 'user')) {
      this.pendingCalls = calls
      this.toolReleased = false
      return [
        ...sealed,
        ...this.releaseTools(this.voiceOpened ? TOOL_REPEAT : TOOL_SILENT),
        { type: 'activity', activity: this.awaitingSummary ? 'thinking' : 'listening' },
      ]
    }
    this.pendingCalls = calls
    this.toolReleased = false
    return [
      ...sealed,
      ...this.releaseTools(TOOL_CONFIRM),
      ...this.handOff(this.voiceOpened ? 'turn' : 'opening', transcript),
      { type: 'activity', activity: 'thinking' },
    ]
  }

  /** A tool call arrived while the user line was still open. Finish that item once. */
  private sealOpenUserLine(): DoubaoCallCommand[] {
    if (!this.userTurnOpen || !this.userText.trim()) return []
    return this.finishUserTurn(this.userText).filter(command => (
      command.type === 'transcript' || command.type === 'delegate' || command.type === 'activity'
    ))
  }

  /**
   * Send the user's words. The first delegate of a call tells the coding agent
   * that a voice session started. A sentence already playing stays.
   */
  private handOff(
    kind: 'opening' | 'turn',
    transcript: readonly RealtimeTranscriptLine[],
  ): DoubaoCallCommand[] {
    const utterance = transcript.filter(line => line.role === 'user').map(line => line.text).join('\n')
    const continuing = kind === 'turn' && this.awaitingSummary
    this.voiceOpened = true
    this.voiceSent = this.voiceLines.length
    this.lastDelegatedTask = utterance
    // The start sentence may still be on its way. Do not free the readout while
    // that audio is open or still in the speakers. A quiet gap releases it.
    if (!this.playing && !this.modelUtteranceOpen && !this.modelStillAudible()) this.armVoiceQuiet()
    this.awaitingSummary = true
    if (!continuing) {
      this.pendingSpeech = []
      this.spokeAny = false
      this.readoutOpen = false
    }
    return [{ type: 'delegate', kind, utterance, continuing, transcript: [...transcript] }]
  }

  private rememberVoice(role: 'user' | 'assistant', text: string): void {
    const spoken = text.trim()
    if (!spoken) return
    const last = this.voiceLines[this.voiceLines.length - 1]
    if (last && last.role === role && last.text === spoken) return
    this.voiceLines.push({ role, text: spoken })
  }

  /**
   * Spoken lines since the previous handoff.
   * The cursor stays put until the caller actually sends them. A later 4 KiB cap
   * may keep only the newest of this slice; those dropped lines are not retried.
   */
  private pendingDelegationLines(): RealtimeTranscriptLine[] {
    const pending = this.userText.trim()
    const last = this.voiceLines[this.voiceLines.length - 1]
    if (pending && !(last?.role === 'user' && last.text === pending)) this.rememberVoice('user', pending)
    return this.voiceLines.slice(this.voiceSent)
  }

  /**
   * A cancel drops the rest of the current utterance. The next start is the reply,
   * unless it is the host commit that was cancelled before any audio.
   * Waiting for that utterance's end used to swallow every later reply.
   */
  private beginPlayback(notice: Extract<DoubaoServerNotice, { type: 'tts-start' }>): DoubaoCallCommand[] {
    if (this.suppressNextStart && notice.ttsType === 'chat_tts_text') {
      this.suppressNextStart = false
      return []
    }
    const cancelled = this.ignorePlayback
    this.ignorePlayback = false
    this.suppressNextStart = false
    this.staleEnd = cancelled && !this.cancelSettled
    this.cancelSettled = false
    const commands = this.beginSpeech(notice)
    if (commands.length === 0) this.staleEnd = false
    return commands
  }

  private beginSpeech(notice: Extract<DoubaoServerNotice, { type: 'tts-start' }>): DoubaoCallCommand[] {
    // A commit's audio is chat_tts_text. If that label is missing, audio that follows our own commit is still the host line.
    const hostSpeech = notice.ttsType === 'chat_tts_text' || (!notice.ttsType && this.hostTurn === 'summary')
    // This is the sentence the tool result just asked for. Do not hide it.
    if (!hostSpeech && this.confirmDue) {
      this.clearConfirmWait()
      this.suppressFollowup = false
      this.muteModel = false
      this.dropModel = false
      this.suppressAfterAck = true
    }
    if (!hostSpeech && (this.muteModel || this.dropModel || this.suppressFollowup)) {
      // A host line is in flight. Do not cancel it: a cancel after commit drops that commit.
      if (this.hostTurn !== 'none' || this.playing) return []
      // The user is already in this turn. Play the reply. Cancelling it cuts them off.
      if (this.userSpeaking || this.holdReport) {
        // One spoken reply, then quiet. The host reads the agent after that.
        const ackThenQuiet = this.suppressFollowup
        this.allowConversation()
        if (ackThenQuiet) this.suppressAfterAck = true
      }
      else {
        // Automatic continuation after a silent handoff. Hide it.
        // Leaving a model utterance open would hold the agent's blocks until it ends.
        return []
      }
    }
    const handoffStarting = this.modelWindow && !this.modelAudioSeen
    if (!hostSpeech && this.modelWindow) this.modelAudioSeen = true
    // The handoff sentence is not the answer to a later question.
    if (!hostSpeech && this.holdReport && !handoffStarting) this.replyAudioSeen = true
    // This sentence is the one the readout is waiting on. Do not time it out.
    if (!hostSpeech) this.disarmVoiceQuiet()
    this.ttsHost = hostSpeech
    this.modelUtteranceOpen = true
    this.playing = true
    // Doubao's own new utterance replaces audio still queued. A later sentence of
    // the host readout appends, so the previous sentence can finish playing.
    const keepHostAudio = hostSpeech && this.hostAudioQueued
    if (!keepHostAudio) {
      this.hostAudioQueued = false
      this.clearHostHeard()
      this.clearModelHeard()
    }
    if (hostSpeech) this.hostAudioQueued = true
    const commands: DoubaoCallCommand[] = [
      ...(keepHostAudio ? [] : [{ type: 'drop-playback' as const }]),
      { type: 'activity', activity: 'assistant-speaking' },
    ]
    // Host prose is already in the transcript. A second item would repeat the block.
    if (!hostSpeech && !this.modelItemOpen && notice.text) {
      this.assistantRaw = notice.text
      const spoken = stripVoiceAsides(notice.text)
      if (spoken) {
        this.assistantItem += 1
        this.assistantText = spoken
        this.modelItemOpen = true
        commands.push({ type: 'transcript', phase: 'started', role: 'assistant', itemId: this.assistantId(), text: spoken })
      }
    }
    return commands
  }

  private noteChat(content: string): DoubaoCallCommand[] {
    if (!content || this.muteModel || this.dropModel || this.suppressFollowup) return []
    this.assistantRaw += content
    const visible = stripVoiceAsides(this.assistantRaw)
    const commands: DoubaoCallCommand[] = []
    if (!this.modelItemOpen) {
      if (!visible) return this.cutSpokenAside()
      this.assistantItem += 1
      this.assistantText = visible
      this.modelItemOpen = true
      commands.push({ type: 'transcript', phase: 'started', role: 'assistant', itemId: this.assistantId(), text: visible })
      commands.push(...this.cutSpokenAside())
      return commands
    }
    if (visible === this.assistantText) {
      commands.push(...this.cutSpokenAside())
      return commands
    }
    const previous = this.assistantText
    this.assistantText = visible
    if (visible.startsWith(previous)) {
      const delta = visible.slice(previous.length)
      if (delta) commands.push({ type: 'transcript', phase: 'delta', role: 'assistant', itemId: this.assistantId(), text: delta })
    }
    else {
      commands.push({ type: 'transcript', phase: 'delta', role: 'assistant', itemId: this.assistantId(), text: visible, replace: true })
    }
    commands.push(...this.cutSpokenAside())
    return commands
  }

  /**
   * The aside arrived after this sentence had already started playing.
   * Drop the queued tail. Do not `response.cancel`: that would cut the sentence
   * and can drop the tool call.
   */
  private cutSpokenAside(): DoubaoCallCommand[] {
    if (this.skipModelAsideAudio || this.ttsHost) return []
    if (stripVoiceAsides(this.assistantRaw) === this.assistantRaw.trim()) return []
    if (!this.playing && !this.modelStillAudible()) return []
    this.skipModelAsideAudio = true
    return [{ type: 'drop-playback' }]
  }

  private finishSpokenLine(): void {
    this.modelItemOpen = false
    this.assistantRaw = ''
    this.skipModelAsideAudio = false
  }

  private finishModelText(): DoubaoCallCommand[] {
    if (!this.modelItemOpen || this.playing) return []
    const text = this.assistantText
    this.finishSpokenLine()
    this.rememberVoice('assistant', text)
    return [{ type: 'transcript', phase: 'completed', role: 'assistant', itemId: this.assistantId(), text }]
  }

  private finishTts(notice: Extract<DoubaoServerNotice, { type: 'tts-ended' }>): DoubaoCallCommand[] {
    if (notice.exitIntent) {
      this.closed = true
      this.live = false
      return [{ type: 'hangup', reason: 'exit' }]
    }
    const hostSpeech = this.ttsHost
    const spoke = this.playing || this.modelItemOpen
    const interrupted = this.ignorePlayback
    this.modelUtteranceOpen = false
    this.ignorePlayback = false
    this.playing = false
    this.ttsHost = false
    const commands: DoubaoCallCommand[] = []
    if (spoke && this.modelItemOpen && this.assistantItem) {
      const text = this.assistantText
      this.finishSpokenLine()
      this.rememberVoice('assistant', text)
      commands.push({ type: 'transcript', phase: 'completed', role: 'assistant', itemId: this.assistantId(), text })
    } else if (!hostSpeech) {
      this.assistantRaw = ''
      this.skipModelAsideAudio = false
    }
    if (hostSpeech) {
      this.hostTurn = 'none'
      // Nothing else is queued. Talking during the rest of the agent turn must not
      // drop a block that has not been written yet. A block already queued stays latched.
      if (this.pendingSpeech.length === 0) this.readoutOpen = false
      if (!this.awaitingSummary && this.pendingSpeech.length === 0 && !this.modelWindow) this.muteModel = false
    } else if (this.modelWindow && this.modelAudioSeen) {
      // A stale end from the previous utterance must not cancel the handoff.
      commands.push(...this.dismissModelWindow())
    } else if (!interrupted && this.replyAudioSeen && !this.userSpeaking) {
      this.holdReport = false
      this.replyAudioSeen = false
      this.disarmVoiceQuiet()
      if (this.suppressAfterAck) {
        this.suppressAfterAck = false
        this.suppressFollowup = true
      }
    }
    commands.push(...this.flushSummary())
    if (this.hostTurn === 'none') {
      const busy = this.awaitingSummary || this.pendingSpeech.length > 0 || this.modelWindow
      commands.push({ type: 'activity', activity: busy ? 'thinking' : 'listening' })
    }
    return commands
  }

  private shouldDropModelAudio(): boolean {
    return this.muteModel || this.dropModel || this.suppressFollowup
  }

  /**
   * The function-call turn's `response.done` often arrives before the start sentence.
   * Do not cancel that sentence. A quiet gap, not this event, releases the readout.
   */
  private noteModelFinished(): DoubaoCallCommand[] {
    if (this.playing || this.modelUtteranceOpen || this.modelStillAudible()) return []
    if (this.holdReport && !this.modelWindow && !this.userSpeaking) {
      this.armVoiceQuiet()
      return this.flushSummary()
    }
    if (!this.modelWindow) return []
    if (!this.modelAudioSeen) {
      this.ackUsageSeen = true
      return this.flushSummary()
    }
    const commands = [...this.completeIdleTranscript(), ...this.dismissModelWindow(), ...this.flushSummary()]
    if (this.hostTurn === 'none') {
      const busy = this.awaitingSummary || this.pendingSpeech.length > 0 || this.modelWindow
      commands.push({ type: 'activity', activity: busy ? 'thinking' : 'listening' })
    }
    return commands
  }

  private completeIdleTranscript(): DoubaoCallCommand[] {
    if (this.playing || !this.modelItemOpen || !this.assistantItem) return []
    const text = this.assistantText
    this.finishSpokenLine()
    this.rememberVoice('assistant', text)
    return [{ type: 'transcript', phase: 'completed', role: 'assistant', itemId: this.assistantId(), text }]
  }

  /** Close the handoff window. A queued block is spoken by the caller. */
  private dismissModelWindow(): DoubaoCallCommand[] {
    if (!this.modelWindow) return []
    this.modelWindow = false
    this.ackPrompted = false
    // The user already asked something else. Do not cancel the answer they are waiting for.
    if (this.holdReport) {
      this.allowConversation()
      return this.releaseTools(TOOL_INTERRUPTED)
    }
    this.muteModel = true
    const commands = this.releaseTools(TOOL_SPOKEN)
    if (this.pendingSpeech.length === 0 && this.hostTurn === 'none' && !this.playing) this.suppressFollowup = true
    // One cancel frees the model from the task answer. Later user turns are not cancelled.
    if (!this.userSpeaking && !this.holdReport && this.hostTurn === 'none' && !this.playing) {
      commands.push({ type: 'send', event: responseCancel() })
    }
    return commands
  }

  /** The confirmation wait is over. A late sentence must not hold the readout. */
  private clearConfirmWait(): void {
    this.confirmDue = false
    this.confirmUntil = 0
  }

  /** Return the tool result. The confirmation it requests is not muted or cancelled. */
  private releaseTools(spokenText: string): DoubaoCallCommand[] {
    if (this.toolReleased || this.pendingCalls.length === 0) return []
    const calls = this.pendingCalls
    this.pendingCalls = []
    this.toolReleased = true
    if (spokenText === TOOL_CONFIRM && this.hostTurn === 'none') {
      // Audio already in flight can finish. Otherwise the sentence still has
      // to be generated, so do not treat the channel as idle.
      if (this.playing || this.modelUtteranceOpen || this.modelStillAudible() || this.modelWindow) this.suppressAfterAck = true
      else {
        this.confirmDue = true
        this.confirmUntil = this.now() + CONFIRM_WAIT_MS
      }
    } else if (
      (spokenText === TOOL_SPOKEN || spokenText === TOOL_SILENT || spokenText === TOOL_REPEAT)
      && this.hostTurn === 'none'
    ) {
      if (this.playing || this.modelWindow) this.suppressAfterAck = true
      else this.suppressFollowup = true
    }
    return [{ type: 'send', event: toolResultEvent(calls.map(call => ({
      callId: call.callId,
      text: call.name === VOICE_DELEGATE_TOOL ? spokenText : TOOL_UNAVAILABLE,
    }))) }]
  }

  private flushSummary(): DoubaoCallCommand[] {
    const prelude = this.pendingSpeech.length > 0 ? this.releaseSilentHandoff() : []
    if (this.closed || !this.live) return prelude
    // A mic start with no words used to hold every block until the agent turn idled.
    // Releasing it in the same instant cancels the turn the user just opened.
    // Real words still wait, so a follow-up is answered before the report.
    this.releaseWordlessMic()
    if (
      this.playing || this.hostTurn !== 'none' || this.userSpeaking || this.modelWindow
      || this.modelUtteranceOpen || this.modelStillAudible()
    ) return prelude
    // The confirmation has not started. Reading now sends response.cancel and drops it.
    if (this.confirmDue && this.now() < this.confirmUntil) return prelude
    if (this.confirmDue) {
      this.clearConfirmWait()
      this.suppressFollowup = true
    }
    this.releaseQuietHold()
    if (this.holdReport) return prelude
    const text = this.pendingSpeech.shift()
    if (!text) return prelude
    this.spokeAny = true
    this.muteModel = true
    this.dropModel = false
    this.hostTurn = 'summary'
    this.suppressFollowup = false
    this.assistantText = text
    this.assistantRaw = ''
    this.skipModelAsideAudio = false
    this.modelItemOpen = false
    this.readoutOpen = true
    return [
      ...prelude,
      { type: 'send', event: responseCancel() },
      { type: 'send', event: speechTextCommit(text) },
    ]
  }

  /** The start sentence never came. The agent's block may be read. */
  private releaseQuietHold(): void {
    if (!this.holdReport) return
    if (this.voiceQuietAt === 0 || this.now() < this.voiceQuietAt) return
    this.holdReport = false
    this.replyAudioSeen = false
    this.voiceQuietAt = 0
  }

  /** A wordless mic open is a blip once it has lasted long enough. Real words still hold. */
  private releaseWordlessMic(): void {
    if (!this.userSpeaking || this.userText.trim() || this.hostTurn === 'summary') return
    if (this.now() - this.userSpeakingAt < WORDLESS_MIC_MS) return
    this.userSpeaking = false
  }

  /** A prompted handoff that already ended with no audio must not hold the agent's blocks. */
  private releaseSilentHandoff(): DoubaoCallCommand[] {
    if (!this.modelWindow || !this.ackPrompted || !this.ackUsageSeen || this.modelAudioSeen) return []
    if (this.playing || this.hostTurn !== 'none') return []
    return [...this.completeIdleTranscript(), ...this.dismissModelWindow()]
  }

  private fail(code: string | undefined, message: string, retryable: boolean): DoubaoCallCommand[] {
    if (code === IDLE_END) {
      this.closed = true
      this.live = false
      return [{ type: 'hangup', reason: 'idle' }]
    }
    if (retryable && !this.retried && this.live) {
      this.retried = true
      this.live = false
      return [{ type: 'retry' }]
    }
    this.closed = true
    this.live = false
    return [{ type: 'error', message }, { type: 'hangup', reason: 'error' }]
  }

  /** Arm the quiet gap. `reset` restarts it after the user barges in. */
  private armVoiceQuiet(reset = false): void {
    if (!reset && this.voiceQuietAt !== 0) return
    this.voiceQuietAt = this.now() + VOICE_QUIET_MS
  }

  private disarmVoiceQuiet(): void {
    this.voiceQuietAt = 0
  }

  /** Unplayed host audio. A later chunk extends the same stretch; a finished one starts over. */
  private noteHostPcm(pcm: Uint8Array): void {
    if (pcm.byteLength === 0) return
    if (!this.hostStillAudible()) {
      this.hostHeardBytes = 0
      this.hostHeardAt = this.now()
    }
    this.hostHeardBytes += pcm.byteLength
  }

  private hostStillAudible(): boolean {
    if (this.hostHeardBytes <= 0) return false
    const durationMs = (this.hostHeardBytes / 2 / HOST_PCM_RATE) * 1000
    return this.now() - this.hostHeardAt < durationMs
  }

  private clearHostHeard(): void {
    this.hostHeardBytes = 0
    this.hostHeardAt = 0
  }

  /** Model PCM. Sub-millisecond clips are not a tail the readout has to wait on. */
  private noteModelPcm(pcm: Uint8Array): void {
    if (pcm.byteLength === 0) return
    if (!this.modelStillAudible()) {
      this.modelHeardBytes = 0
      this.modelHeardAt = this.now()
    }
    this.modelHeardBytes += pcm.byteLength
  }

  private modelStillAudible(): boolean {
    if (this.modelHeardBytes <= 0) return false
    const durationMs = Math.floor((this.modelHeardBytes / 2 / HOST_PCM_RATE) * 1000)
    if (durationMs <= 0) return false
    return this.now() - this.modelHeardAt < durationMs
  }

  private clearModelHeard(): void {
    this.modelHeardBytes = 0
    this.modelHeardAt = 0
  }

  private userId(): string { return `doubao-${this.itemNonce}-user-${this.userItem}` }
  private assistantId(): string { return `doubao-${this.itemNonce}-assistant-${this.assistantItem}` }
}
