/** DOM helpers for in-text sticky plan annotations (real <mark> highlights). */

export const STICKY_ID_ATTR = 'data-plan-sticky-id'
export const STICKY_DRAFT_ATTR = 'data-plan-sticky-draft'

export const STICKY_MARK_CLASS =
  'plan-sticky-mark rounded-[2px] bg-yellow-300/55 text-inherit dark:bg-yellow-400/25 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]'

export const STICKY_DRAFT_CLASS =
  'plan-sticky-draft rounded-[2px] bg-amber-300/70 text-inherit ring-1 ring-amber-400/50 dark:bg-amber-400/30 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]'

type TextPart = { node: Text; start: number; text: string }

function collectTextParts(root: HTMLElement): { parts: TextPart[]; full: string } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip text already inside our marks when rebuilding? We clear first.
      return node.parentElement?.closest(`mark[${STICKY_ID_ATTR}], mark[${STICKY_DRAFT_ATTR}]`)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  // FILTER_REJECT on parent mark - walker may not work that way on acceptNode for parent.
  // Simpler: collect all text, clear marks first before find.
  const parts: TextPart[] = []
  let full = ''
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = w.nextNode())) {
    const node = n as Text
    if (node.parentElement?.closest(`mark[${STICKY_ID_ATTR}], mark[${STICKY_DRAFT_ATTR}]`)) {
      continue
    }
    const text = node.textContent ?? ''
    if (!text) continue
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
  if (!startNode) return null
  if (!endNode) {
    const last = parts[parts.length - 1]!
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

/** Unwrap sticky marks and normalize text nodes. */
export function clearStickyMarks(root: HTMLElement): void {
  const marks = [
    ...root.querySelectorAll(`mark[${STICKY_ID_ATTR}], mark[${STICKY_DRAFT_ATTR}]`),
  ] as HTMLElement[]
  for (const el of marks) {
    const parent = el.parentNode
    if (!parent) continue
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  }
  root.normalize()
}

function wrapRange(range: Range, mark: HTMLElement): HTMLElement | null {
  try {
    range.surroundContents(mark)
    return mark
  } catch {
    try {
      const contents = range.extractContents()
      mark.appendChild(contents)
      range.insertNode(mark)
      return mark
    } catch {
      return null
    }
  }
}

export function wrapQuoteAsMark(
  root: HTMLElement,
  quote: string,
  attrs: { id?: string; draft?: boolean },
): HTMLElement | null {
  const range = findTextRange(root, quote)
  if (!range || range.collapsed) return null
  const mark = document.createElement('mark')
  if (attrs.draft) {
    mark.setAttribute(STICKY_DRAFT_ATTR, '1')
    mark.className = STICKY_DRAFT_CLASS
  } else {
    mark.setAttribute(STICKY_ID_ATTR, attrs.id ?? '')
    mark.className = STICKY_MARK_CLASS
  }
  return wrapRange(range, mark)
}

export interface StickyAnchor {
  /** Position relative to `container` (for absolute notes). */
  top: number
  left: number
  /** Mark height — useful for stacking. */
  markHeight: number
  markWidth: number
}

/** Anchor a sticky note at the end of a mark (in-flow highlight → correct coords). */
export function anchorBesideMark(mark: HTMLElement, container: HTMLElement): StickyAnchor {
  const m = mark.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  const top = m.top - c.top + container.scrollTop
  // Prefer just to the right of the last line of the mark; fall back below if cramped.
  const left = m.right - c.left + container.scrollLeft + 8
  return {
    top: Math.max(0, top - 4),
    left: Math.max(8, left),
    markHeight: m.height,
    markWidth: m.width,
  }
}

export function getMarkByCommentId(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`mark[${STICKY_ID_ATTR}="${CSS.escape(id)}"]`)
}

export function getDraftMark(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`mark[${STICKY_DRAFT_ATTR}]`)
}

/**
 * Re-apply marks for saved comments + optional draft quote.
 * Call after markdown paint. Returns map of commentId → mark element.
 */
export function applyStickyMarks(
  root: HTMLElement,
  items: Array<{ id: string; quote: string }>,
  draftQuote?: string | null,
): { marks: Record<string, HTMLElement>; draftMark: HTMLElement | null } {
  clearStickyMarks(root)
  const marks: Record<string, HTMLElement> = {}
  // Longer quotes first so short quotes don't steal a prefix of a longer one.
  const sorted = [...items]
    .filter((i) => i.quote.trim())
    .sort((a, b) => b.quote.length - a.quote.length)
  for (const item of sorted) {
    const el = wrapQuoteAsMark(root, item.quote, { id: item.id })
    if (el) marks[item.id] = el
  }
  let draftMark: HTMLElement | null = null
  if (draftQuote?.trim()) {
    draftMark = wrapQuoteAsMark(root, draftQuote, { draft: true })
  }
  return { marks, draftMark }
}

export function quoteFromLines(planContent: string, startLine: number, endLine: number): string {
  const lines = planContent.split('\n')
  if (startLine < 1 || startLine > lines.length) return ''
  const end = Math.min(endLine, lines.length)
  return lines.slice(startLine - 1, end).join('\n').trim()
}
