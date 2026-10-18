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

const RGBA = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 255, 255],
] as const

const BGRA = RGBA.map(([red, green, blue, alpha]) => [blue, green, red, alpha])

/** Center-sampled ruler. `width` overrides the natural `round(64 * scale)` capture width. */
function centerSampledProbe(
  scale: number,
  width = Math.round(64 * scale),
  order: readonly (readonly number[])[] = RGBA,
): { data: Uint8Array; width: number; height: number } {
  const height = Math.max(2, Math.round(16 * scale))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const css = (x + 0.5) / scale
      const color = css < 64 ? order[Math.floor(css) % 4] : [128, 128, 128, 255]
      data.set(color, (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

function resizeProbe(
  source: { data: Uint8Array; width: number; height: number },
  width: number,
  mode: 'nearest' | 'bilinear',
): { data: Uint8Array; width: number; height: number } {
  const row = Math.floor(source.height / 2)
  const samples: number[][] = []
  for (let x = 0; x < source.width; x += 1) {
    const offset = (row * source.width + x) * 4
    samples.push([
      source.data[offset] ?? 0,
      source.data[offset + 1] ?? 0,
      source.data[offset + 2] ?? 0,
      source.data[offset + 3] ?? 0,
    ])
  }
  const scaled = Array.from({ length: width }, (_, x) => {
    const position = ((x + 0.5) * samples.length) / width - 0.5
    if (mode === 'nearest') {
      const index = Math.min(samples.length - 1, Math.max(0, Math.round(position)))
      return samples[index]!
    }
    const left = Math.max(0, Math.floor(position))
    const right = Math.min(samples.length - 1, left + 1)
    const blend = Math.max(0, position - left)
    return samples[left]!.map((value, channel) => Math.round(value * (1 - blend) + samples[right]![channel]! * blend))
  })
  const height = 2
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(scaled[x]!, (y * width + x) * 4)
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
      .toEqual({ ready: false, matchedPixels: 0, sampledPixels: 0, centerPixels: [], runCount: 0 })
  })

  it('accepts a center-sampled ruler at fractional display scales', () => {
    for (const scale of [1.25, 1.5, 1.75]) {
      const probe = centerSampledProbe(scale)
      expect(analyzeBrowserCaptureProbe(probe.data, probe.width, probe.height))
        .toMatchObject({ ready: true, matchedPixels: probe.width, sampledPixels: probe.width })
    }
  })

  it('accepts the same ruler stored as BGRA', () => {
    const probe = centerSampledProbe(1.25, undefined, BGRA)
    expect(analyzeBrowserCaptureProbe(probe.data, probe.width, probe.height).ready).toBe(true)
  })

  it('accepts a zoomed ruler whose stripe count is not 64', () => {
    for (const [scale, width] of [[1.1, 64], [1.875, 80]] as const) {
      const probe = centerSampledProbe(scale, width)
      expect(analyzeBrowserCaptureProbe(probe.data, probe.width, probe.height).ready).toBe(true)
    }
  })

  it('rejects a bilinear upscale and a stale surface stretched to the capture width', () => {
    const bilinear = resizeProbe(centerSampledProbe(1), 80, 'bilinear')
    expect(analyzeBrowserCaptureProbe(bilinear.data, bilinear.width, bilinear.height).ready).toBe(false)

    for (const scale of [0.5, 0.8]) {
      const source = centerSampledProbe(scale)
      for (const width of [80, 128]) {
        for (const mode of ['nearest', 'bilinear'] as const) {
          const stretched = resizeProbe(source, width, mode)
          expect(analyzeBrowserCaptureProbe(stretched.data, stretched.width, stretched.height).ready).toBe(false)
        }
      }
    }
  })
})
