import { describe, expect, it } from 'vitest'
import { shouldApplyLiquidGlassClass } from './liquid-glass-platform'

describe('shouldApplyLiquidGlassClass', () => {
  it('follows the explicit capability flag', () => {
    expect(shouldApplyLiquidGlassClass(true, { supportsLiquidGlass: true, platform: 'win32' })).toBe(true)
    expect(shouldApplyLiquidGlassClass(true, { supportsLiquidGlass: false, platform: 'win32' })).toBe(false)
    expect(shouldApplyLiquidGlassClass(false, { supportsLiquidGlass: true, platform: 'win32' })).toBe(false)
  })

  it('falls back to macOS-only when the host omitted the flag', () => {
    expect(shouldApplyLiquidGlassClass(true, { platform: 'darwin' })).toBe(true)
    expect(shouldApplyLiquidGlassClass(true, { platform: 'win32' })).toBe(false)
  })

  it('honors the store when no host API is present (tests)', () => {
    expect(shouldApplyLiquidGlassClass(true)).toBe(true)
    expect(shouldApplyLiquidGlassClass(true, null)).toBe(true)
  })
})
