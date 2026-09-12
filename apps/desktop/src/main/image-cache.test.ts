import { describe, expect, it } from 'vitest'
import { detectImageMime, extractPngFromIco, toDataUrl, toWebDisplayImage } from './image-cache'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function pngIco(png: Buffer): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 1
  entry[1] = 1
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

describe('toWebDisplayImage', () => {
  it('passes PNG through and unwraps a PNG-in-ICO favicon', () => {
    expect(detectImageMime(PNG)).toBe('image/png')
    expect(toWebDisplayImage(PNG)?.equals(PNG)).toBe(true)
    const ico = pngIco(PNG)
    expect(detectImageMime(ico)).toBe('image/x-icon')
    expect(extractPngFromIco(ico)?.equals(PNG)).toBe(true)
    expect(toWebDisplayImage(ico)?.equals(PNG)).toBe(true)
    expect(toDataUrl(ico)).toMatch(/^data:image\/png;base64,/)
  })

  it('drops a BMP-only ICO so the caller can try a PNG source', () => {
    const header = Buffer.alloc(6)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    const entry = Buffer.alloc(16)
    entry[0] = 16
    entry[1] = 16
    const bmp = Buffer.alloc(40) // BITMAPINFOHEADER, not PNG
    bmp.writeUInt32LE(40, 0)
    entry.writeUInt32LE(bmp.length, 8)
    entry.writeUInt32LE(22, 12)
    const ico = Buffer.concat([header, entry, bmp])
    expect(detectImageMime(ico)).toBe('image/x-icon')
    expect(extractPngFromIco(ico)).toBeNull()
    expect(toWebDisplayImage(ico)).toBeNull()
    expect(toDataUrl(ico)).toBeNull()
  })
})
