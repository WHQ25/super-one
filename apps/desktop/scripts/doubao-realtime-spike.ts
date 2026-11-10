/**
 * Live check for the Doubao Seeduplex voice shell.
 * Reads DOUBAO_API_KEY from the environment and never prints it.
 * Optional DOUBAO_PCM_PATH is 16 kHz mono s16le PCM. A wav file is rejected.
 *
 * Exit 0: requested checks passed. Handshake-only still prints speechChecks skipped.
 * With PCM, the check cancels Doubao, speaks the acknowledgement, then talks over that audio.
 * It passes when a new transcription starts and the unsent summary commit stays unsent.
 * Exit 1: the socket, the session, or the speech checks failed.
 * Exit 2: the API key is missing.
 */
import { randomBytes, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import WebSocket from 'ws'
import {
  DOUBAO_ACK_TEXT,
  DOUBAO_REALTIME_URL,
  DoubaoFrameError,
  type DoubaoServerNotice,
  buildDoubaoStartSession,
  doubaoConnectionHeaders,
  encodeSeeduplexEvent,
  inputAudioAppend,
  interpretDoubaoServerEvent,
  parseSeeduplexEvent,
  readDoubaoHandshakeFailure,
  redactDoubaoText,
  responseCancel,
  sessionClose,
  speechTextCommit,
} from '@superone/shared/doubao-realtime'
import { slicePcm20ms, VOICE_UPLINK_FRAME_BYTES } from '@superone/shared/voice-delegation'

const apiKey = process.env.DOUBAO_API_KEY?.trim() ?? ''
const pcmPath = process.env.DOUBAO_PCM_PATH?.trim() ?? ''

if (!apiKey) {
  console.error('Set DOUBAO_API_KEY. It is not printed.')
  process.exit(2)
}

interface Report {
  logid?: string
  dialogId?: string
  events: string[]
  ttsBeforeAck: string[]
  ackAudioBytes: number
  defaultAudioBytes: number
  secondAudioBytes: number
  speechChecks: 'skipped' | 'passed' | 'failed'
  speechMethod?: 'commit'
  bargeIn: 'waiting' | 'seen'
  commitDropped: boolean
  summarySent: boolean
  audioAfterCancel: number
  ignoredEvents: string[]
  serverErrors: string[]
  chatText: string
  ttsTurns: Array<{ phase: string; ttsType?: string; text?: string }>
  handshake?: { status: number; code?: string; message: string; logid?: string }
  failure?: string
}

const report: Report = {
  events: [],
  ttsBeforeAck: [],
  ackAudioBytes: 0,
  defaultAudioBytes: 0,
  secondAudioBytes: 0,
  speechChecks: pcmPath ? 'failed' : 'skipped',
  bargeIn: 'waiting',
  commitDropped: false,
  summarySent: false,
  audioAfterCancel: 0,
  ignoredEvents: [],
  serverErrors: [],
  chatText: '',
  ttsTurns: [],
  ...(pcmPath ? { speechMethod: 'commit' as const } : {}),
}

function status(line: string): void {
  process.stderr.write(`${line}\n`)
}
/** idle → ack (host speech, with an unsent summary waiting) → done after barge-in. */
let speak: 'idle' | 'ack' | 'done' = 'idle'
let currentTts = ''
let uplinkGeneration = 0
let utterance = new Uint8Array()
let overlapStarted = false
let playbackCancelled = false
let finished = false
let explaining = false

function note(notice: DoubaoServerNotice): void {
  report.events.push(notice.type)
}

function fail(message: string): void {
  if (finished) return
  finished = true
  report.failure = redactDoubaoText(message)
  if (pcmPath) report.speechChecks = 'failed'
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
}

function succeed(): void {
  if (finished) return
  finished = true
  if (pcmPath) {
    const hostAck = report.ttsTurns.some((turn) => turn.phase === 'ack' && turn.ttsType === 'chat_tts_text')
    report.speechChecks = report.defaultAudioBytes === 0 && hostAck && report.ackAudioBytes > 0 && report.bargeIn === 'seen' && report.commitDropped && !report.summarySent
      ? 'passed'
      : 'failed'
    if (report.speechChecks === 'failed' && !report.failure) {
      report.failure = report.serverErrors[0]
        ?? (report.defaultAudioBytes > 0
          ? 'Doubao still played its own default audio.'
          : report.bargeIn !== 'seen'
            ? 'Talking over the acknowledgement did not start a new transcription.'
            : report.summarySent
              ? 'The summary commit was sent after barge-in.'
              : 'The host acknowledgement did not produce chat_tts_text audio.')
    }
  }
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.speechChecks === 'failed' ? 1 : 0)
}

status(pcmPath ? 'Doubao speech check: connecting.' : 'Doubao handshake: connecting.')
const headers = doubaoConnectionHeaders({ apiKey })
const ws = new WebSocket(DOUBAO_REALTIME_URL, { headers, handshakeTimeout: 15_000 })
let sendChain = Promise.resolve()

function sendEvent(event: Record<string, unknown>): Promise<void> {
  const text = encodeSeeduplexEvent(event)
  const run = sendChain.then(() => new Promise<void>((resolve, reject) => {
    ws.send(text, (error) => error ? reject(error) : resolve())
  }))
  sendChain = run.then(() => undefined, () => undefined)
  return run
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pacedFrames(pcm: Uint8Array): Uint8Array[] {
  const { frames, remainder } = slicePcm20ms(pcm)
  if (remainder.length === 0) return frames
  const padded = new Uint8Array(VOICE_UPLINK_FRAME_BYTES)
  padded.set(remainder)
  return [...frames, padded]
}

function stopUplink(): void {
  uplinkGeneration += 1
}

async function streamPcm(pcm: Uint8Array, label: string): Promise<void> {
  const generation = uplinkGeneration
  const frames = pacedFrames(pcm)
  status(`${label}: streaming ${frames.length} audio frames.`)
  let sent = 0
  for (const frame of frames) {
    if (generation !== uplinkGeneration || finished || ws.readyState !== WebSocket.OPEN) {
      status(`${label}: stopped after ${sent} frames.`)
      return
    }
    await sendEvent(inputAudioAppend(frame, randomUUID()))
    sent += 1
    if (sent % 50 === 0) status(`${label}: sent ${sent} of ${frames.length} frames.`)
    await delay(20)
  }
  if (generation === uplinkGeneration) status(`${label}: finished.`)
}

function overlapSpeech(speech: Uint8Array): Uint8Array {
  const lead = new Uint8Array(16_000 * 2 / 5)
  const pcm = new Uint8Array(lead.length + speech.length)
  pcm.set(speech, lead.length)
  return pcm
}

// Bun's ws client warns and never emits upgrade. Node still exposes X-Tt-Logid here.
if (typeof process.versions.bun !== 'string') {
  ws.on('upgrade', (response) => {
    const logid = response.headers['x-tt-logid']
    if (typeof logid === 'string') report.logid = logid
  })
}

ws.on('error', (error) => {
  if (report.events.length > 0) {
    fail(error.message)
    return
  }
  explaining = true
  void explainHandshake(error.message)
})
ws.on('close', () => { if (!finished && !explaining) fail('Doubao socket closed.') })

// Node's ws reports the rejected upgrade here. Bun hides that body behind "Expected 101".
if (typeof process.versions.bun !== 'string') {
  ws.on('unexpected-response', (_request, response) => {
    explaining = true
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => {
      const logid = typeof response.headers['x-tt-logid'] === 'string' ? response.headers['x-tt-logid'] : undefined
      const handshake = readDoubaoHandshakeFailure(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'), logid)
      rejectHandshake(handshake, `Doubao rejected the handshake (${handshake.status}).`)
    })
  })
}

function rejectHandshake(handshake: ReturnType<typeof readDoubaoHandshakeFailure>, fallback: string): void {
  report.handshake = handshake
  if (handshake.logid) report.logid = handshake.logid
  const code = handshake.code ? ` ${handshake.code}` : ''
  fail(handshake.status === 101 ? fallback : `Doubao rejected the handshake (${handshake.status}${code}): ${handshake.message}`)
}

async function explainHandshake(fallback: string): Promise<void> {
  if (finished) return
  try {
    const response = await fetch(DOUBAO_REALTIME_URL.replace(/^wss:/, 'https:'), {
      signal: AbortSignal.timeout(10_000),
      headers: {
        ...headers,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      },
    })
    rejectHandshake(
      readDoubaoHandshakeFailure(response.status, await response.text(), response.headers.get('x-tt-logid')),
      fallback,
    )
  } catch {
    fail(fallback)
  }
}

ws.on('open', () => {
  void sendEvent(buildDoubaoStartSession({ eventId: randomUUID() }))
    .catch((error: unknown) => fail(error instanceof Error ? error.message : 'send failed'))
})

ws.on('message', (data, isBinary) => {
  try {
    if (isBinary) throw new DoubaoFrameError('Doubao sent a binary frame.')
    const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : ''
    const notice = interpretDoubaoServerEvent(parseSeeduplexEvent(text))
    note(notice)
    void handle(notice).catch((error: unknown) => fail(error instanceof Error ? error.message : 'handle failed'))
  } catch (error) {
    fail(error instanceof Error ? error.message : 'frame failed')
  }
})

async function handle(notice: DoubaoServerNotice): Promise<void> {
  if (notice.type === 'session-started') {
    report.dialogId = notice.dialogId
    status(`Session started: ${notice.dialogId || '(no id)'}.`)
    if (!pcmPath) {
      status('No PCM file. Closing the session.')
      await sendEvent(sessionClose(randomUUID()))
      return
    }
    const file = readFileSync(pcmPath)
    if (file.subarray(0, 4).toString('ascii') === 'RIFF') throw new DoubaoFrameError('DOUBAO_PCM_PATH must be raw PCM, not wav.')
    utterance = new Uint8Array(file)
    const silence = new Uint8Array(16_000 * 2 * 2)
    const pcm = new Uint8Array(file.length + silence.length)
    pcm.set(file, 0)
    pcm.set(silence, file.length)
    await streamPcm(pcm, 'Utterance')
    return
  }
  if (notice.type === 'asr-info' && speak === 'ack' && !report.summarySent) {
    report.bargeIn = 'seen'
    report.commitDropped = true
    playbackCancelled = true
    stopUplink()
    status('Barge-in transcription started. Dropping the unsent summary and cancelling playback.')
    await sendEvent(responseCancel(randomUUID()))
    speak = 'done'
    await delay(1000)
    if (!finished) await sendEvent(sessionClose(randomUUID()))
    return
  }
  if (notice.type === 'asr-ended' && speak === 'idle') {
    speak = 'ack'
    stopUplink()
    status(`Transcript finished. Cancelling Doubao, then speaking the acknowledgement. The summary stays unsent. ${notice.text}`)
    await sendEvent(responseCancel(randomUUID()))
    await sendEvent(speechTextCommit(DOUBAO_ACK_TEXT, randomUUID()))
    return
  }
  if (notice.type === 'chat') {
    report.chatText += notice.content
    return
  }
  if (notice.type === 'ignored') {
    if (notice.event) report.ignoredEvents.push(notice.event)
    return
  }
  if (notice.type === 'tts-start') {
    report.ttsTurns.push({
      phase: speak,
      ...(notice.ttsType ? { ttsType: notice.ttsType } : {}),
      ...(notice.text ? { text: notice.text } : {}),
    })
    currentTts = notice.ttsType ?? ''
    status(`Audio started during ${speak}${notice.ttsType ? ` (${notice.ttsType})` : ''}${notice.text ? `: ${notice.text}` : ''}.`)
    if (speak === 'idle' && notice.ttsType) report.ttsBeforeAck.push(notice.ttsType)
    if (speak === 'ack' && notice.ttsType === 'chat_tts_text' && !overlapStarted) {
      overlapStarted = true
      status('Sending overlap speech during the acknowledgement.')
      void streamPcm(overlapSpeech(utterance), 'Overlap').catch((error: unknown) => {
        fail(error instanceof Error ? error.message : 'overlap speech failed')
      })
    }
    return
  }
  if (notice.type === 'tts-audio') {
    if (playbackCancelled) report.audioAfterCancel += notice.pcm.length
    else if (currentTts === 'chat_tts_text') report.ackAudioBytes += notice.pcm.length
    else {
      report.defaultAudioBytes += notice.pcm.length
      if (speak === 'idle') report.ttsBeforeAck.push('tts-audio')
    }
    return
  }
  if (notice.type === 'tts-ended' && notice.exitIntent) {
    fail('Doubao ended the call with status 20000002.')
    return
  }
  if (notice.type === 'tts-ended' && speak === 'ack' && currentTts !== 'chat_tts_text') {
    status(`Doubao audio ended during the acknowledgement (${currentTts || 'unknown'}, ${report.defaultAudioBytes} bytes). Waiting for host audio.`)
    return
  }
  if (notice.type === 'tts-ended' && speak === 'ack') {
    status(`Acknowledgement audio ended (${report.ackAudioBytes} bytes). Waiting for overlap transcription.`)
    return
  }
  if (notice.type === 'session-finished') {
    succeed()
    ws.close()
    return
  }
  if (notice.type === 'error' || notice.type === 'asr-failed') {
    const described = `${speak}: ${notice.type === 'error' && notice.code ? `${notice.code} ` : ''}${notice.message}`
    report.serverErrors.push(described)
    status(`Server error: ${described}`)
  }
  if ((notice.type === 'error' || notice.type === 'asr-failed') && report.bargeIn !== 'seen') fail(notice.message)
}

setTimeout(() => fail(pcmPath ? 'Doubao spike timed out before the speech checks finished.' : 'Doubao spike timed out before the handshake finished.'), pcmPath ? 90_000 : 20_000).unref()
