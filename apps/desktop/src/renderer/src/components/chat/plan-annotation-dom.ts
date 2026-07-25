/** DOM helpers for sticky plan-review annotations on rendered markdown. */

export interface RectBox {
  top: number
  left: number
  width: number
  height: number
}

export interface AnnotationLayout {
  rects: RectBox[]
  /** Top-right corner of the last highlight rect (for the sticky icon). */
  marker: { top: number; left: number }
  /** Preferred floating editor origin (below-right of selection). */
  editor: { top: number; left: number }
}

type TextPart = { node: Text; start: number; text: string }

function collectTextParts(root: HTMLElement): { parts: TextPart[]; full: string } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const parts: TextPart[] = []
  let full = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    const node = n as Text
    const text = node.textContent ?? ''
    if (!text) continue
    // Skip invisible / pure-whitespace-only? keep for offset fidelity
    parts.push({ node, start: full.length, text })
    full += text
  }
  return { parts, full }
}

function rangeFromOffsets(parts: TextPart[], start: number, end: number): Range | null {
  if (start < 0 || end <= start || parts.length === 0) return null
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  for (const p of parts) {
    const pEnd = p.start + p.text.length
    if (!startNode && start < pEnd) {
      startNode = p.node
      startOffset = Math.max(0, start - p.start)
    }
    if (end <= pEnd) {
      endNode = p.node
      endOffset = Math.max(0, end - p.start)
      break
    }
  }
  if (!startNode || !endNode) {
    const last = parts[parts.length - 1]!
    if (!startNode) return null
    endNode = last.node
    endOffset = last.text.length
  }
  try {
    const range = document.createRange()
    range.setStart(startNode, Math.min(startOffset, startNode.length))
    range.setEnd(endNode, Math.min(endOffset, endNode.length))
    return range
  } catch {
    return null
  }
}

/** Find a Range for `quote` inside `root` (exact, then whitespace-collapsed). */
export function findTextRange(root: HTMLElement, quote: string): Range | null {
  const q = quote.replace(/\r\n/g, '\n')
  const trimmed = q.trim()
  if (!trimmed) return null
  const { parts, full } = collectTextParts(root)
  if (!full) return null

  let idx = full.indexOf(q)
  let len = q.length
  if (idx < 0) {
    idx = full.indexOf(trimmed)
    len = trimmed.length
  }
  if (idx >= 0) return rangeFromOffsets(parts, idx, idx + len)

  // Whitespace-collapsed match
  const map: number[] = []
  let norm = ''
  for (let i = 0; i < full.length; i++) {
    const ch = full[i]!
    if (/\s/.test(ch)) {
      if (norm.endsWith(' ')) continue
      map.push(i)
      norm += ' '
    } else {
      map.push(i)
      norm += ch
    }
  }
  const nq = trimmed.replace(/\s+/g, ' ')
  const ni = norm.indexOf(nq)
  if (ni < 0 || map.length === 0) return null
  const startSrc = map[ni] ?? -1
  const endKey = Math.min(map.length - 1, ni + nq.length - 1)
  const endSrc = (map[endKey] ?? startSrc) + 1
  if (startSrc < 0) return null
  return rangeFromOffsets(parts, startSrc, endSrc)
}

export function rangeToLayout(range: Range, container: HTMLElement): AnnotationLayout | null {
  const cRect = container.getBoundingClientRect()
  const scrollTop = container.scrollTop
  const scrollLeft = container.scrollLeft
  const clientRects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  if (clientRects.length === 0) {
    const r = range.getBoundingClientRect()
    if (r.width <= 0 && r.height <= 0) return null
    clientRects.push(r)
  }
  const rects: RectBox[] = clientRects.map((r) => ({
    top: r.top - cRect.top + scrollTop,
    left: r.left - cRect.left + scrollLeft,
    width: r.width,
    height: r.height,
  }))
  const last = rects[rects.length - 1]!
  const first = rects[0]!
  return {
    rects,
    marker: {
      top: Math.max(0, last.top - 4),
      left: last.left + last.width - 2,
    },
    editor: {
      top: first.top + first.height + 6,
      left: Math.max(8, first.left),
    },
  }
}

export function layoutForQuote(
  root: HTMLElement,
  container: HTMLElement,
  quote: string,
): AnnotationLayout | null {
  const range = findTextRange(root, quote)
  if (!range) return null
  return rangeToLayout(range, container)
}

/** Build a short display quote for a source line span when DOM selection quote is missing. */
export function quoteFromLines(planContent: string, startLine: number, endLine: number): string {
  const lines = planContent.split('\n')
  if (startLine < 1 || startLine > lines.length) return ''
  const end = Math.min(endLine, lines.length)
  return lines.slice(startLine - 1, end).join('\n').trim()
}
