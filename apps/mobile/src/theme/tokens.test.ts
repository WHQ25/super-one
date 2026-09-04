import { describe, expect, it } from 'vitest'
import { mobileThemeTokens, mobileWebViewTheme, normalizeColorScheme } from './tokens'

describe('mobile theme tokens', () => {
  it('follows the system scheme and exposes matching host theme data', () => {
    expect(normalizeColorScheme('light')).toBe('light')
    expect(normalizeColorScheme('dark')).toBe('dark')
    expect(normalizeColorScheme(null)).toBe('dark')
    expect(mobileThemeTokens('dark', 'claude').scheme).toBe('dark')
    expect(mobileThemeTokens('light', 'claude').scheme).toBe('light')
  })

  it('uses per-harness light accents while retaining semantic surfaces', () => {
    const claude = mobileThemeTokens('light', 'claude')
    const codex = mobileThemeTokens('light', 'codex')
    expect(claude.brandHue).toBe(40)
    expect(codex.brandHue).toBe(240)
    expect(claude.colors.primary).not.toBe(codex.colors.primary)
    expect(claude.colors.background).toMatch(/^#[0-9a-f]{6,8}$/)
    expect(codex.colors.error).toMatch(/^#[0-9a-f]{6,8}$/)
  })

  it('derives both WebView themes from the native token palette', () => {
    const tokens = mobileThemeTokens('light', 'opencode')
    expect(mobileWebViewTheme(tokens)).toEqual({
      type: 'setTheme',
      hue: tokens.brandHue,
      scheme: 'light',
      colors: {
        background: tokens.colors.background,
        surface: tokens.colors.surface,
        foreground: tokens.colors.foreground,
        mutedForeground: tokens.colors.mutedForeground,
        border: tokens.colors.border,
      },
    })
  })
})
