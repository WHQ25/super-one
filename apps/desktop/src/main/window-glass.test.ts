import { describe, expect, it } from 'vitest'
import {
  GLASS_BACKGROUND,
  WINDOWS_GLASS_MATERIAL,
  glassConstructorOptions,
  isGlassEffectActive,
  isGlassPlatformSupported,
  isWindowsGlassSupported,
  parseWindowsBuild,
  windowsChromeBackground,
} from './window-glass'

describe('parseWindowsBuild', () => {
  it('reads the build from a 10.0.x release string', () => {
    expect(parseWindowsBuild('10.0.22621')).toBe(22621)
    expect(parseWindowsBuild('10.0.19045')).toBe(19045)
  })

  it('returns null for malformed releases', () => {
    expect(parseWindowsBuild('10.0')).toBeNull()
    expect(parseWindowsBuild('')).toBeNull()
  })
})

describe('isWindowsGlassSupported', () => {
  it('requires Windows 11 22H2+', () => {
    expect(isWindowsGlassSupported('win32', '10.0.22621')).toBe(true)
    expect(isWindowsGlassSupported('win32', '10.0.26100')).toBe(true)
    expect(isWindowsGlassSupported('win32', '10.0.22000')).toBe(false)
    expect(isWindowsGlassSupported('win32', '10.0.19045')).toBe(false)
  })

  it('rejects non-Windows platforms', () => {
    expect(isWindowsGlassSupported('darwin', '10.0.22621')).toBe(false)
    expect(isWindowsGlassSupported('linux', '10.0.22621')).toBe(false)
  })
})

describe('isGlassPlatformSupported', () => {
  it('allows macOS and Win11 22H2+', () => {
    expect(isGlassPlatformSupported('darwin', '24.0.0')).toBe(true)
    expect(isGlassPlatformSupported('win32', '10.0.22621')).toBe(true)
    expect(isGlassPlatformSupported('win32', '10.0.19045')).toBe(false)
    expect(isGlassPlatformSupported('linux', '6.8.0')).toBe(false)
  })
})

describe('glassConstructorOptions', () => {
  it('uses under-window vibrancy on macOS when glass is active', () => {
    expect(glassConstructorOptions({
      enabled: true,
      dark: true,
      platform: 'darwin',
      release: '24.0.0',
    })).toEqual({
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: GLASS_BACKGROUND,
    })
  })

  it('uses acrylic on Windows 11 when glass is active', () => {
    expect(glassConstructorOptions({
      enabled: true,
      dark: true,
      platform: 'win32',
      release: '10.0.22621',
    })).toEqual({
      backgroundMaterial: WINDOWS_GLASS_MATERIAL,
      backgroundColor: GLASS_BACKGROUND,
    })
  })

  it('is empty when glass is off, in light theme, or on unsupported Windows', () => {
    expect(glassConstructorOptions({
      enabled: false,
      dark: true,
      platform: 'win32',
      release: '10.0.22621',
    })).toEqual({})
    expect(glassConstructorOptions({
      enabled: true,
      dark: false,
      platform: 'win32',
      release: '10.0.22621',
    })).toEqual({})
    expect(glassConstructorOptions({
      enabled: true,
      dark: true,
      platform: 'win32',
      release: '10.0.19045',
    })).toEqual({})
  })
})

describe('isGlassEffectActive / windowsChromeBackground', () => {
  it('only treats dark + supported + enabled as active', () => {
    expect(isGlassEffectActive({
      enabled: true,
      dark: true,
      platform: 'win32',
      release: '10.0.22621',
    })).toBe(true)
    expect(isGlassEffectActive({
      enabled: true,
      dark: false,
      platform: 'win32',
      release: '10.0.22621',
    })).toBe(false)
  })

  it('makes the Windows title-bar overlay transparent while glass is active', () => {
    expect(windowsChromeBackground({ glassActive: true, backgroundColor: '#0a0a0a' })).toBe(GLASS_BACKGROUND)
    expect(windowsChromeBackground({ glassActive: false, backgroundColor: '#0a0a0a' })).toBe('#0a0a0a')
  })
})
