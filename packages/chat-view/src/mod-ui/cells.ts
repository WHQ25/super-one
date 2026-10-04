import type { CSSProperties } from 'react'
import type { ModDecoration, ModPrimitive } from '@superone/shared/mod-ui'

/**
 * Mods lay out in character cells of the code font (Ink's model). A column is
 * `1ch`; a row is one code line, `--mod-row` (set by the site frame to the
 * code line-height). Percent strings pass through; no other string does, so a
 * size stays relative to the box the mod draws in (no `100vw`).
 */
export const MOD_ROW = 'var(--mod-row, 1.5em)'

const percent = (v: string) => (/^\d+(?:\.\d+)?%$/.test(v) ? v : undefined)
export const cols = (v: ModPrimitive | undefined) => (typeof v === 'number' ? `${v}ch` : typeof v === 'string' ? percent(v) : undefined)
export const rows = (v: ModPrimitive | undefined) => (typeof v === 'number' ? `calc(${v} * ${MOD_ROW})` : typeof v === 'string' ? percent(v) : undefined)

/** Ink / Claude Code theme keys and terminal color names, as theme-aware CSS colors. */
const NAMED_COLORS: Record<string, string> = {
  // Claude Code theme keys
  claude: 'var(--primary)',
  text: 'var(--foreground)',
  secondaryText: 'var(--muted-foreground)',
  inactive: 'var(--muted-foreground)',
  subtle: 'var(--muted-foreground)',
  success: 'var(--mod-green)',
  error: 'var(--mod-red)',
  warning: 'var(--mod-yellow)',
  permission: 'var(--mod-blue)',
  suggestion: 'var(--mod-blue)',
  remember: 'var(--mod-blue)',
  diffAdded: 'var(--mod-green)',
  diffRemoved: 'var(--mod-red)',
  // Terminal color names
  black: 'var(--foreground)',
  white: 'var(--background)',
  gray: 'var(--muted-foreground)',
  grey: 'var(--muted-foreground)',
  red: 'var(--mod-red)',
  green: 'var(--mod-green)',
  yellow: 'var(--mod-yellow)',
  blue: 'var(--mod-blue)',
  magenta: 'var(--mod-magenta)',
  cyan: 'var(--mod-cyan)',
  redBright: 'var(--mod-red)',
  greenBright: 'var(--mod-green)',
  yellowBright: 'var(--mod-yellow)',
  blueBright: 'var(--mod-blue)',
  magentaBright: 'var(--mod-magenta)',
  cyanBright: 'var(--mod-cyan)',
  whiteBright: 'var(--background)',
  blackBright: 'var(--muted-foreground)',
}

/** The palette behind the terminal names; readable on both themes. */
export const MOD_PALETTE_STYLE: CSSProperties = {
  ['--mod-red' as string]: '#e5484d',
  ['--mod-green' as string]: '#30a46c',
  ['--mod-yellow' as string]: '#d4a72c',
  ['--mod-blue' as string]: '#3e8ed0',
  ['--mod-magenta' as string]: '#c2298a',
  ['--mod-cyan' as string]: '#0e9eb0',
}

export function modColor(value: ModPrimitive | undefined): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (NAMED_COLORS[value]) return NAMED_COLORS[value]
  if (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([\d\s.,%]+\)$/i.test(value)) return value
  const ansi = /^ansi256\((\d{1,3})\)$/.exec(value)
  if (ansi) return ansi256(Number(ansi[1]))
  return undefined
}

function ansi256(n: number): string | undefined {
  if (n < 16) return ['var(--foreground)', 'var(--mod-red)', 'var(--mod-green)', 'var(--mod-yellow)', 'var(--mod-blue)', 'var(--mod-magenta)', 'var(--mod-cyan)', 'var(--background)'][n % 8]
  if (n < 232) {
    const i = n - 16
    const c = (x: number) => (x === 0 ? 0 : 55 + x * 40)
    return `rgb(${c(Math.floor(i / 36))}, ${c(Math.floor(i / 6) % 6)}, ${c(i % 6)})`
  }
  if (n < 256) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v}, ${v}, ${v})`
  }
  return undefined
}

function border(style: ModPrimitive | undefined, color: string | undefined, dim: boolean): CSSProperties {
  if (typeof style !== 'string' || !style) return {}
  const width = style === 'bold' ? '2px' : style === 'double' ? '3px' : '1px'
  const line = style === 'double' ? 'double' : style === 'classic' ? 'dashed' : 'solid'
  return {
    border: `${width} ${line} ${color ?? 'var(--border)'}`,
    borderRadius: style === 'round' ? '0.5em' : undefined,
    ...(dim && !color ? { borderColor: 'color-mix(in srgb, var(--border) 60%, transparent)' } : {}),
  }
}

/** CSS for a `Box`'s allowlisted props. Ink boxes are flex rows by default. */
export function boxStyle(p: Record<string, ModPrimitive> = {}): CSSProperties {
  const style: CSSProperties = {
    display: p.display === 'none' ? 'none' : 'flex',
    flexDirection: (p.flexDirection as CSSProperties['flexDirection']) ?? 'row',
    flexGrow: typeof p.flexGrow === 'number' ? p.flexGrow : undefined,
    flexShrink: typeof p.flexShrink === 'number' ? p.flexShrink : undefined,
    flexWrap: p.flexWrap as CSSProperties['flexWrap'],
    alignItems: p.alignItems as CSSProperties['alignItems'],
    alignSelf: p.alignSelf as CSSProperties['alignSelf'],
    justifyContent: p.justifyContent as CSSProperties['justifyContent'],
    columnGap: cols(p.columnGap ?? p.gap),
    rowGap: rows(p.rowGap ?? p.gap),
    width: cols(p.width),
    height: rows(p.height),
    minWidth: cols(p.minWidth),
    minHeight: rows(p.minHeight),
    overflow: p.overflow === 'hidden' ? 'hidden' : undefined,
    backgroundColor: modColor(p.backgroundColor),
    position: p.position === 'absolute' ? 'absolute' : p.position === 'relative' ? 'relative' : undefined,
    top: rows(p.top),
    bottom: rows(p.bottom),
    left: cols(p.left),
    right: cols(p.right),
    minInlineSize: 0,
    ...border(p.borderStyle, modColor(p.borderColor), p.borderDimColor === true),
  }
  const pad = (v: ModPrimitive | undefined, axis: 'x' | 'y') => (axis === 'x' ? cols(v) : rows(v))
  style.paddingTop = pad(p.paddingTop ?? p.paddingY ?? p.padding, 'y')
  style.paddingBottom = pad(p.paddingBottom ?? p.paddingY ?? p.padding, 'y')
  style.paddingLeft = pad(p.paddingLeft ?? p.paddingX ?? p.padding, 'x')
  style.paddingRight = pad(p.paddingRight ?? p.paddingX ?? p.padding, 'x')
  style.marginTop = pad(p.marginTop ?? p.marginY ?? p.margin, 'y')
  style.marginBottom = pad(p.marginBottom ?? p.marginY ?? p.margin, 'y')
  style.marginLeft = pad(p.marginLeft ?? p.marginX ?? p.margin, 'x')
  style.marginRight = pad(p.marginRight ?? p.marginX ?? p.margin, 'x')
  return style
}

/** CSS for a `Text`'s allowlisted props. */
export function textStyle(p: Record<string, ModPrimitive> = {}): CSSProperties {
  let color = modColor(p.color)
  let background = modColor(p.backgroundColor)
  if (p.inverse === true) {
    ;[color, background] = [background ?? 'var(--background)', color ?? 'var(--foreground)']
  }
  const decorations = [p.underline === true && 'underline', p.strikethrough === true && 'line-through'].filter(Boolean).join(' ')
  const wrap = typeof p.wrap === 'string' ? p.wrap : 'wrap'
  const truncate = wrap.startsWith('truncate') || wrap === 'end' || wrap === 'middle'
  return {
    color,
    backgroundColor: background,
    fontWeight: p.bold === true ? 600 : undefined,
    fontStyle: p.italic === true ? 'italic' : undefined,
    textDecorationLine: decorations || undefined,
    opacity: p.dimColor === true ? 0.62 : undefined,
    whiteSpace: truncate ? 'pre' : 'pre-wrap',
    overflowWrap: truncate ? undefined : 'anywhere',
    overflow: truncate ? 'hidden' : undefined,
    textOverflow: truncate ? 'ellipsis' : undefined,
    direction: wrap === 'truncate-start' ? 'rtl' : undefined,
    minWidth: 0,
  }
}

/**
 * One cell of the code font in CSS pixels: what a column (`1ch`) and a row
 * (the code line-height) measure where the mod draws. Cached per document.
 */
let cellCache: { width: number; height: number } | null = null
export function measureCell(doc: Document = document): { width: number; height: number } {
  if (cellCache) return cellCache
  const probe = doc.createElement('span')
  probe.className = 'font-mono text-xs leading-[1.5]'
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px'
  probe.textContent = '0'.repeat(10)
  doc.body.appendChild(probe)
  const rect = probe.getBoundingClientRect()
  probe.remove()
  cellCache = rect.width > 0 ? { width: rect.width / 10, height: rect.height || 18 } : { width: 7.2, height: 18 }
  return cellCache
}

/** The window as a mod sees it: its size in cells, and whether the surface docks panes. */
export function windowViewport(isFullscreen: boolean): { columns: number; rows: number; isFullscreen: boolean } {
  const cell = measureCell()
  return {
    columns: Math.max(1, Math.floor(window.innerWidth / cell.width)),
    rows: Math.max(1, Math.floor(window.innerHeight / cell.height)),
    isFullscreen,
  }
}

/** Inline CSS for a plugin's prompt decoration run (`$.prompt.fill` / `ui_prompt_edit`). */
export function decorationStyle(d: ModDecoration): string {
  const parts: string[] = []
  const color = modColor(d.color)
  const background = modColor(d.backgroundColor)
  if (color) parts.push(`color:${color}`)
  if (background) parts.push(`background-color:${background}`)
  if (d.bold) parts.push('font-weight:600')
  if (d.italic) parts.push('font-style:italic')
  const lines = [d.underline && 'underline', d.strikethrough && 'line-through'].filter(Boolean)
  if (lines.length) parts.push(`text-decoration:${lines.join(' ')}`)
  if (d.dimColor) parts.push('opacity:0.62')
  return parts.join(';')
}
