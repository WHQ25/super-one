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
  if (!ctx) ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return computed
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a / 255})`
}

function rgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const short = /^#([0-9a-f]{3})$/i.exec(color)
  if (short) {
    const c = short[1]
    return [c[0], c[1], c[2]].map((h) => parseInt(h + h, 16)) as [number, number, number]
  }
  const fn = /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)/i.exec(color)
  if (fn) return [Math.round(+fn[1]), Math.round(+fn[2]), Math.round(+fn[3])]
  return null
}

function mix(fg: string, bg: string, a: number): string {
  const f = rgb(fg)
  const b = rgb(bg)
  if (!f || !b) return fg
  const c = f.map((v, i) => Math.round(v * a + b[i] * (1 - a)))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
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
    selectionBackground: mix(primary, card, 0.3),
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
