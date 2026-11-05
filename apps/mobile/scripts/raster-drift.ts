import { inflateSync } from 'node:zlib'

/**
 * Playwright screenshots of `feGaussianBlur` are not byte-identical across
 * Chromium builds. The committed PNGs are rasterized on macOS; `check:icons`
 * runs on Linux. Compare premultiplied pixels so leftover RGB in fully
 * transparent texels does not count.
 *
 * The limit sits above rasterizer noise and below a different mark. On the
 * Antigravity harness raster, a 4px shift is about 6 and a red/blue channel
 * swap is about 22. The error reports the measured mean so a future miss
 * names the gap.
 */
export const RASTER_MEAN_LIMIT = 12

interface RgbaImage {
  width: number
  height: number
  pixels: Uint8Array
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}

/** Decode an 8-bit RGB or RGBA PNG. Ancillary chunks are ignored. */
export function decodePng(png: Buffer): RgbaImage {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat: Buffer[] = []
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      colorType = data[9]!
      if (bitDepth !== 8 || data[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs are supported')
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG color type ${colorType}`)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }
  if (!width || !height || colorType < 0 || !idat.length) throw new Error('PNG is missing image data')
  const sourceChannels = colorType === 6 ? 4 : 3
  const stride = width * sourceChannels
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length !== height * (stride + 1)) throw new Error('PNG image data has an unexpected size')
  const pixels = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const reconstructed = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= sourceChannels ? reconstructed[i - sourceChannels]! : 0
      const up = previous[i]!
      const upLeft = i >= sourceChannels ? previous[i - sourceChannels]! : 0
      const value = row[i]!
      if (filter === 0) reconstructed[i] = value
      else if (filter === 1) reconstructed[i] = (value + left) & 255
      else if (filter === 2) reconstructed[i] = (value + up) & 255
      else if (filter === 3) reconstructed[i] = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) reconstructed[i] = (value + paeth(left, up, upLeft)) & 255
      else throw new Error(`unsupported PNG filter ${filter}`)
    }
    previous.set(reconstructed)
    for (let x = 0; x < width; x++) {
      const source = x * sourceChannels
      const target = (y * width + x) * 4
      pixels[target] = reconstructed[source]!
      pixels[target + 1] = reconstructed[source + 1]!
      pixels[target + 2] = reconstructed[source + 2]!
      pixels[target + 3] = sourceChannels === 4 ? reconstructed[source + 3]! : 255
    }
  }
  return { width, height, pixels }
}

/** Mean per-channel delta after premultiplying RGB by alpha. 0 means the same mark. */
export function rasterMeanDelta(committed: Buffer, fresh: Buffer): number {
  const expected = decodePng(committed)
  const actual = decodePng(fresh)
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`)
  }
  const pixels = expected.width * expected.height
  let total = 0
  for (let index = 0; index < pixels; index++) {
    const offset = index * 4
    const expectedAlpha = expected.pixels[offset + 3]!
    const actualAlpha = actual.pixels[offset + 3]!
    for (let channel = 0; channel < 3; channel++) {
      total += Math.abs(expected.pixels[offset + channel]! * expectedAlpha - actual.pixels[offset + channel]! * actualAlpha) / 255
    }
    total += Math.abs(expectedAlpha - actualAlpha)
  }
  return total / (pixels * 4)
}

export function assertSameRaster(committed: Buffer, fresh: Buffer, label: string, regenerate: string): void {
  if (committed.equals(fresh)) return
  let mean: number
  try {
    mean = rasterMeanDelta(committed, fresh)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} is stale (${detail}). ${regenerate}`)
  }
  if (mean > RASTER_MEAN_LIMIT) {
    throw new Error(`${label} is stale (mean channel delta ${mean.toFixed(2)}, limit ${RASTER_MEAN_LIMIT}). ${regenerate}`)
  }
}
