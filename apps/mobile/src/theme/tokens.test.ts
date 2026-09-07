import { describe, expect, it } from 'vitest'
import { mobileThemeTokens, mobileWebViewTheme, normalizeColorScheme, resolveBrandHue } from './tokens'

describe('mobile theme tokens', () => {
  it('follows the system scheme and exposes matching host theme data', () => {
    expect(normalizeColorScheme('light')).toBe('light')
    expect(normalizeColorScheme('dark')).toBe('dark')
    expect(normalizeColorScheme(null)).toBe('dark')
    expect(mobileThemeTokens('dark', 'claude').scheme).toBe('dark')
    expect(mobileThemeTokens('light', 'claude').scheme).toBe('light')
  })

  it('keeps one shell palette for every harness, and only the hue differs', () => {
    const claude = mobileThemeTokens('light', 'claude')
    const codex = mobileThemeTokens('light', 'codex')
    // The hue reaches the transcript through `mobileWebViewTheme`; the shell must
    // not restyle itself per harness, or one app looks like six.
    expect(claude.brandHue).toBe(40)
    expect(codex.brandHue).toBe(240)
    expect(claude.colors).toEqual(codex.colors)
    expect(mobileThemeTokens('dark', 'claude').colors).toEqual(mobileThemeTokens('dark', 'codex').colors)
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

describe('host brand hue', () => {
  it('falls back to the built-in hue when the host has no override', () => {
    expect(resolveBrandHue('claude', null)).toBe(40)
    expect(resolveBrandHue('claude', undefined)).toBe(40)
    expect(mobileThemeTokens('light', 'claude', null).brandHue).toBe(40)
  })

  it('takes the host hue when there is one', () => {
    expect(mobileThemeTokens('light', 'claude', 210).brandHue).toBe(210)
  })

  it('wraps a hue outside 0–360 instead of handing the WebView an odd angle', () => {
    expect(resolveBrandHue('claude', 400)).toBe(40)
    expect(resolveBrandHue('claude', -30)).toBe(330)
  })

  it('ignores a value that is not a finite number', () => {
    expect(resolveBrandHue('codex', Number.NaN)).toBe(240)
    expect(resolveBrandHue('codex', 'blue' as unknown as number)).toBe(240)
  })

  it('leaves the shell palette alone — only the transcript reads the hue', () => {
    const base = mobileThemeTokens('light', 'claude')
    const shifted = mobileThemeTokens('light', 'claude', 210)
    expect(shifted.colors).toEqual(base.colors)
    expect(mobileWebViewTheme(shifted).hue).toBe(210)
  })
})
