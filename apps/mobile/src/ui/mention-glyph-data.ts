import data from './mention-artwork.generated.json'
import type { MobileColorScheme } from '../theme/tokens'

const glyphs: Record<string, { icon: string; light: string; dark: string; artwork: Record<string, string> }> = data.glyphs
const images: Record<string, string> = data.images

export function mentionGlyphArtwork(kind: string, scheme: MobileColorScheme, foreground: string): string | undefined {
  const glyph = Object.hasOwn(glyphs, kind) ? glyphs[kind] : undefined
  if (!glyph) return undefined
  const tone = glyph[scheme] === '$foreground' ? foreground : glyph[scheme]
  const id = glyph.artwork[tone]
  return id ? images[id] : undefined
}
