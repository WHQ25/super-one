import { deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertMentionBrandsCurrent } from './mention-brand-check'
import { RASTER_MEAN_LIMIT, assertSameRaster, rasterMeanDelta } from './raster-drift'

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < data.length; index++) {
    crc ^= data[index]!
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

/** 8-bit RGBA. `filter` changes the encoding without changing the pixels. */
function encodePng(width: number, height: number, rgba: Buffer, filter: 0 | 1 = 0): Buffer {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = filter
    for (let i = 0; i < stride; i++) {
      const value = rgba[y * stride + i]!
      const left = filter === 1 && i >= 4 ? rgba[y * stride + i - 4]! : 0
      raw[row + 1 + i] = (value - left) & 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const opaqueRed = Buffer.from([200, 20, 20, 255, 200, 20, 20, 255, 200, 20, 20, 255, 200, 20, 20, 255])

function mentionJson(hash: string, png: Buffer, brand = 'claude'): string {
  return JSON.stringify({
    pixels: 128,
    variants: { light: { '#000': { [brand]: hash } } },
    images: { [hash]: png.toString('base64') },
  })
}

describe('rasterMeanDelta', () => {
  it('treats a different PNG filter as the same pixels', () => {
    const none = encodePng(2, 2, opaqueRed, 0)
    const sub = encodePng(2, 2, opaqueRed, 1)
    expect(none.equals(sub)).toBe(false)
    expect(rasterMeanDelta(none, sub)).toBe(0)
  })

  it('ignores RGB left in fully transparent pixels', () => {
    const clear = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const garbage = Buffer.from([255, 0, 128, 0, 1, 2, 3, 0, 9, 9, 9, 0, 4, 5, 6, 0])
    expect(rasterMeanDelta(encodePng(2, 2, clear), encodePng(2, 2, garbage))).toBe(0)
  })

  it('accepts a small ink change and rejects a different picture', () => {
    const nudged = Buffer.from(opaqueRed)
    nudged[0] = 208
    const blue = Buffer.from([20, 20, 200, 255, 20, 20, 200, 255, 20, 20, 200, 255, 20, 20, 200, 255])
    const committed = encodePng(2, 2, opaqueRed)
    expect(rasterMeanDelta(committed, encodePng(2, 2, nudged))).toBeLessThan(RASTER_MEAN_LIMIT)
    expect(rasterMeanDelta(committed, encodePng(2, 2, blue))).toBeGreaterThan(RASTER_MEAN_LIMIT)
    expect(() => assertSameRaster(committed, encodePng(2, 2, blue), 'Harness raster antigravity', 'Run generate-harness-icons.ts')).toThrow(/mean channel delta/)
  })

  it('rejects a different size', () => {
    const wide = Buffer.alloc(3 * 2 * 4, 0)
    expect(() => rasterMeanDelta(encodePng(2, 2, opaqueRed), encodePng(3, 2, wide))).toThrow(/2x2 vs 3x2/)
  })

  it('accepts a re-encoded mention brand and rejects a different one', () => {
    const red = encodePng(2, 2, opaqueRed, 0)
    const samePixels = encodePng(2, 2, opaqueRed, 1)
    const blue = encodePng(2, 2, Buffer.from([20, 20, 200, 255, 20, 20, 200, 255, 20, 20, 200, 255, 20, 20, 200, 255]))
    const committed = mentionJson('aa', red)
    expect(() => assertMentionBrandsCurrent(committed, mentionJson('bb', samePixels))).not.toThrow()
    expect(() => assertMentionBrandsCurrent(committed, mentionJson('cc', blue))).toThrow(/Mention brand light claude/)
    expect(() => assertMentionBrandsCurrent(committed, mentionJson('aa', red, 'codex'))).toThrow(/light #000/)
  })

  it('decodes the committed Antigravity raster', () => {
    const png = readFileSync(resolve(import.meta.dirname, '../src/ui/harness-rasters/antigravity.png'))
    expect(rasterMeanDelta(png, png)).toBe(0)
    expect(() => assertSameRaster(png, encodePng(2, 2, opaqueRed), 'Harness raster antigravity', 'Run generate-harness-icons.ts')).toThrow(/384x384 vs 2x2/)
  })
})
