import type { ITheme } from '@xterm/xterm'

const LIGHT_ANSI: Partial<ITheme> = {
  black: '#33312e',
  red: '#c0392b',
  green: '#1e7a3e',
  yellow: '#9a6a00',
  blue: '#2a6fb0',
  magenta: '#9b59b6',
  cyan: '#1b8a8a',
  white: '#6b6760',
  brightBlack: '#8a857c',
  brightRed: '#e74c3c',
  brightGreen: '#27ae60',
  brightYellow: '#c98a00',
  brightBlue: '#3b8fd6',
  brightMagenta: '#bd76d6',
  brightCyan: '#2bb3b3',
  brightWhite: '#3a3833',
}

let probe: HTMLSpanElement | null = null
let ctx: CanvasRenderingContext2D | null = null

function resolve(varExpr: string): string {
  if (!probe) {
    probe = document.createElement('span')
    probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none'
    document.body.appendChild(probe)
  }
  probe.style.color = varExpr
  const computed = getComputedStyle(probe).color
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return computed
  ctx.fillStyle = '#000000'
  ctx.fillStyle = computed
  return ctx.fillStyle as string
}

function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function getTerminalTheme(): ITheme {
  const isDark = document.documentElement.classList.contains('dark')
  const primary = resolve('var(--primary)')
  const card = resolve('var(--card)')
  const base: ITheme = {
    background: card,
    foreground: resolve('var(--card-foreground)'),
    cursor: primary,
    cursorAccent: card,
    selectionBackground: withAlpha(primary, 0.3),
  }
  return isDark ? base : { ...base, ...LIGHT_ANSI }
}

export function onTerminalThemeChange(cb: () => void): () => void {
  let raf = 0
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(cb)
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-harness'],
  })
  return () => {
    cancelAnimationFrame(raf)
    observer.disconnect()
  }
}
