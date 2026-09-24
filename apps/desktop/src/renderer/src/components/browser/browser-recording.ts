import { browserTabCanvas, useBrowserStore } from '@/stores/browser'
import { browserCapture } from './browser-host-api'
import { decodeCaptureImage } from './browser-canvas'
import { CaptureBudget, nextPaint } from './browser-capture-budget'

// Video, not stills: this bounds the canvas the MediaRecorder encodes at 2 Mbps,
// so it answers to bitrate rather than to the agent's context budget. Screenshots
// go through fitScreenshotWidth instead.
const MAX_RECORDING_WIDTH = 1280
const RECORDING_FRAME_INTERVAL_MS = 100
const RECORDING_MAX_MS = 60_000
/** Bounds starting (first frame) and finishing (last frame + encode) a recording. */
const RECORDING_STEP_BUDGET_MS = 8_000
/** One frame of the running recording; a slower frame is dropped, not waited for. */
const RECORDING_FRAME_BUDGET_MS = 3_000

interface ActiveBrowserRecording {
  id: string
  tabId: string
  startedAt: number
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  recorder: MediaRecorder
  chunks: Blob[]
  stopped: Promise<void>
  timer: ReturnType<typeof setInterval>
  maxTimer: ReturnType<typeof setTimeout>
  frameInFlight: boolean
  captureReleased: boolean
}

const activeRecordings = new Map<string, ActiveBrowserRecording>()

function recordingMimeType(): string {
  for (const mimeType of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType
  }
  throw new Error('This Chromium build cannot encode WebM action recordings')
}

async function paintRecordingFrame(recording: ActiveBrowserRecording, budget: CaptureBudget): Promise<void> {
  if (recording.frameInFlight || recording.recorder.state === 'inactive') return
  recording.frameInFlight = true
  try {
    let frame = await budget.stage('capture', browserCapture(recording.tabId))
    if (!frame || frame.isEmpty()) return
    if (frame.getSize().width > MAX_RECORDING_WIDTH) frame = frame.resize({ width: MAX_RECORDING_WIDTH })
    const size = frame.getSize()
    if (recording.canvas.width !== size.width || recording.canvas.height !== size.height) {
      recording.canvas.width = size.width
      recording.canvas.height = size.height
    }
    const image = await budget.stage('encode', decodeCaptureImage(frame.toDataURL()))
    recording.context.fillStyle = browserTabCanvas(recording.tabId)
    recording.context.fillRect(0, 0, recording.canvas.width, recording.canvas.height)
    recording.context.drawImage(image, 0, 0, recording.canvas.width, recording.canvas.height)
  } finally {
    recording.frameInFlight = false
  }
}

function releaseRecordingCapture(recording: ActiveBrowserRecording): void {
  if (recording.captureReleased) return
  recording.captureReleased = true
  useBrowserStore.getState().endCapture(recording.tabId)
}

export async function startBrowserRecording(tabId: string, signal?: AbortSignal): Promise<{ recordingId: string; tab: string }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable')
  if ([...activeRecordings.values()].some((recording) => recording.tabId === tabId)) {
    throw new Error('This browser tab is already recording')
  }

  const budget = new CaptureBudget('Recording', RECORDING_STEP_BUDGET_MS, signal)
  const store = useBrowserStore.getState()
  store.beginCapture(tabId)
  try {
    await budget.stage('host-paint', nextPaint())
    const first = await budget.stage('capture', browserCapture(tabId))
    if (!first || first.isEmpty()) throw new Error('Browser recording could not capture its first frame')
    const sized = first.getSize().width > MAX_RECORDING_WIDTH
      ? first.resize({ width: MAX_RECORDING_WIDTH })
      : first
    const size = sized.getSize()
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser recording canvas is unavailable')
    const image = await budget.stage('encode', decodeCaptureImage(sized.toDataURL()))
    context.fillStyle = browserTabCanvas(tabId)
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(image, 0, 0, size.width, size.height)

    const recordingId = crypto.randomUUID()
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(canvas.captureStream(10), {
      mimeType: recordingMimeType(),
      videoBitsPerSecond: 2_000_000,
    })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.addEventListener(
        'error',
        () => reject(new Error('Browser recording encoder failed')),
        { once: true },
      )
    })
    recorder.start(250)
    let recording!: ActiveBrowserRecording
    recording = {
      id: recordingId,
      tabId,
      startedAt: Date.now(),
      canvas,
      context,
      recorder,
      chunks,
      stopped,
      // A frame that fails or times out is dropped; the video keeps the last good one.
      timer: setInterval(() => {
        void paintRecordingFrame(recording, new CaptureBudget('Recording', RECORDING_FRAME_BUDGET_MS)).catch(() => {})
      }, RECORDING_FRAME_INTERVAL_MS),
      maxTimer: setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop()
        clearInterval(recording.timer)
        releaseRecordingCapture(recording)
      }, RECORDING_MAX_MS),
      frameInFlight: false,
      captureReleased: false,
    }
    activeRecordings.set(recordingId, recording)
    return { recordingId, tab: tabId }
  } catch (error) {
    store.endCapture(tabId)
    throw error
  }
}

export async function stopBrowserRecording(
  recordingId: string,
  tabId: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string; durationMs: number; width: number; height: number }> {
  const recording = activeRecordings.get(recordingId)
  if (!recording || recording.tabId !== tabId) throw new Error('Browser recording is not active')
  activeRecordings.delete(recordingId)
  clearInterval(recording.timer)
  clearTimeout(recording.maxTimer)
  const budget = new CaptureBudget('Recording', RECORDING_STEP_BUDGET_MS, signal)
  try {
    // The closing frame is best-effort: without it the video ends on the last
    // frame the interval painted.
    await paintRecordingFrame(recording, budget).catch(() => {})
    if (recording.recorder.state !== 'inactive') recording.recorder.stop()
    await budget.stage('encode', recording.stopped)
    const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType || 'video/webm' })
    if (blob.size === 0) throw new Error('Browser recording produced an empty video')
    const dataUrl = await budget.stage('encode', new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('Failed to serialize browser recording'))
      reader.readAsDataURL(blob)
    }))
    return {
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mimeType: 'video/webm',
      durationMs: Math.max(0, Date.now() - recording.startedAt),
      width: recording.canvas.width,
      height: recording.canvas.height,
    }
  } finally {
    if (recording.recorder.state !== 'inactive') recording.recorder.stop()
    releaseRecordingCapture(recording)
  }
}
