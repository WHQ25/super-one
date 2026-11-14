import type { CSSProperties } from 'react'
import { modColor } from './cells'

export interface ModBackdropGlass {
  blur: number
  opacity: number
  tint?: string
}

export interface ModBackdropProps {
  id?: string
  plugin?: string
  glass: false | ModBackdropGlass
  colorScheme?: 'light' | 'dark'
}

const CSS_COLOR_FN = /^(?:rgb|hsl)a?\(\s*(?:\d+(?:\.\d+)?|\.\d+)%?\s*(?:,\s*|\s+)(?:\d+(?:\.\d+)?|\.\d+)%?\s*(?:,\s*|\s+)(?:\d+(?:\.\d+)?|\.\d+)%?(?:\s*[,/]\s*(?:\d+(?:\.\d+)?|\.\d+)%?)?\s*\)$/i
const OK_COLOR_FN = /^ok(?:lch|lab)\(\s*[^;{}()]+\)$/i
const SAFE_CSS_VAR_NAME = /^--[a-z0-9-]+$/i

const THEME_TOKENS = new Set([
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
  'sidebarBorder',
  'sidebarRing',
  'success',
  'warning',
  'error',
  'highlighted',
])

const MOD_PALETTE_KEYS = new Set(['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'])

const THEME_ALIASES: Record<string, string> = {
  claude: '--primary',
  text: '--foreground',
  secondaryText: '--muted-foreground',
  inactive: '--muted-foreground',
  subtle: '--muted-foreground',
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function toKebab(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

export function safeModCssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) return undefined
  if (trimmed === 'transparent') return 'transparent'
  const mapped = modColor(trimmed)
  if (mapped) return mapped
  if (CSS_COLOR_FN.test(trimmed) || OK_COLOR_FN.test(trimmed)) return trimmed
  return undefined
}

export function modPaneBackground(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return safeModCssColor(value)
}

export function parseModThemeStyle(props: Record<string, unknown>, scheme: 'light' | 'dark'): CSSProperties {
  const rawColors = props.colors
  if (!isPlainRecord(rawColors)) return {}
  const scoped = isPlainRecord(rawColors[scheme]) ? (rawColors[scheme] as Record<string, unknown>) : rawColors
  const style: Record<string, string> = {}
  const aliasValues: Array<[string, string]> = []

  for (const [key, val] of Object.entries(scoped)) {
    const color = safeModCssColor(val)
    if (!color) continue
    if (SAFE_CSS_VAR_NAME.test(key)) {
      style[key] = color
    } else if (THEME_TOKENS.has(key)) {
      style[`--${toKebab(key)}`] = color
    } else if (MOD_PALETTE_KEYS.has(key)) {
      style[`--mod-${key}`] = color
    } else if (THEME_ALIASES[key]) {
      aliasValues.push([THEME_ALIASES[key], color])
    }
  }

  for (const [cssVar, color] of aliasValues) {
    if (!style[cssVar]) style[cssVar] = color
  }

  return style as CSSProperties
}

/** Where a mod theme is allowed to show. Narrower scopes block wider ones. */
export type ModThemeScope = 'session' | 'folder' | 'project' | 'harness'

/**
 * Scope from a theme or backdrop payload. Absent means the host must keep the
 * update on the session that received it. `global` is the harness-wide scope.
 */
export function parseModThemeScope(props: Record<string, unknown> | null | undefined): ModThemeScope | undefined {
  if (!isPlainRecord(props)) return undefined
  const raw = props.scope ?? props.applyScope ?? props.themeScope
  if (raw === 'session' || raw === 'folder' || raw === 'project' || raw === 'harness') return raw
  if (raw === 'global') return 'harness'
  return undefined
}

export function parseModBackdropProps(props: Record<string, unknown>): ModBackdropProps | null {
  if (!isPlainRecord(props)) return null
  const id = typeof props.id === 'string' ? props.id : undefined
  const plugin = typeof props.plugin === 'string' ? props.plugin : undefined
  const rawScheme = props.colorScheme ?? props.overrideColorScheme
  const colorScheme = rawScheme === 'light' || rawScheme === 'dark' ? rawScheme : undefined
  const rawGlass = props.glass
  let glass: false | ModBackdropGlass = { blur: 16, opacity: 0.6 }
  if (rawGlass === false) {
    glass = false
  } else if (isPlainRecord(rawGlass)) {
    const blur = typeof rawGlass.blur === 'number' && Number.isFinite(rawGlass.blur) ? Math.min(64, Math.max(0, rawGlass.blur)) : 16
    const opacity = typeof rawGlass.opacity === 'number' && Number.isFinite(rawGlass.opacity) ? Math.min(1, Math.max(0, rawGlass.opacity)) : 0.6
    const tint = safeModCssColor(rawGlass.tint)
    glass = { blur, opacity, ...(tint ? { tint } : {}) }
  }
  return { id, plugin, glass, colorScheme }
}

export function modBackdropGlassStyle(glass: false | ModBackdropGlass): CSSProperties | undefined {
  if (glass === false) return undefined
  const pct = Math.round(glass.opacity * 100)
  const base = glass.tint ?? 'var(--background)'
  return {
    backgroundColor: `color-mix(in srgb, ${base} ${pct}%, transparent)`,
    ...(glass.blur > 0 ? { backdropFilter: `blur(${glass.blur}px)`, WebkitBackdropFilter: `blur(${glass.blur}px)` } : {}),
  }
}
