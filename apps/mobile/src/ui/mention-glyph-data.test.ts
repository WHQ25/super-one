import { describe, expect, it } from 'vitest'
import { desktopMentionGlyphs } from '../../scripts/mention-glyphs'
import { mentionGlyphArtwork, mentionGroup } from './mention-glyph-data'
import data from './mention-artwork.generated.json'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../theme/tokens.generated'

describe('desktop mention identities on mobile', () => {
  it('preserves desktop glyph and theme colors through native image lookup', () => {
    const glyphs: Record<string, { icon: string; light: string; dark: string }> = data.glyphs
    for (const [kind, expected] of Object.entries(desktopMentionGlyphs())) {
      expect(glyphs[kind]).toMatchObject(expected)
      const light = mentionGlyphArtwork(kind, 'light', GENERATED_LIGHT_COLORS.claude.foreground)
      const dark = mentionGlyphArtwork(kind, 'dark', GENERATED_DARK_COLORS.foreground)
      expect(light).toBeTruthy()
      expect(dark).toBeTruthy()
      expect(light).not.toBe(dark)
    }
    const miniApp = mentionGlyphArtwork('miniapp', 'light', GENERATED_LIGHT_COLORS.claude.foreground)
    expect(miniApp).toBeTruthy()
    expect(miniApp).toBe(mentionGlyphArtwork('miniapp', 'dark', GENERATED_DARK_COLORS.foreground))
    expect(mentionGlyphArtwork('agent-profile', 'dark', GENERATED_DARK_COLORS.foreground)).toBeUndefined()
    expect(mentionGlyphArtwork('__proto__', 'dark', GENERATED_DARK_COLORS.foreground)).toBeUndefined()
  })

  it('keeps provider profiles, capabilities and sessions out of file results', () => {
    expect(mentionGroup('agent-profile')).toBe('Agents')
    for (const kind of ['builtin', 'computer', 'browser', 'widget', 'debug', 'collab']) expect(mentionGroup(kind)).toBe('Capabilities')
    expect(mentionGroup('session')).toBe('Sessions')
    expect(mentionGroup('miniapp')).toBe('Apps')
    expect(mentionGroup('desktop-app')).toBe('Apps')
    for (const kind of ['file', 'directory', 'dir-entry']) expect(mentionGroup(kind)).toBe('Files & folders')
    expect(mentionGroup('future-kind')).toBe('Other')
  })
})
