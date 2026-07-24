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
