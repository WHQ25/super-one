import { browserTabCanvas, useBrowserStore } from '@/stores/browser'
import { browserCapture, browserExecJs } from './browser-host-api'
import { decodeCaptureImage, flattenBrowserCapture } from './browser-canvas'
import {
  analyzeBrowserCaptureProbe,
  BROWSER_CAPTURE_PROBE_RECT,
  type CaptureProbeAnalysis,
  INSTALL_BROWSER_CAPTURE_PROBE_SCRIPT,
  REMOVE_BROWSER_CAPTURE_PROBE_SCRIPT,
} from './browser-capture-readiness'
import { fitScreenshotWidth } from './screenshot-fit'
import { CaptureBudget, nextPaint, settleWithin } from './browser-capture-budget'

/**
 * A healthy screenshot takes 0.2–0.3s; the slowest legitimate path (both probe
 * loops running to their 1.5s deadlines, a capture retry, a large encode) stays
 * under 4s. Past that the tab is stuck and waiting longer does not help, so the
 * agent gets the stage error early enough to retry or reload.
 */
export const SCREENSHOT_BUDGET_MS = 8_000
const PROBE_READY_TIMEOUT_MS = 1_500
const PROBE_CLEANUP_TIMEOUT_MS = 1_000

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readBrowserCapturePixels(image: Electron.NativeImage): Promise<{
  data: Uint8ClampedArray
  width: number
  height: number
}> {
  const size = image.getSize()
  // Raw decode, deliberately unflattened: the readiness probe analyses the guest's
  // own pixels, and a canvas colour composited under them would skew the match.
  const element = await decodeCaptureImage(image.toDataURL())
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Browser capture readiness canvas is unavailable')
  context.drawImage(element, 0, 0, size.width, size.height)
  return {
    data: context.getImageData(0, 0, size.width, size.height).data,
    width: size.width,
    height: size.height,
  }
}

async function analyzeProbeFrame(id: string, budget: CaptureBudget): Promise<CaptureProbeAnalysis | null> {
  const image = await budget.stage('readiness', browserCapture(id, BROWSER_CAPTURE_PROBE_RECT))
  if (!image || image.isEmpty()) return null
  const pixels = await budget.stage('readiness', readBrowserCapturePixels(image))
  return analyzeBrowserCaptureProbe(pixels.data, pixels.width, pixels.height)
}

async function waitForFullResolutionBrowserCapture(id: string, budget: CaptureBudget): Promise<void> {
  const deadline = Date.now() + PROBE_READY_TIMEOUT_MS
  let consecutiveSharpFrames = 0
  let lastAnalysis: CaptureProbeAnalysis = { ready: false, matchedPixels: 0, sampledPixels: 0, centerPixels: [] }

  try {
    // Inside the try: an install that times out may still land later, and the
    // removal below has to follow it.
    await budget.stage('readiness', browserExecJs(id, INSTALL_BROWSER_CAPTURE_PROBE_SCRIPT))
    while (Date.now() <= deadline) {
      const analysis = await analyzeProbeFrame(id, budget)
      if (analysis) {
        lastAnalysis = analysis
        consecutiveSharpFrames = analysis.ready ? consecutiveSharpFrames + 1 : 0
      }
      if (consecutiveSharpFrames >= 2) break
      await delay(25)
    }
    if (consecutiveSharpFrames < 2) {
      throw new Error(
        `Browser capture did not reach full resolution after ${PROBE_READY_TIMEOUT_MS}ms `
        + `(${lastAnalysis.matchedPixels}/${lastAnalysis.sampledPixels} probe pixels matched; `
        + `centers=${lastAnalysis.centerPixels.map((pixel) => pixel.join(',')).join('/')})`,
      )
    }
  } finally {
    // Runs on every exit, with its own short bound: a failed or cancelled capture
    // must not leave the ruler painted over the page.
    await settleWithin(browserExecJs(id, REMOVE_BROWSER_CAPTURE_PROBE_SCRIPT), PROBE_CLEANUP_TIMEOUT_MS)
  }

  // Do not let the transient ruler leak into the returned screenshot. Seeing its
  // signature disappear is a guest-renderer acknowledgement, unlike a host rAF.
  const removalDeadline = Date.now() + PROBE_READY_TIMEOUT_MS
  let consecutiveCleanFrames = 0
  while (Date.now() <= removalDeadline) {
    const analysis = await analyzeProbeFrame(id, budget)
    if (analysis) consecutiveCleanFrames = analysis.ready ? 0 : consecutiveCleanFrames + 1
    if (consecutiveCleanFrames >= 2) return
    await delay(25)
  }
  throw new Error(`Browser capture probe removal timed out after ${PROBE_READY_TIMEOUT_MS}ms`)
}

export interface BrowserScreenshot {
  mimeType: 'image/png'
  data: string
  width: number
  height: number
}

export async function captureBrowserScreenshot(
  id: string,
  selector: string | undefined,
  signal?: AbortSignal,
): Promise<BrowserScreenshot> {
  const budget = new CaptureBudget('Screenshot', SCREENSHOT_BUDGET_MS, signal)
  // Force the tab into the viewport for the duration of the capture: a hidden
  // or background tab rests off-screen / display:none, where capturePage would
  // hang (Chromium never rasterizes an off-viewport layer). beginCapture flips
  // BrowserHostLayer to render it in-viewport (opacity-masked); endCapture in
  // finally restores the cheap resting state so idle tabs cost nothing.
  const store = useBrowserStore.getState()
  store.beginFullResolutionCapture(id)
  try {
    await budget.stage('host-paint', nextPaint())
    await waitForFullResolutionBrowserCapture(id, budget)
    // Resolve the selector box only after the tab is in-viewport — a
    // display:none tab reports an all-zero getBoundingClientRect.
    let rect: Electron.Rectangle | undefined
    if (selector) {
      const box = (await budget.stage('selector', browserExecJs(
        id,
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()`,
      ))) as Electron.Rectangle | null
      if (!box || box.width <= 0 || box.height <= 0) throw new Error('Screenshot selector did not resolve to a visible element')
      rect = box
    }
    let image = await budget.stage('capture', browserCapture(id, rect))
    if (!image || image.isEmpty()) {
      // A tab woken from display:none may need an extra beat for its first frame.
      await delay(200)
      image = await budget.stage('capture', browserCapture(id, rect))
    }
    if (!image || image.isEmpty()) throw new Error('Screenshot capture failed')
    // getSize() reports PHYSICAL pixels, so on a 2x display this is twice the CSS
    // width. Capping it directly meant every retina capture wider than 640 CSS px
    // got resampled by a fractional factor, smearing the text the screenshot was
    // taken to show. fitScreenshotWidth reduces by whole factors only, and returns
    // null when the capture is already small enough to hand over as-is.
    const sized = image.getSize()
    const target = fitScreenshotWidth(sized.width)
    const final = target === null ? image : image.resize({ width: target })
    const size = final.getSize()
    const data = (await budget.stage('encode', flattenBrowserCapture(final, browserTabCanvas(id)))).split(',')[1] ?? ''
    return { mimeType: 'image/png', data, width: size.width, height: size.height }
  } finally {
    store.endFullResolutionCapture(id)
  }
}
