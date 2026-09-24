/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBrowserWebview } from './browser-host-api'
import { startBrowserRecording, stopBrowserRecording } from './browser-recording'
import { useBrowserStore } from '@/stores/browser'

const TAB = 'browser-rec'

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'video/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  start() {
    this.state = 'recording'
  }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['frame'], { type: 'video/webm' }) })
    queueMicrotask(() => this.dispatchEvent(new Event('stop')))
  }
}

/** A guest whose capturePage can be switched to hang, as it does while the host window is not compositing. */
function installGuest() {
  const guest = { hangCaptures: false, captures: 0 }
  const originalImage = globalThis.Image
  const createElement = document.createElement.bind(document)
  class FakeImage {
    onload: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return createElement(tagName)
    return {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: () => {}, drawImage: () => {} }),
      captureStream: () => ({}),
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
  const capturePage = vi.fn(async () => {
    if (guest.hangCaptures) return new Promise<Electron.NativeImage>(() => {})
    guest.captures += 1
    return {
      isEmpty: () => false,
      getSize: () => ({ width: 800, height: 600 }),
      toDataURL: () => 'data:image/png;base64,AA==',
    } as Electron.NativeImage
  })
  const unregister = registerBrowserWebview(TAB, { capturePage } as unknown as Electron.WebviewTag)
  const restore = () => {
    unregister()
    createElementSpy.mockRestore()
    vi.unstubAllGlobals()
    globalThis.Image = originalImage
  }
  return { guest, restore }
}

describe('browser recording', () => {
  let restore: () => void = () => {}

  beforeEach(() => {
    useBrowserStore.setState({ tabs: {}, captureRefs: {}, fullResolutionCaptureRefs: {} })
    useBrowserStore.getState().ensure(TAB, 'https://example.com', 'session-a')
  })

  afterEach(() => {
    vi.useRealTimers()
    restore()
  })

  it('fails a first frame that never arrives with its stage, releasing the tab for the next recording', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame'] })
    const setup = installGuest()
    restore = setup.restore
    setup.guest.hangCaptures = true

    const stalled = startBrowserRecording(TAB)
    const failure = expect(stalled).rejects.toThrow(
      /Recording timed out at stage 'capture' after 3000ms: .*reload the tab/,
    )
    await vi.advanceTimersByTimeAsync(3_100)
    await failure
    expect(useBrowserStore.getState().captureRefs[TAB]).toBeUndefined()

    setup.guest.hangCaptures = false
    const started = startBrowserRecording(TAB)
    await vi.advanceTimersByTimeAsync(50)
    const { recordingId } = await started
    const stopped = stopBrowserRecording(recordingId, TAB)
    await vi.advanceTimersByTimeAsync(50)
    await expect(stopped).resolves.toMatchObject({ mimeType: 'video/webm', width: 800, height: 600 })
  })

  it('still finishes the video when its closing frame hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame'] })
    const setup = installGuest()
    restore = setup.restore
    const started = startBrowserRecording(TAB)
    await vi.advanceTimersByTimeAsync(50)
    const { recordingId } = await started

    setup.guest.hangCaptures = true
    const stopped = stopBrowserRecording(recordingId, TAB)
    await vi.advanceTimersByTimeAsync(3_100)

    const video = await stopped
    expect(video.data.length).toBeGreaterThan(0)
    expect(useBrowserStore.getState().captureRefs[TAB]).toBeUndefined()
  })

  it('stops starting at once when cancelled and releases the capture', async () => {
    const setup = installGuest()
    restore = setup.restore
    setup.guest.hangCaptures = true
    const controller = new AbortController()

    const cancelled = startBrowserRecording(TAB, controller.signal)
    await vi.waitFor(() => expect(useBrowserStore.getState().captureRefs[TAB]).toBe(1))
    controller.abort(new Error('Cancelled after the main process timed out'))

    await expect(cancelled).rejects.toThrow('Cancelled after the main process timed out')
    expect(useBrowserStore.getState().captureRefs[TAB]).toBeUndefined()
  })
})
