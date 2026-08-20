/** Electron `backgroundMaterial` is documented for Windows 11 22H2+ (build 22621). */
export const WINDOWS_GLASS_MIN_BUILD = 22621

export const GLASS_BACKGROUND = '#00000000'

/** Frosted see-through blur, closest Win11 match to macOS `under-window` vibrancy. */
export const WINDOWS_GLASS_MATERIAL = 'acrylic' as const

export function parseWindowsBuild(release: string): number | null {
  const build = Number(release.split('.')[2])
  return Number.isFinite(build) ? build : null
}

export function isWindowsGlassSupported(platform: string, release: string): boolean {
  if (platform !== 'win32') return false
  const build = parseWindowsBuild(release)
  return build !== null && build >= WINDOWS_GLASS_MIN_BUILD
}

export function isGlassPlatformSupported(platform: string, release: string): boolean {
  return platform === 'darwin' || isWindowsGlassSupported(platform, release)
}

/**
 * Glass no longer requires dark mode. It was gated that way because the old
 * light theme was a warm near-white — the one frosted material macOS 26 offers
 * washed it into grey fog. Light mode now runs a dark sidebar, which is exactly
 * the surface that reads well over frost, so the gate is the setting plus the
 * platform. The light/dark difference lives entirely in the CSS surface colours
 * (`.liquid-glass` vs `.liquid-glass.dark`); the native material is the same
 * either way, and follows the appearance pinned by `syncNativeAppearance()`.
 */
export function isGlassEffectActive(opts: {
  enabled: boolean
  platform: string
  release: string
}): boolean {
  return opts.enabled && isGlassPlatformSupported(opts.platform, opts.release)
}

export function glassConstructorOptions(opts: {
  enabled: boolean
  platform: string
  release: string
}): {
  vibrancy?: 'under-window'
  visualEffectState?: 'active'
  backgroundMaterial?: typeof WINDOWS_GLASS_MATERIAL
  backgroundColor?: string
} {
  if (!isGlassEffectActive(opts)) return {}
  if (opts.platform === 'darwin') {
    return { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: GLASS_BACKGROUND }
  }
  if (opts.platform === 'win32') {
    return { backgroundMaterial: WINDOWS_GLASS_MATERIAL, backgroundColor: GLASS_BACKGROUND }
  }
  return {}
}

export function windowsChromeBackground(opts: {
  glassActive: boolean
  backgroundColor: string
}): string {
  return opts.glassActive ? GLASS_BACKGROUND : opts.backgroundColor
}
