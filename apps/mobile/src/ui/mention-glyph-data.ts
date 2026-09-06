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

export function mentionGroup(kind: string): string {
  if (kind === 'agent' || kind === 'agent-profile') return 'Agents'
  if (kind === 'builtin' || ['collab', 'computer', 'browser', 'widget', 'debug'].includes(kind)) return 'Capabilities'
  if (kind === 'session') return 'Sessions'
  if (kind === 'miniapp' || kind === 'desktop-app') return 'Apps'
  if (kind === 'file' || kind === 'directory' || kind === 'dir-entry') return 'Files & folders'
  return 'Other'
}
