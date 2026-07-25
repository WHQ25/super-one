/**
 * Plan-review feedback formatting shared by Claude and Grok.
 *
 * Both backends only accept a free-form string (Claude deny message /
 * Grok exit_plan_mode `feedback`). Line comments are serialized into that
 * string — matching Grok Build's `format_feedback` shape so agents understand
 * quoted plan snippets.
 */

export interface PlanLineComment {
  id: string
  /** 1-based inclusive start line in planContent. */
  startLine: number
  /** 1-based inclusive end line in planContent. */
  endLine: number
  text: string
}

/** Split plan body into display lines (keeps empty trailing line if present). */
export function splitPlanLines(planContent: string): string[] {
  if (!planContent) return []
  // Preserve final empty line when content ends with \n (common for files).
  return planContent.split('\n')
}

export function inlinePlanSnippets(planContent: string, startLine: number, endLine: number): string {
  const lines = splitPlanLines(planContent)
  if (startLine < 1 || endLine < startLine || startLine > lines.length) {
    return '> [selected lines unavailable]'
  }
  const end = Math.min(endLine, lines.length)
  return lines
    .slice(startLine - 1, end)
    .map((line) => `> ${line}`)
    .join('\n')
}

function formatOneComment(planContent: string, comment: PlanLineComment): string {
  const start = comment.startLine
  const end = comment.endLine
  const label =
    start === end
      ? `Proposed plan line ${start}:`
      : `Proposed plan lines ${start}-${end}:`
  const snippets = inlinePlanSnippets(planContent, start, end)
  return `${label}\n${snippets}\n\nComment:\n${comment.text}`
}

/**
 * Compose line comments + optional freeform into one feedback string.
 * Empty result when nothing to send.
 */
export function formatPlanFeedback(
  planContent: string,
  comments: readonly PlanLineComment[],
  freeform?: string | null,
): string {
  const parts: string[] = []
  for (const c of comments) {
    const text = c.text.trim()
    if (!text) continue
    parts.push(formatOneComment(planContent, { ...c, text }))
  }
  const free = freeform?.trim() ?? ''
  if (free) {
    if (parts.length > 0) {
      parts.push(`Additional feedback:\n${free}`)
    } else {
      parts.push(free)
    }
  }
  return parts.join('\n\n')
}

/** Grok-style wrap when user approved *with* review comments (sent as follow-up user turn). */
export function formatApprovedPlanReviewMessage(feedback: string): string {
  const body = feedback.trim()
  if (!body) return ''
  return `The user approved the plan with the following review comments:\n\n${body}`
}

export function normalizeLineRange(a: number, b: number): { startLine: number; endLine: number } {
  return a <= b ? { startLine: a, endLine: b } : { startLine: b, endLine: a }
}

function offsetsToLineRange(content: string, start: number, end: number): { startLine: number; endLine: number } {
  const startLine = content.slice(0, start).split('\n').length
  // end is exclusive; last included char is end - 1 (or start when empty)
  const last = Math.max(start, end - 1)
  const endLine = content.slice(0, last + 1).split('\n').length
  return normalizeLineRange(startLine, endLine)
}

/** Soften markdown decoration so rendered selection text can match source. */
export function stripMdDecorations(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`#>|[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Map a user text selection (often from rendered markdown) back to 1-based
 * inclusive source line numbers in `planContent`.
 */
export function selectionTextToLineRange(
  planContent: string,
  selectedText: string,
): { startLine: number; endLine: number } | null {
  if (!planContent) return null
  const selected = selectedText.replace(/\r\n/g, '\n')
  const trimmed = selected.trim()
  if (!trimmed) return null

  const exactIdx = planContent.indexOf(selected)
  if (exactIdx >= 0) return offsetsToLineRange(planContent, exactIdx, exactIdx + selected.length)

  const trimIdx = planContent.indexOf(trimmed)
  if (trimIdx >= 0) return offsetsToLineRange(planContent, trimIdx, trimIdx + trimmed.length)

  // Whitespace-collapsed exact match in source
  const wsNorm = (s: string) => s.replace(/\s+/g, ' ')
  const nContent = wsNorm(planContent)
  const nSel = wsNorm(trimmed)
  const nIdx = nContent.indexOf(nSel)
  if (nIdx >= 0) {
    // Approximate: map by walking source with collapsed spaces
    let src = 0
    let nPos = 0
    let startSrc = -1
    let endSrc = -1
    while (src < planContent.length && nPos < nContent.length) {
      const ch = planContent[src]!
      if (/\s/.test(ch)) {
        // skip all whitespace in both
        while (src < planContent.length && /\s/.test(planContent[src]!)) src++
        if (nPos < nContent.length && nContent[nPos] === ' ') nPos++
        continue
      }
      if (nPos === nIdx && startSrc < 0) startSrc = src
      if (startSrc >= 0 && nPos === nIdx + nSel.length - 1) {
        endSrc = src + 1
        break
      }
      src++
      nPos++
    }
    if (startSrc >= 0) {
      if (endSrc < 0) endSrc = planContent.length
      return offsetsToLineRange(planContent, startSrc, endSrc)
    }
  }

  // Soft markdown match: find best contiguous line span whose stripped join
  // is contained in (or contains) the stripped selection.
  const lines = splitPlanLines(planContent)
  const selKey = stripMdDecorations(trimmed)
  if (!selKey) return null

  let best: { start: number; end: number; score: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    let acc = ''
    for (let j = i; j < lines.length; j++) {
      const piece = stripMdDecorations(lines[j] ?? '')
      if (piece) acc = acc ? `${acc} ${piece}` : piece
      if (!acc) continue
      const contained = selKey.includes(acc) || acc.includes(selKey)
      if (contained) {
        const score = Math.min(acc.length, selKey.length)
        if (!best || score > best.score) best = { start: i + 1, end: j + 1, score }
      }
      // Stop expanding when accumulator is far longer than selection and not matching.
      if (acc.length > selKey.length + 40 && !selKey.includes(acc.slice(0, Math.min(acc.length, selKey.length)))) {
        break
      }
    }
  }
  return best ? normalizeLineRange(best.start, best.end) : null
}
