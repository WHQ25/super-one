/** DOM helpers for in-text sticky plan annotations (real <mark> highlights). */

export const STICKY_ID_ATTR = 'data-plan-sticky-id'
export const STICKY_DRAFT_ATTR = 'data-plan-sticky-draft'

/** Classes only — pen-stroke look lives in styles/index.css (.plan-sticky-mark). */
export const STICKY_MARK_CLASS = 'plan-sticky-mark'
export const STICKY_DRAFT_CLASS = 'plan-sticky-mark plan-sticky-draft'

type TextPart = { node: Text; start: number; text: string }

function collectTextParts(root: HTMLElement): { parts: TextPart[]; full: string } {
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

function createMarkEl(attrs: { id?: string; draft?: boolean }): HTMLElement {
  const mark = document.createElement('mark')
  if (attrs.draft) {
    mark.setAttribute(STICKY_DRAFT_ATTR, '1')
    mark.className = STICKY_DRAFT_CLASS
  } else {
    mark.setAttribute(STICKY_ID_ATTR, attrs.id ?? '')
    mark.className = STICKY_MARK_CLASS
  }
  return mark
}

function wrapSingleTextRange(range: Range, mark: HTMLElement): HTMLElement | null {
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

/**
 * Wrap a selection/range as one or more <mark>s — **one per text node**.
 * Never spans block boundaries, so multi-line list selections don't explode <ul>/<li>.
 */
export function wrapRangeAsMarks(
  range: Range,
  attrs: { id?: string; draft?: boolean },
): HTMLElement[] {
  if (range.collapsed) return []

  // Fast path: entirely within one text node.
  if (
    range.startContainer === range.endContainer
    && range.startContainer.nodeType === Node.TEXT_NODE
  ) {
    const mark = createMarkEl(attrs)
    const el = wrapSingleTextRange(range.cloneRange(), mark)
    return el ? [el] : []
  }

  const ancestor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
  if (!ancestor) return []

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (!range.intersectsNode(n)) continue
    const text = n as Text
    if (!text.length) continue
    if (text.parentElement?.closest(`mark[${STICKY_ID_ATTR}], mark[${STICKY_DRAFT_ATTR}]`)) {
      continue
    }
    textNodes.push(text)
  }

  const marks: HTMLElement[] = []
  // End → start so earlier text node offsets stay stable while wrapping.
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const textNode = textNodes[i]!
    let start = 0
    let end = textNode.length

    if (range.startContainer === textNode) start = range.startOffset
    if (range.endContainer === textNode) end = range.endOffset

    // Fully interior text nodes (between start/end containers)
    if (range.startContainer !== textNode && range.endContainer !== textNode) {
      start = 0
      end = textNode.length
    } else if (range.startContainer === textNode && range.endContainer !== textNode) {
      start = range.startOffset
      end = textNode.length
    } else if (range.startContainer !== textNode && range.endContainer === textNode) {
      start = 0
      end = range.endOffset
    }

    if (start >= end) continue
    // Skip pure inter-element whitespace so we don't paint empty list bullets.
    if (!textNode.data.slice(start, end).trim()) continue

    const r = document.createRange()
    r.setStart(textNode, start)
    r.setEnd(textNode, end)
    const mark = createMarkEl(attrs)
    const el = wrapSingleTextRange(r, mark)
    if (el) marks.unshift(el)
  }
  return marks
}

/** Find quote text and wrap safely across lines/blocks. Returns marks in document order. */
export function wrapQuoteAsMarks(
  root: HTMLElement,
  quote: string,
  attrs: { id?: string; draft?: boolean },
): HTMLElement[] {
  const range = findTextRange(root, quote)
  if (!range || range.collapsed) return []
  return wrapRangeAsMarks(range, attrs)
}

/** @deprecated use wrapQuoteAsMarks — kept as first-mark helper */
export function wrapQuoteAsMark(
  root: HTMLElement,
  quote: string,
  attrs: { id?: string; draft?: boolean },
): HTMLElement | null {
  return wrapQuoteAsMarks(root, quote, attrs)[0] ?? null
}

/** Viewport (fixed) coordinates for pin / note placement. */
export interface ViewportCorner {
  top: number
  left: number
}

function collectMarkRects(marks: HTMLElement[]): DOMRect[] {
  const out: DOMRect[] = []
  for (const mark of marks) {
    const rects = [...mark.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    if (rects.length > 0) out.push(...rects)
    else {
      const m = mark.getBoundingClientRect()
      if (m.width > 0 || m.height > 0) out.push(m)
    }
  }
  return out
}

/**
 * Top-right of the **entire selection** (union of all mark fragments):
 * min(top) + max(right) — so multi-line highlights pin to the overall NE corner.
 */
export function selectionTopRightViewport(
  marks: HTMLElement[],
  pinSize = 18,
): ViewportCorner | null {
  const rects = collectMarkRects(marks)
  if (rects.length === 0) return null
  let minTop = Infinity
  let maxRight = -Infinity
  for (const r of rects) {
    minTop = Math.min(minTop, r.top)
    maxRight = Math.max(maxRight, r.right)
  }
  return {
    top: minTop - pinSize / 2,
    left: maxRight - pinSize / 2,
  }
}

/** Viewport band for continuous pen-stroke painting (fixed position). */
export interface HighlightBand {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Build uniform pen strokes from mark fragments.
 * - Same stroke height for every band
 * - Same-line bands with small gaps (e.g. over inline code chips) are merged
 *   so the highlight looks continuous
 */
export function highlightBandsFromMarks(
  marks: HTMLElement[],
  opts?: { lineSlack?: number; gapMerge?: number; strokeRatio?: number },
): HighlightBand[] {
  const lineSlack = opts?.lineSlack ?? 4
  /** Same-line fragments closer than this (px) merge into one continuous stroke. */
  const gapMerge = opts?.gapMerge ?? 30
  /** Stroke thickness as a fraction of line box height (thicker pen). */
  const strokeRatio = opts?.strokeRatio ?? 0.9

  const rects = collectMarkRects(marks)
  if (rects.length === 0) return []

  const heights = rects.map((r) => r.height).sort((a, b) => a - b)
  const lineH = heights[Math.floor(heights.length / 2)] || 16
  const strokeH = Math.max(8, lineH * strokeRatio)

  type Band = HighlightBand & { mid: number }
  const raw: Band[] = rects.map((r) => {
    const top = r.top + (r.height - strokeH) / 2
    return {
      top,
      left: r.left,
      width: r.width,
      height: strokeH,
      mid: top + strokeH / 2,
    }
  })

  raw.sort((a, b) => a.mid - b.mid || a.left - b.left)

  const merged: Band[] = []
  for (const band of raw) {
    const last = merged[merged.length - 1]
    if (
      last
      && Math.abs(last.mid - band.mid) <= lineSlack
      && band.left <= last.left + last.width + gapMerge
    ) {
      const right = Math.max(last.left + last.width, band.left + band.width)
      last.left = Math.min(last.left, band.left)
      last.width = right - last.left
      // Keep shared stroke height + vertical center of the line cluster
      last.height = strokeH
      last.top = (last.mid + band.mid) / 2 - strokeH / 2
      last.mid = last.top + strokeH / 2
    } else {
      merged.push({ ...band })
    }
  }

  return merged.map(({ top, left, width, height }) => ({ top, left, width, height }))
}

/** @deprecated use selectionTopRightViewport on all fragments */
export function markTopRightViewport(mark: HTMLElement, pinSize = 18): ViewportCorner | null {
  return selectionTopRightViewport([mark], pinSize)
}

export function markTopRightFromMarks(marks: HTMLElement[], pinSize = 18): ViewportCorner | null {
  return selectionTopRightViewport(marks, pinSize)
}

export function getMarkByCommentId(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`mark[${STICKY_ID_ATTR}="${CSS.escape(id)}"]`)
}

export function getMarksByCommentId(root: HTMLElement, id: string): HTMLElement[] {
  return [...root.querySelectorAll(`mark[${STICKY_ID_ATTR}="${CSS.escape(id)}"]`)] as HTMLElement[]
}

export function getDraftMark(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`mark[${STICKY_DRAFT_ATTR}]`)
}

export function getDraftMarks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll(`mark[${STICKY_DRAFT_ATTR}]`)] as HTMLElement[]
}

/**
 * Re-apply marks for saved comments + optional draft quote.
 * Returns first mark per id (document-order first fragment) for pin anchoring.
 */
export function applyStickyMarks(
  root: HTMLElement,
  items: Array<{ id: string; quote: string }>,
  draftQuote?: string | null,
): { marks: Record<string, HTMLElement>; draftMark: HTMLElement | null } {
  clearStickyMarks(root)
  const marks: Record<string, HTMLElement> = {}
  const sorted = [...items]
    .filter((i) => i.quote.trim())
    .sort((a, b) => b.quote.length - a.quote.length)
  for (const item of sorted) {
    const els = wrapQuoteAsMarks(root, item.quote, { id: item.id })
    if (els[0]) marks[item.id] = els[0]
  }
  let draftMark: HTMLElement | null = null
  if (draftQuote?.trim()) {
    const els = wrapQuoteAsMarks(root, draftQuote, { draft: true })
    draftMark = els[0] ?? null
  }
  return { marks, draftMark }
}

export function quoteFromLines(planContent: string, startLine: number, endLine: number): string {
  const lines = planContent.split('\n')
  if (startLine < 1 || startLine > lines.length) return ''
  const end = Math.min(endLine, lines.length)
  return lines.slice(startLine - 1, end).join('\n').trim()
}
