/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BROWSER_DARK_CANVAS,
  BROWSER_LIGHT_CANVAS,
  browserCanvasColor,
  flattenBrowserCapture,
  isBrowserCanvasProbe,
} from './browser-canvas'

describe('browserCanvasColor', () => {
  it('paints white before the guest has been probed', () => {
    expect(browserCanvasColor(null)).toBe(BROWSER_LIGHT_CANVAS)
  })

  it('paints white for a page that declares no colour-scheme, whatever the preference', () => {
    expect(browserCanvasColor(['normal', true])).toBe(BROWSER_LIGHT_CANVAS)
    expect(browserCanvasColor(['normal', false])).toBe(BROWSER_LIGHT_CANVAS)
  })

  it('follows the preference for a page that offers both schemes', () => {
    expect(browserCanvasColor(['light dark', true])).toBe(BROWSER_DARK_CANVAS)
    expect(browserCanvasColor(['light dark', false])).toBe(BROWSER_LIGHT_CANVAS)
  })

  it('paints dark for a dark-only page even under a light preference', () => {
    expect(browserCanvasColor(['dark', false])).toBe(BROWSER_DARK_CANVAS)
    expect(browserCanvasColor(['only dark', false])).toBe(BROWSER_DARK_CANVAS)
  })

  it('paints white for a light-only page even under a dark preference', () => {
    expect(browserCanvasColor(['light', true])).toBe(BROWSER_LIGHT_CANVAS)
  })

  it('ignores case and irregular whitespace in the declared value', () => {
    expect(browserCanvasColor(['  LIGHT   DARK ', true])).toBe(BROWSER_DARK_CANVAS)
  })
})

describe('isBrowserCanvasProbe', () => {
  it('accepts the probe shape and rejects anything else', () => {
    expect(isBrowserCanvasProbe(['light dark', true])).toBe(true)
    expect(isBrowserCanvasProbe(['light dark'])).toBe(false)
    expect(isBrowserCanvasProbe(null)).toBe(false)
    expect(isBrowserCanvasProbe('light dark')).toBe(false)
  })
})

describe('flattenBrowserCapture', () => {
  const RAW = 'data:image/png;base64,cmF3'
  const FLATTENED = 'data:image/png;base64,ZmxhdA=='

  const capture = (size = { width: 8, height: 4 }) =>
    ({ toDataURL: () => RAW, getSize: () => size }) as unknown as Electron.NativeImage

  /** jsdom has no 2D context, so the compositing path needs a canvas stand-in. */
  function stubCanvas(context: Partial<CanvasRenderingContext2D> | null) {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => FLATTENED,
    } as unknown as HTMLCanvasElement
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : create(tag)) as typeof document.createElement)
    return canvas
  }

  afterEach(() => vi.restoreAllMocks())

  it('paints the canvas colour under the capture before compositing it', async () => {
    const calls: string[] = []
    const context = {
      fillStyle: '',
      fillRect: vi.fn(() => calls.push('fill')),
      drawImage: vi.fn(() => calls.push('draw')),
    }
    const canvas = stubCanvas(context as unknown as CanvasRenderingContext2D)
    // The decode never resolves against a real image in jsdom; resolve it directly.
    vi.spyOn(Image.prototype, 'src' as never, 'set').mockImplementation(function (this: HTMLImageElement) {
      queueMicrotask(() => this.onload?.(new Event('load')))
    })

    await expect(flattenBrowserCapture(capture(), BROWSER_DARK_CANVAS)).resolves.toBe(FLATTENED)
    expect(canvas.width).toBe(8)
    expect(canvas.height).toBe(4)
    expect(context.fillStyle).toBe(BROWSER_DARK_CANVAS)
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 8, 4)
    // Order is the whole point: drawing first would leave the fill on top.
    expect(calls).toEqual(['fill', 'draw'])
  })

  it('hands back the raw capture when compositing is unavailable', async () => {
    stubCanvas(null)
    await expect(flattenBrowserCapture(capture(), BROWSER_LIGHT_CANVAS)).resolves.toBe(RAW)
  })

  it('hands back the raw capture for an empty-sized image', async () => {
    stubCanvas(null)
    await expect(flattenBrowserCapture(capture({ width: 0, height: 0 }), BROWSER_LIGHT_CANVAS)).resolves.toBe(RAW)
  })
})
