import type { McpUiHostContext, McpUiStyles } from '@modelcontextprotocol/ext-apps/app-bridge'

/** Supply resolved CSS values, never framework classes or raw CSS blocks. */
export interface McpAppHostEnvironment {
  theme: 'light' | 'dark'
  platform: 'desktop' | 'mobile' | 'web'
  locale: string
  timeZone: string
  displayMode?: 'inline' | 'fullscreen' | 'pip'
  availableDisplayModes?: Array<'inline' | 'fullscreen' | 'pip'>
  width?: number
  maxHeight?: number
  touch?: boolean
  hover?: boolean
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
  colors?: { background?: string; foreground?: string; muted?: string; mutedForeground?: string; border?: string; primary?: string; primaryForeground?: string; destructive?: string }
  fontFamily?: string
  monoFontFamily?: string
  radius?: string
}

export function mcpAppHostContext(env: McpAppHostEnvironment): McpUiHostContext {
  const variables: Record<string, string> = {}
  const map = {
    background: '--color-background-primary', foreground: '--color-text-primary',
    muted: '--color-background-secondary', mutedForeground: '--color-text-secondary',
    border: '--color-border-primary', primary: '--color-background-info',
    primaryForeground: '--color-text-inverse', destructive: '--color-text-danger',
  } as const
  for (const [key, variable] of Object.entries(map)) {
    const value = env.colors?.[key as keyof typeof map]
    if (value) variables[variable] = value
  }
  if (env.fontFamily) variables['--font-sans'] = env.fontFamily
  if (env.monoFontFamily) variables['--font-mono'] = env.monoFontFamily
  if (env.radius) variables['--border-radius-md'] = env.radius
  return {
    theme: env.theme, platform: env.platform, locale: env.locale, timeZone: env.timeZone,
    userAgent: 'SuperOne', displayMode: env.displayMode ?? 'inline',
    availableDisplayModes: env.availableDisplayModes ?? ['inline'],
    // The spec permits sparse variables; its generated Record type requires every key.
    styles: { variables: variables as McpUiStyles },
    containerDimensions: {
      ...(Number.isFinite(env.width) && env.width! > 0 ? { width: env.width } : {}),
      ...(Number.isFinite(env.maxHeight) && env.maxHeight! > 0 ? { maxHeight: env.maxHeight } : {}),
    },
    deviceCapabilities: { touch: env.touch ?? env.platform === 'mobile', hover: env.hover ?? env.platform === 'desktop' },
    ...(env.safeAreaInsets ? { safeAreaInsets: env.safeAreaInsets } : {}),
  }
}
