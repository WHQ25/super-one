import { memo, useMemo } from 'react'

const ANSI_COLORS: Record<number, string> = {
  30: '#484848', 31: '#f87171', 32: '#4ade80', 33: '#facc15',
  34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#d4d4d8',
  90: '#71717a', 91: '#fca5a5', 92: '#86efac', 93: '#fde68a',
  94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff',
}

const ANSI_TW: Record<number, string> = {
  30: 'text-zinc-900', 31: 'text-red-400', 32: 'text-green-400', 33: 'text-yellow-400',
  34: 'text-blue-400', 35: 'text-purple-400', 36: 'text-cyan-400', 37: 'text-zinc-300',
  90: 'text-zinc-500', 91: 'text-red-300', 92: 'text-green-300', 93: 'text-yellow-300',
  94: 'text-blue-300', 95: 'text-purple-300', 96: 'text-cyan-300', 97: 'text-white',
}

interface AnsiSpan {
  text: string
  bold: boolean
  dim: boolean
  color: string | null
}

const ESC_RE = /\x1b\[([0-9;]*)m/g

export function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let bold = false
  let dim = false
  let color: string | null = null
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = ESC_RE.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: raw.slice(lastIndex, match.index), bold, dim, color })
    }
    const codes = match[1].split(';').map(Number)
    for (const code of codes) {
      if (code === 0) { bold = false; dim = false; color = null }
      else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 22) { bold = false; dim = false }
      else if (code === 39) color = null
      else if (ANSI_COLORS[code]) color = ANSI_COLORS[code]
    }
    lastIndex = ESC_RE.lastIndex
  }

  if (lastIndex < raw.length) {
    spans.push({ text: raw.slice(lastIndex), bold, dim, color })
  }
  return spans
}

function hasAnsiCodes(text: string): boolean {
  return text.includes('\x1b[')
}

function renderSpans(spans: AnsiSpan[], defaultColor: string): React.ReactNode[] {
  return spans.map((span, i) => {
    const style: React.CSSProperties = {}
    if (span.color) style.color = span.color
    else style.color = defaultColor
    if (span.bold) style.fontWeight = 'bold'
    if (span.dim) style.opacity = 0.6
    return <span key={i} style={style}>{span.text}</span>
  })
}

export const AnsiText = memo(function AnsiText({ text, defaultColor = '#8b949e' }: { text: string; defaultColor?: string }) {
  const nodes = useMemo(() => {
    if (!hasAnsiCodes(text)) return null
    return text.split('\n').map((line, i) => (
      <div key={i}>{line ? renderSpans(parseAnsi(line), defaultColor) : '\u00A0'}</div>
    ))
  }, [text, defaultColor])

  if (!nodes) return <>{text}</>
  return <>{nodes}</>
})

export function parseAnsiToTailwind(raw: string): Array<{ text: string; className: string }> {
  const spans: Array<{ text: string; className: string }> = []
  let currentClass = 'text-zinc-300'
  let lastIndex = 0
  let match: RegExpExecArray | null

  const re = /\x1b\[([0-9;]*)m/g
  while ((match = re.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: raw.slice(lastIndex, match.index), className: currentClass })
    }
    const codes = match[1].split(';').map(Number)
    for (const code of codes) {
      if (code === 0 || code === 39) currentClass = 'text-zinc-300'
      else if (code === 1) currentClass += ' font-bold'
      else if (ANSI_TW[code]) currentClass = ANSI_TW[code]
    }
    lastIndex = re.lastIndex
  }

  if (lastIndex < raw.length) {
    spans.push({ text: raw.slice(lastIndex), className: currentClass })
  }
  return spans
}
