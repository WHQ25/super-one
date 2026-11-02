import { inflateSync } from 'node:zlib'
import { ATTACHMENT_THUMBNAIL_MAX_SIDE, THUMBNAIL_JPEG_QUALITY, type AttachmentThumbnail } from '@superone/runtime/stream/delivery/attachment-preview'
// Static import so esbuild inlines this CJS package into the published CLI.
import jpeg from 'jpeg-js'

const MAX_PIXELS = 8_000 * 8_000

/**
 * PNG and JPEG thumbnails without Electron. Anything else (GIF, WebP) stays
 * an icon chip, the same as a picture the desktop decoder cannot read.
 */
export function encodeNodeThumbnail(bytes: Buffer, mimeType: string, limits?: { maxSide: number; quality: number }): AttachmentThumbnail | null {
  const decoded = mimeType === 'image/png' || bytes[0] === 0x89
    ? decodePng(bytes)
    : mimeType === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8)
      ? decodeJpeg(bytes)
      : null
  if (!decoded) return null
  const fitted = fit(decoded, limits?.maxSide ?? ATTACHMENT_THUMBNAIL_MAX_SIDE)
  const encoded = jpeg.encode({ data: fitted.data, width: fitted.width, height: fitted.height }, limits?.quality ?? THUMBNAIL_JPEG_QUALITY)
  return { base64: Buffer.from(encoded.data).toString('base64'), mimeType: 'image/jpeg' }
}

interface Raster {
  width: number
  height: number
  data: Uint8Array
}

function decodeJpeg(bytes: Buffer): Raster | null {
  try {
    const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    if (!raw.width || !raw.height || raw.width * raw.height > MAX_PIXELS) return null
    return { width: raw.width, height: raw.height, data: raw.data }
  } catch {
    return null
  }
}

function decodePng(bytes: Buffer): Raster | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes.toString('ascii', 1, 4) !== 'PNG') return null
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) return null
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(start)
      height = bytes.readUInt32BE(start + 4)
      bitDepth = bytes[start + 8] ?? 0
      colorType = bytes[start + 9] ?? 0
      interlace = bytes[start + 12] ?? 0
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, end))
    } else if (type === 'IEND') break
    offset = end + 4
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (bitDepth !== 8 || interlace !== 0 || channels === 0 || !width || !height || width * height > MAX_PIXELS) return null
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  const stride = width * channels
  if (raw.length < height * (stride + 1)) return null
  const data = new Uint8Array(width * height * 4)
  let src = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[src++] ?? 0
    const row = Buffer.from(raw.subarray(src, src + stride))
    src += stride
    if (!unfilter(filter, row, prev, channels)) return null
    for (let x = 0; x < width; x++) {
      const i = x * channels
      const o = (y * width + x) * 4
      const sample = (index: number) => row[index] ?? 0
      if (channels === 1) data.set([sample(i), sample(i), sample(i), 255], o)
      else if (channels === 2) data.set([sample(i), sample(i), sample(i), sample(i + 1)], o)
      else if (channels === 3) data.set([sample(i), sample(i + 1), sample(i + 2), 255], o)
      else data.set([sample(i), sample(i + 1), sample(i + 2), sample(i + 3)], o)
    }
    prev = row
  }
  return { width, height, data }
}

function unfilter(filter: number, row: Buffer, prev: Buffer, bpp: number): boolean {
  if (filter === 0) return true
  if (filter < 0 || filter > 4) return false
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp]! : 0
    const up = prev[i] ?? 0
    const ul = i >= bpp ? prev[i - bpp]! : 0
    const add = filter === 1 ? left
      : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
          : paeth(left, up, ul)
    row[i] = (row[i]! + add) & 255
  }
  return true
}

function paeth(left: number, up: number, ul: number): number {
  const p = left + up - ul
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - ul)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return ul
}

function fit(raster: Raster, maxSide: number): Raster {
  const scale = Math.min(1, maxSide / Math.max(raster.width, raster.height, 1))
  const width = Math.max(1, Math.round(raster.width * scale))
  const height = Math.max(1, Math.round(raster.height * scale))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(raster.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(raster.width - 1, Math.floor(x / scale))
      const from = (sy * raster.width + sx) * 4
      const to = (y * width + x) * 4
      const alpha = (raster.data[from + 3] ?? 255) / 255
      // JPEG has no alpha. Flatten onto white so a transparent PNG stays visible.
      data[to] = Math.round((raster.data[from] ?? 0) * alpha + 255 * (1 - alpha))
      data[to + 1] = Math.round((raster.data[from + 1] ?? 0) * alpha + 255 * (1 - alpha))
      data[to + 2] = Math.round((raster.data[from + 2] ?? 0) * alpha + 255 * (1 - alpha))
      data[to + 3] = 255
    }
  }
  return { width, height, data }
}
