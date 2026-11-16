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

/**
 * Color the shell can mix into the sidebar and activity panel.
 * Glass tint wins. Otherwise the backdrop tree's own background is used.
 */
export function modBackdropTint(snapshot: {
  result: { props?: Record<string, unknown> | null; tree?: unknown }
} | null | undefined): string | undefined {
  if (!snapshot?.result) return undefined
  const props = snapshot.result.props
  if (isPlainRecord(props)) {
    const parsed = parseModBackdropProps(props)
    if (parsed?.glass && parsed.glass.tint) return parsed.glass.tint
  }
  const tree = snapshot.result.tree
  if (!isPlainRecord(tree) || !isPlainRecord(tree.props)) return undefined
  const style = tree.props.style
  if (!isPlainRecord(style)) return undefined
  return safeModCssColor(style.backgroundColor) ?? safeModCssColor(style.background)
}

/** Light tints need dark text. A named scheme wins; otherwise the tint's own brightness decides. */
function schemeFromTint(tint: string | undefined): 'light' | 'dark' | undefined {
  if (!tint) return undefined
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(tint.trim())
  if (!hex) return undefined
  const full = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
  const channel = (pair: string) => {
    const v = parseInt(pair, 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(full.slice(0, 2)) + 0.7152 * channel(full.slice(2, 4)) + 0.0722 * channel(full.slice(4, 6))
  return luminance >= 0.45 ? 'light' : 'dark'
}

export function parseModBackdropProps(props: Record<string, unknown>): ModBackdropProps | null {
  if (!isPlainRecord(props)) return null
  const id = typeof props.id === 'string' ? props.id : undefined
  const plugin = typeof props.plugin === 'string' ? props.plugin : undefined
  const rawScheme = props.colorScheme ?? props.overrideColorScheme ?? props.window
  let colorScheme: 'light' | 'dark' | undefined = rawScheme === 'light' || rawScheme === 'dark' ? rawScheme : undefined
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
  if (!colorScheme && glass !== false) colorScheme = schemeFromTint(glass.tint)
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
