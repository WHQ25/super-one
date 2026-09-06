import { describe, expect, it } from 'vitest'
import data from './mention-artwork.generated.json'
import files from './file-icons.generated.json'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../theme/tokens.generated'
import { mentionFileArtwork } from './mention-file-artwork-data'

describe('native file artwork', () => {
  it('covers every desktop SVG for every mobile foreground color', () => {
    const colors = new Set([GENERATED_DARK_COLORS.foreground, ...Object.values(GENERATED_LIGHT_COLORS).map((theme) => theme.foreground)])
    const variants: Record<string, Record<string, string>> = data.variants
    const images: Record<string, string> = data.images
    for (const color of colors) {
      expect(Object.keys(variants[color]!).sort()).toEqual(Object.keys(files.artwork).sort())
      for (const image of Object.values(variants[color]!)) expect(images[image]).toBeTruthy()
    }
    for (const png of Object.values(data.images)) {
      const bytes = Buffer.from(png, 'base64')
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(bytes.readUInt32BE(16)).toBe(128)
      expect(bytes.readUInt32BE(20)).toBe(128)
    }
  })

  it('uses the same remote path, filename and directory matching as file rows', () => {
    const color = GENERATED_DARK_COLORS.foreground
    expect(mentionFileArtwork('C:\\repo\\app.ts', false, color)).toBe(mentionFileArtwork('/repo/app.ts', false, color))
    expect(mentionFileArtwork('app.ts', false, color)).not.toBe(mentionFileArtwork('app.js', false, color))
    expect(mentionFileArtwork('/repo/src/', true, color)).toBe(mentionFileArtwork('src', true, color))
    expect(mentionFileArtwork('unknown.custom-extension', false, color)).toBeTruthy()
  })
})
