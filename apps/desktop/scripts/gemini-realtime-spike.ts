/**
 * Live check for the Gemini Live voice socket.
 * Reads GEMINI_API_KEY from the environment and never prints it.
 * Optional GEMINI_PCM_PATH is 16 kHz mono s16le PCM. A wav file is rejected.
 *
 * Exit 0: setupComplete arrived.
 * Exit 1: the socket or the session failed.
 * Exit 2: the API key is missing.
 *
 * A tool call gets a short backend result with scheduling WHEN_IDLE.
 * The report records whether the model speaks after that. This script does not play audio.
 */
import { randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import WebSocket from 'ws'
import {
  GEMINI_LIVE_MODEL,
  GeminiFrameError,
  buildGeminiSetup,
  decodeGeminiServerFrame,
  geminiLiveSocketUrl,
  geminiRealtimeAudio,
  geminiRealtimeText,
  geminiToolResponse,
  interpretGeminiServerEvent,
  parseGeminiServerEvent,
  redactGeminiText,
  type GeminiServerNotice,
} from '@superone/shared/gemini-realtime'
import { slicePcm20ms, VOICE_UPLINK_FRAME_BYTES } from '@superone/shared/voice-delegation'

const apiKey = process.env.GEMINI_API_KEY?.trim() ?? ''
const pcmPath = process.env.GEMINI_PCM_PATH?.trim() ?? ''
const HANDSHAKE_MS = 20_000
const TURN_MS = 25_000
const TOOL_RESULT = '当前目录有 README.md 和 package.json。'

if (!apiKey) {
  console.error('Set GEMINI_API_KEY. It is not printed.')
  process.exit(2)
}

interface Report {
  model: string
  input: 'pcm' | 'text'
  setupComplete: boolean
  inputTranscript: string
  outputTranscript: string
  outputAudioBytes: number
  toolCalls: string[]
  toolResponseSent: boolean
  scheduling: 'WHEN_IDLE'
  spokenAfterTool: string
  audioAfterToolBytes: number
  notices: string[]
  handshake?: { status: number; message: string }
  failure?: string
}

const report: Report = {
  model: GEMINI_LIVE_MODEL,
  input: pcmPath ? 'pcm' : 'text',
  setupComplete: false,
  inputTranscript: '',
  outputTranscript: '',
  outputAudioBytes: 0,
  toolCalls: [],
  toolResponseSent: false,
  scheduling: 'WHEN_IDLE',
  spokenAfterTool: '',
  audioAfterToolBytes: 0,
  notices: [],
}

let finished = false
let explaining = false
let inputSent = false
const socketUrl = geminiLiveSocketUrl(apiKey)

function status(line: string): void {
  process.stderr.write(`${redactGeminiText(line, apiKey)}\n`)
}

function fail(message: string): void {
  if (finished) return
  finished = true
  report.failure = redactGeminiText(message, apiKey)
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
}

function succeed(): void {
  if (finished) return
  finished = true
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

function loadPcm(): Uint8Array {
  const bytes = readFileSync(pcmPath)
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
    throw new GeminiFrameError('GEMINI_PCM_PATH must be raw PCM, not wav.')
  }
  return new Uint8Array(bytes)
}

status(pcmPath ? 'Gemini Live: connecting with PCM.' : 'Gemini Live: connecting.')
const ws = new WebSocket(socketUrl, { handshakeTimeout: 15_000 })
let sendChain = Promise.resolve()

function sendEvent(event: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(event)
  const run = sendChain.then(() => new Promise<void>((resolve, reject) => {
    ws.send(text, (error) => error ? reject(error) : resolve())
  }))
  sendChain = run.then(() => undefined, () => undefined)
  return run
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sendInput(): Promise<void> {
  if (inputSent || finished) return
  inputSent = true
  if (!pcmPath) {
    status('Sending one text turn.')
    await sendEvent(geminiRealtimeText('帮我看一下当前目录'))
    return
  }
  const { frames, remainder } = slicePcm20ms(loadPcm())
  const chunks = remainder.length === 0 ? frames : [...frames, pad(remainder)]
  status(`Sending ${chunks.length} audio frames.`)
  for (const frame of chunks) {
    if (finished || ws.readyState !== WebSocket.OPEN) return
    await sendEvent(geminiRealtimeAudio(frame))
    await delay(20)
  }
}

function pad(remainder: Uint8Array): Uint8Array {
  const frame = new Uint8Array(VOICE_UPLINK_FRAME_BYTES)
  frame.set(remainder)
  return frame
}

ws.on('error', (error) => {
  if (report.setupComplete) {
    fail(error.message)
    return
  }
  explaining = true
  void explainHandshake(error.message)
})

ws.on('close', () => {
  if (!finished && !explaining) fail('Gemini socket closed.')
})

if (typeof process.versions.bun !== 'string') {
  ws.on('unexpected-response', (_request, response) => {
    explaining = true
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => {
      rejectHandshake(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'))
    })
  })
}

function rejectHandshake(statusCode: number, body: string): void {
  const message = redactGeminiText(body.trim().slice(0, 300), apiKey)
  report.handshake = { status: statusCode, message }
  fail(`Gemini rejected the handshake (${statusCode}): ${message}`)
}

async function explainHandshake(fallback: string): Promise<void> {
  if (finished) return
  try {
    const response = await fetch(socketUrl.replace(/^wss:/, 'https:'), {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      },
    })
    rejectHandshake(response.status, await response.text())
  } catch {
    fail(fallback)
  }
}

ws.on('open', () => {
  void sendEvent(buildGeminiSetup()).catch((error: unknown) => fail(error instanceof Error ? error.message : 'send failed'))
})

const handshakeTimer = setTimeout(() => {
  if (!report.setupComplete) fail('Gemini setup timed out.')
}, HANDSHAKE_MS)

ws.on('message', (data, isBinary) => {
  try {
    const text = typeof data === 'string' && !isBinary
      ? data
      : decodeGeminiServerFrame(Buffer.isBuffer(data) ? data : Buffer.from(data))
    const notices = interpretGeminiServerEvent(parseGeminiServerEvent(text))
    for (const notice of notices) report.notices.push(notice.type)
    void handle(notices).catch((error: unknown) => fail(error instanceof Error ? error.message : 'handle failed'))
  } catch (error) {
    fail(error instanceof Error ? error.message : 'frame failed')
  }
})

async function handle(notices: GeminiServerNotice[]): Promise<void> {
  for (const notice of notices) {
    if (notice.type === 'setup-complete') {
      report.setupComplete = true
      clearTimeout(handshakeTimer)
      status('Setup complete.')
      await sendInput()
      continue
    }
    if (notice.type === 'input-transcript') report.inputTranscript += notice.text
    if (notice.type === 'output-transcript') {
      report.outputTranscript += notice.text
      if (report.toolResponseSent) report.spokenAfterTool += notice.text
    }
    if (notice.type === 'audio') {
      if (report.toolResponseSent) report.audioAfterToolBytes += notice.pcm.byteLength
      else report.outputAudioBytes += notice.pcm.byteLength
    }
    if (notice.type === 'tool-call' && !report.toolResponseSent) {
      report.toolCalls.push(...notice.calls.map(call => call.name))
      status(`Tool call: ${notice.calls.map(call => call.name).join(', ')}.`)
      await sendEvent(geminiToolResponse(notice.calls.map(call => ({ id: call.id, name: call.name, result: TOOL_RESULT }))))
      report.toolResponseSent = true
    }
    if (notice.type === 'error') fail(notice.message)
    if (notice.type === 'turn-complete' && inputSent) status('Turn complete.')
  }
  if (inputSent) armQuiet()
}

let quiet: ReturnType<typeof setTimeout> | undefined
function armQuiet(): void {
  clearTimeout(quiet)
  quiet = setTimeout(succeed, report.toolResponseSent ? 12_000 : 4_000)
}

setTimeout(() => {
  if (report.setupComplete) succeed()
  else fail('Gemini setup timed out.')
}, HANDSHAKE_MS + TURN_MS)
