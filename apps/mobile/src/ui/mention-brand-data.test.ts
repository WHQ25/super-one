import { describe, expect, it } from 'vitest'
import data from './mention-brands.generated.json'
import { mentionBrandArtwork } from './mention-brand-data'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../theme/tokens.generated'

describe('native provider mention artwork', () => {
  it('covers all mobile theme inks with transparent high-density PNGs', () => {
    const themes = { light: Object.values(GENERATED_LIGHT_COLORS).map((theme) => theme.foreground), dark: [GENERATED_DARK_COLORS.foreground] }
    for (const [scheme, colors] of Object.entries(themes)) {
      for (const color of colors) {
        for (const ref of ['claude-base', 'codex-review', 'acp-base:grok-build', 'opencode-base', 'cursor-base', 'dsh-base', 'acp-base:custom', 'future-base']) {
          const png = mentionBrandArtwork(ref, scheme as 'light' | 'dark', color)
          expect(png, `${scheme}/${ref}`).toBeTruthy()
          const bytes = Buffer.from(png!, 'base64')
          expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
          expect(bytes.readUInt32BE(16)).toBe(128)
          expect(bytes.readUInt32BE(20)).toBe(128)
          expect(bytes[25]).toBe(6) // RGBA, retaining transparency around the mark.
        }
      }
    }
    expect(Object.keys(data.images).length).toBeGreaterThan(7)
  })
  it('preserves custom-provider brands and ACP aliases without disguising unknown providers', () => {
    const ink = GENERATED_DARK_COLORS.foreground
    const image = (ref: string) => mentionBrandArtwork(ref, 'dark', ink)
    expect(image('codex-work-review')).toBe(image('codex-base'))
    expect(image('acp-base:opencode')).toBe(image('opencode-base'))
    expect(image('acp-base:grok-build')).not.toBe(image('acp-base:custom'))
    expect(image('future-base')).not.toBe(image('claude-base'))
    expect(image('future-base')).toBe(image('unknown-base'))
  })
})
