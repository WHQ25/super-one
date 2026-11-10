/**
 * See whether gemini-3.8-live emits interimInputTranscription while speech
 * is still being uploaded. Reads GEMINI_API_KEY from the environment and
 * never prints it. GEMINI_PCM_PATH is raw 16 kHz mono s16le PCM.
 *
 * Exit 0: setup completed and the socket returned a turn.
 * Exit 1: the socket or the session failed.
 * Exit 2: the API key or the PCM file is missing.
 */
import { readFileSync } from 'fs'
import WebSocket from 'ws'
import {
  GEMINI_LIVE_MODEL,
  GeminiFrameError,
  buildGeminiTranscribeSetup,
  decodeGeminiServerFrame,
  geminiLiveSocketUrl,
  geminiRealtimeAudio,
  parseGeminiServerEvent,
  redactGeminiText,
} from '@superone/shared/gemini-realtime'
import { slicePcm20ms, VOICE_UPLINK_FRAME_BYTES } from '@superone/shared/voice-delegation'

const apiKey = process.env.GEMINI_API_KEY?.trim() ?? ''
const pcmPath = process.env.GEMINI_PCM_PATH?.trim() ?? ''
const model = process.env.GEMINI_LIVE_MODEL?.trim() || GEMINI_LIVE_MODEL
const HANDSHAKE_MS = 20_000
const AFTER_SEND_MS = 20_000

if (!apiKey || !pcmPath) {
  console.error('Set GEMINI_API_KEY and GEMINI_PCM_PATH. Neither is printed.')
  process.exit(2)
}

interface Hit {
  atMs: number
  phase: 'during-speech' | 'during-silence' | 'after-send'
  text: string
  keys: string[]
}

const startedAt = Date.now()
const interims: Hit[] = []
const finals: Hit[] = []
const contentKeys = new Set<string>()
const messageKeys = new Set<string>()
let messages = 0
let setupComplete = false
let speechSendEndedAt: number | null = null
let sendEndedAt: number | null = null
let textParts = 0
let audioParts = 0
let finished = false
let failure = ''

function elapsed(): number {
  return Date.now() - startedAt
}

function phase(): Hit['phase'] {
  if (sendEndedAt != null) return 'after-send'
  if (speechSendEndedAt != null) return 'during-silence'
  return 'during-speech'
}

function status(line: string): void {
  process.stderr.write(`${redactGeminiText(line, apiKey)}\n`)
}

function record(kind: 'interim' | 'final', value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const recordValue = value as Record<string, unknown>
  const text = typeof recordValue.text === 'string' ? recordValue.text : ''
  const hit: Hit = { atMs: elapsed(), phase: phase(), text, keys: Object.keys(recordValue).sort() }
  const bucket = kind === 'interim' ? interims : finals
  bucket.push(hit)
  status(`+${hit.atMs}ms ${hit.phase} ${kind} keys=${hit.keys.join(',') || '-'} text=${JSON.stringify(text)}`)
}

function loadPcm(): Uint8Array {
  const bytes = readFileSync(pcmPath)
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
    throw new GeminiFrameError('GEMINI_PCM_PATH must be raw PCM, not wav.')
  }
  return new Uint8Array(bytes)
}

function pad(remainder: Uint8Array): Uint8Array {
  const frame = new Uint8Array(VOICE_UPLINK_FRAME_BYTES)
  frame.set(remainder)
  return frame
}

function finish(code: number): void {
  if (finished) return
  finished = true
  const report = {
    model,
    setupComplete,
    speechSendEndedAt,
    sendEndedAt,
    messages,
    messageKeys: [...messageKeys].sort(),
    interimCount: interims.length,
    interimDuringSpeech: interims.filter(hit => hit.phase === 'during-speech').length,
    firstInterimMs: interims[0]?.atMs ?? null,
    finalCount: finals.length,
    firstFinalMs: finals[0]?.atMs ?? null,
    textParts,
    audioParts,
    serverContentKeys: [...contentKeys].sort(),
    interims,
    finals,
    ...(failure ? { failure: redactGeminiText(failure, apiKey) } : {}),
  }
  console.log(JSON.stringify(report, null, 2))
  clearTimeout(giveUp)
  ws.close()
  process.exit(code)
}

const socketUrl = geminiLiveSocketUrl(apiKey)
status(`Gemini ${model}: connecting.`)
const ws = new WebSocket(socketUrl, { handshakeTimeout: 15_000 })
let sendChain = Promise.resolve()

function sendEvent(event: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(event)
  const run = sendChain.then(() => new Promise<void>((resolve, reject) => {
    ws.send(text, error => (error ? reject(error) : resolve()))
  }))
  sendChain = run.then(() => undefined, () => undefined)
  return run
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sendAudio(): Promise<void> {
  const { frames, remainder } = slicePcm20ms(loadPcm())
  const speech = remainder.length === 0 ? frames : [...frames, pad(remainder)]
  const silence = Array.from({ length: 50 }, () => new Uint8Array(VOICE_UPLINK_FRAME_BYTES))
  status(`Sending ${speech.length} speech frames, then 1s of silence.`)
  for (const frame of speech) {
    if (finished || ws.readyState !== WebSocket.OPEN) return
    await sendEvent(geminiRealtimeAudio(frame))
    await delay(20)
  }
  speechSendEndedAt = elapsed()
  status(`Speech upload ended at +${speechSendEndedAt}ms. Interims so far: ${interims.length}.`)
  for (const frame of silence) {
    if (finished || ws.readyState !== WebSocket.OPEN) return
    await sendEvent(geminiRealtimeAudio(frame))
    await delay(20)
  }
  sendEndedAt = elapsed()
  status(`Silence upload ended at +${sendEndedAt}ms. Interims so far: ${interims.length}. Finals so far: ${finals.length}.`)
  await sendEvent({ realtimeInput: { audioStreamEnd: true } })
  status('Sent audioStreamEnd.')
}

ws.on('error', error => {
  failure = error.message
  finish(1)
})

ws.on('close', () => {
  if (!finished) {
    failure = 'Gemini socket closed.'
    finish(1)
  }
})

ws.on('open', () => {
  const setup = model === 'gemini-3.5-transcribe-live'
    ? buildGeminiTranscribeSetup()
    : {
      setup: {
        model: `models/${model}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        inputAudioTranscription: {},
      },
    }
  void sendEvent(setup).catch((error: unknown) => {
    failure = error instanceof Error ? error.message : 'send failed'
    finish(1)
  })
})

ws.on('message', data => {
  try {
    const text = decodeGeminiServerFrame(Buffer.isBuffer(data) ? data : Buffer.from(data))
    const event = parseGeminiServerEvent(text)
    messages += 1
    for (const key of Object.keys(event)) messageKeys.add(key)
    if (messages <= 40 || !('serverContent' in event || 'server_content' in event)) {
      status(`+${elapsed()}ms message keys=${Object.keys(event).sort().join(',')}`)
    }
    if ('setupComplete' in event || 'setup_complete' in event) {
      setupComplete = true
      status(`Setup complete at +${elapsed()}ms.`)
      void sendAudio().catch((error: unknown) => {
        failure = error instanceof Error ? error.message : 'audio send failed'
        finish(1)
      })
    }
    const content = (event.serverContent ?? event.server_content) as Record<string, unknown> | undefined
    if (!content || typeof content !== 'object') return
    for (const key of Object.keys(content)) contentKeys.add(key)
    record('interim', content.interimInputTranscription ?? content.interim_input_transcription)
    record('final', content.inputTranscription ?? content.input_transcription)
    const turn = (content.modelTurn ?? content.model_turn) as { parts?: unknown[] } | undefined
    for (const part of turn?.parts ?? []) {
      if (!part || typeof part !== 'object') continue
      const fields = part as Record<string, unknown>
      if (typeof fields.text === 'string') textParts += 1
      if (fields.inlineData || fields.inline_data) audioParts += 1
    }
    if (content.turnComplete === true || content.turn_complete === true) {
      status(`Turn complete at +${elapsed()}ms.`)
      if (sendEndedAt != null) finish(0)
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'frame failed'
    finish(1)
  }
})

const giveUp = setTimeout(() => {
  if (!setupComplete) failure = 'Gemini setup timed out.'
  else if (finals.length === 0 && interims.length === 0) failure = 'No input transcription arrived.'
  finish(setupComplete && (finals.length > 0 || interims.length > 0) ? 0 : 1)
}, HANDSHAKE_MS + AFTER_SEND_MS)
