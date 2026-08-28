import { describe, expect, it } from 'vitest'
import { analyzeBrowserCaptureProbe } from './browser-capture-readiness'

const COLORS = [
  [0, 0, 255, 255],
  [0, 255, 0, 255],
  [255, 0, 0, 255],
  [255, 255, 255, 255],
] as const

function sharpProbe(dpr: number): { data: Uint8Array; width: number; height: number } {
  const width = 64 * dpr
  const height = 16 * dpr
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const stripe = Math.floor(x / dpr)
      data.set(COLORS[stripe % 4], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

describe('analyzeBrowserCaptureProbe', () => {
  it('accepts a sharp device-pixel raster at 1x and 2x', () => {
    for (const dpr of [1, 2]) {
      const probe = sharpProbe(dpr)
      expect(analyzeBrowserCaptureProbe(probe.data, probe.width, probe.height))
        .toMatchObject({ ready: true, matchedPixels: probe.width, sampledPixels: probe.width })
    }
  })

  it('rejects a uniformly stale frame that does not contain the probe', () => {
    const probe = sharpProbe(2)
    probe.data.fill(255)
    expect(analyzeBrowserCaptureProbe(probe.data, probe.width, probe.height).ready).toBe(false)
  })

  it('rejects a compositor-upscaled probe with blended pixels', () => {
    const probe = sharpProbe(2)
    for (let i = 0; i < probe.data.length; i += 4) {
      probe.data[i] = Math.round(((probe.data[i] ?? 0) + 127) / 2)
      probe.data[i + 1] = Math.round(((probe.data[i + 1] ?? 0) + 127) / 2)
      probe.data[i + 2] = Math.round(((probe.data[i + 2] ?? 0) + 127) / 2)
    }
    expect(analyzeBrowserCaptureProbe(probe.data, probe.width, probe.height).ready).toBe(false)
  })

  it('rejects incomplete bitmap data', () => {
    expect(analyzeBrowserCaptureProbe(new Uint8Array(12), 128, 32))
      .toEqual({ ready: false, matchedPixels: 0, sampledPixels: 0, centerPixels: [] })
  })
})
