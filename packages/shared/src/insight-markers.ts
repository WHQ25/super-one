// Insight blocks arrive as a ★ header line and a ─── footer line. Models emit the
// marker lines bare, wrapped in `code`, or wrapped in **bold** — accept all three,
// on either side, independently. Kept in one place so every renderer surface
// (desktop chat, remote-control blocks, trace converter) agrees on what a marker is.
const WRAP = '(?:\\*\\*|`)?'

export const INSIGHT_HEADER_LINE = new RegExp(`^(.*?)(?:#{1,6}\\s+)?${WRAP}★\\s+(.+?)\\s+─{1,}${WRAP}\\s*$`)
export const INSIGHT_FOOTER_LINE = new RegExp(`^${WRAP}─{3,}${WRAP}\\s*$`)
export const INSIGHT_INLINE_FOOTER_LINE = new RegExp(`^(?!${WRAP}─)(.+?\\S)\\s+${WRAP}─{3,}${WRAP}\\s*$`)
export const INSIGHT_BLOCK_PREFIX = /^[>\s]+$/

export function stripBlockPrefix(line: string, prefix: string): string {
  if (!prefix) return line
  if (line.startsWith(prefix)) return line.slice(prefix.length)
  if (prefix.includes('>')) {
    const m = line.match(/^\s*>\s?/)
    if (m) return line.slice(m[0].length)
  }
  return line
}

export type InsightBodyEnd =
  | { kind: 'footer'; end: number; next: number; inlineContent: string | null }
  | { kind: 'break'; end: number; next: number }
  | { kind: 'none' }

/**
 * Where an insight body ends, given every line after the header (block prefix
 * already stripped). A footer closes it; failing that — the model dropped the
 * footer — the block ends at the first paragraph break, so one malformed block
 * costs one block instead of swallowing the rest of the message. The footer
 * search stops at the next header, otherwise a footerless block would claim the
 * *next* block's footer and the two would collapse into one.
 *
 * `end` is the body index the content stops at; `next` is where the caller resumes.
 * The paragraph-break fallback only applies once the turn is `final` — mid-stream a
 * blank line inside the body is just text the footer has not caught up with yet.
 */
export function findInsightBodyEnd(body: string[], final = true): InsightBodyEnd {
  let boundary = body.length
  for (let i = 0; i < body.length; i++) {
    // Header first: a header line also satisfies the inline-footer shape (prose
    // followed by a dash run), so testing footers first would let the next block's
    // header masquerade as this block's footer.
    if (INSIGHT_HEADER_LINE.test(body[i])) { boundary = i; break }
    if (INSIGHT_FOOTER_LINE.test(body[i])) return { kind: 'footer', end: i, next: i + 1, inlineContent: null }
    const inline = body[i].match(INSIGHT_INLINE_FOOTER_LINE)
    if (inline) return { kind: 'footer', end: i, next: i + 1, inlineContent: inline[1] }
  }
  if (final) {
    for (let i = 0; i < boundary; i++) {
      if (body[i].trim() === '') return i > 0 ? { kind: 'break', end: i, next: i } : { kind: 'none' }
    }
  }
  if (boundary > 0 && boundary < body.length) return { kind: 'break', end: boundary, next: boundary }
  return { kind: 'none' }
}

const FENCE_LINE = /^`{3,}[\w-]*\s*$/

export type InsightSegment =
  | { type: 'text'; content: string }
  | { type: 'insight'; title: string; content: string }

export function splitByInsightBlocks(text: string, final = true): InsightSegment[] {
  const lines = text.split('\n')
  const segments: InsightSegment[] = []
  let textBuf: string[] = []

  const flushText = () => {
    if (textBuf.length > 0) {
      segments.push({ type: 'text', content: textBuf.join('\n') })
      textBuf = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const headerMatch = lines[i].match(INSIGHT_HEADER_LINE)
    if (!headerMatch) {
      textBuf.push(lines[i])
      i++
      continue
    }
    const rawLeading = headerMatch[1]
    const blockPrefix = INSIGHT_BLOCK_PREFIX.test(rawLeading) ? rawLeading : ''
    const leading = blockPrefix ? '' : rawLeading.trimEnd()
    const title = headerMatch[2].trim()
    if (leading) textBuf.push(leading)
    const body = lines.slice(i + 1).map((l) => stripBlockPrefix(l, blockPrefix))
    const found = findInsightBodyEnd(body, final)
    if (found.kind === 'none') {
      flushText()
      textBuf.push(`\`★ ${title} ${'─'.repeat(37)}\``)
      for (let j = i + 1; j < lines.length; j++) textBuf.push(lines[j])
      i = lines.length
      break
    }
    const innerLines = body.slice(0, found.end)
    if (found.kind === 'footer' && found.inlineContent !== null) innerLines.push(found.inlineContent)
    const prevIsFence = !leading && textBuf.length > 0 && FENCE_LINE.test(textBuf[textBuf.length - 1])
    const footerIdx = i + 1 + found.end
    const nextIsFence = found.kind === 'footer'
      && found.inlineContent === null
      && footerIdx + 1 < lines.length
      && FENCE_LINE.test(lines[footerIdx + 1])
    const stripFences = prevIsFence && nextIsFence
    if (stripFences) textBuf.pop()
    flushText()
    segments.push({ type: 'insight', title, content: innerLines.join('\n') })
    i = i + 1 + found.next + (stripFences ? 1 : 0)
  }
  flushText()
  return segments
}
