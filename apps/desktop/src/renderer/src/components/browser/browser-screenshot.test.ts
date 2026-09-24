/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBrowserOp } from './browser-automation-runtime'
import { registerBrowserWebview } from './browser-host-api'
import { captureBrowserScreenshot } from './browser-screenshot'
import { useBrowserStore } from '@/stores/browser'

const TAB = 'browser-shot'

function probeBitmap(sharp: boolean): Uint8Array {
  const width = 64
  const height = 16
  const data = new Uint8Array(width * height * 4)
  const colors = [
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
    [255, 255, 255, 255],
  ]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(sharp ? colors[x % 4]! : [255, 255, 255, 255], (y * width + x) * 4)
    }
  }
  return data
}

const neverSettles = <T,>() => new Promise<T>(() => {})

/**
 * A guest whose probe renders sharply while installed, with a switch to make
 * every capturePage hang the way it does when the host window stops compositing.
 */
function installGuest() {
  const guest = { order: [] as string[], probeInstalled: false, hangCaptures: false }
  const originalImage = globalThis.Image
  const createElement = document.createElement.bind(document)
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image
  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return createElement(tagName)
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: probeBitmap(guest.probeInstalled) }),
      }),
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
  const executeJavaScript = vi.fn(async (script: string) => {
    guest.probeInstalled = script.includes('appendChild(probe)')
    guest.order.push(guest.probeInstalled ? 'install' : 'remove')
    return true
  })
  const capturePage = vi.fn(async (rect?: Electron.Rectangle) => {
    if (guest.hangCaptures) return neverSettles<Electron.NativeImage>()
    guest.order.push(rect ? (guest.probeInstalled ? 'sharp-probe' : 'clean-probe') : 'capture')
    return {
      isEmpty: () => false,
      getSize: () => rect ? ({ width: 64, height: 16 }) : ({ width: 400, height: 800 }),
      toDataURL: () => 'data:image/png;base64,AA==',
    } as Electron.NativeImage
  })
  const unregister = registerBrowserWebview(TAB, { executeJavaScript, capturePage } as unknown as Electron.WebviewTag)
  const restore = () => {
    unregister()
    createElementSpy.mockRestore()
    globalThis.Image = originalImage
  }
  return { guest, restore }
}

function expectCaptureStateReleased() {
  expect(useBrowserStore.getState().captureRefs[TAB]).toBeUndefined()
  expect(useBrowserStore.getState().fullResolutionCaptureRefs[TAB]).toBeUndefined()
}

describe('browser screenshot', () => {
  let restore: () => void = () => {}

  beforeEach(() => {
    useBrowserStore.setState({
      tabs: {},
      captureRefs: {},
      fullResolutionCaptureRefs: {},
      automationCounts: {},
      activeAutomationId: null,
      pendingPreviewBrowserId: null,
      automationPreviewBrowserId: null,
    })
    useBrowserStore.getState().ensure(TAB, 'https://example.com', 'session-a')
  })

  afterEach(() => {
    vi.useRealTimers()
    restore()
  })

  it('waits for two sharp guest probes and their removal before reading screenshot pixels', async () => {
    const setup = installGuest()
    restore = setup.restore

    await runBrowserOp('session-a', 'screenshot', { tab: TAB })

    expect(setup.guest.order).toEqual([
      'install',
      'sharp-probe',
      'sharp-probe',
      'remove',
      'clean-probe',
      'clean-probe',
      'capture',
    ])
    expectCaptureStateReleased()
  })

  it('names the stalled stage, cleans up, and lets the next screenshot on the tab succeed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame'] })
    const setup = installGuest()
    restore = setup.restore
    setup.guest.hangCaptures = true

    const stalled = runBrowserOp('session-a', 'screenshot', { tab: TAB })
    const failure = expect(stalled).rejects.toThrow(
      /Screenshot timed out at stage 'readiness' after 3000ms: .*reload the tab/,
    )
    await vi.advanceTimersByTimeAsync(3_100)
    await failure

    expect(setup.guest.order).toEqual(['install', 'remove'])
    expect(setup.guest.probeInstalled).toBe(false)
    expectCaptureStateReleased()

    setup.guest.hangCaptures = false
    setup.guest.order.length = 0
    const recovered = runBrowserOp('session-a', 'screenshot', { tab: TAB })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(recovered).resolves.toMatchObject({ mimeType: 'image/png', width: 400, height: 800 })
    expect(setup.guest.order.at(-1)).toBe('capture')
  })

  it('stops at once when cancelled, releasing the capture and removing the probe', async () => {
    const setup = installGuest()
    restore = setup.restore
    setup.guest.hangCaptures = true
    const controller = new AbortController()

    const cancelled = captureBrowserScreenshot(TAB, undefined, controller.signal)
    await vi.waitFor(() => expect(setup.guest.order).toEqual(['install']))
    controller.abort(new Error('Cancelled after the main process timed out'))

    await expect(cancelled).rejects.toThrow('Cancelled after the main process timed out')
    expect(setup.guest.order).toEqual(['install', 'remove'])
    expectCaptureStateReleased()
  })
})
