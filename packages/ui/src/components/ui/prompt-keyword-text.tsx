import type { CSSProperties, ReactNode } from 'react'
import { findPromptKeywords, type PromptKeyword, type PromptKeywordMatch } from '@superone/shared/prompt-keywords'
import type { UserTextSegment } from '@superone/shared/user-mention-parser'

// Claude Code's `rainbow_*` and `rainbow_*_shimmer` theme colours, assigned by
// letter index and wrapping after violet: `--ultrathink-N` in prompt-keyword.css.
const RAINBOW_LENGTH = 7

/** CSS variables for letter `index` of a painted keyword (`.prompt-keyword-*`). */
export function promptKeywordLetterVars(keyword: PromptKeyword, index: number): Record<string, string> {
  if (keyword !== 'ultrathink') return { '--kw-index': String(index) }
  const hue = index % RAINBOW_LENGTH
  return {
    '--kw-color': `rgb(var(--ultrathink-${hue}))`,
    '--kw-shimmer': `rgb(var(--ultrathink-shimmer-${hue}))`,
    '--kw-index': String(index),
  }
}

/**
 * Keyword matches per user-text segment, scanned over the whole text the way
 * the composer scans its draft (a mention is one non-word character), so a
 * quote or a leading slash spanning segments rules as it did there.
 */
export function keywordMatchesBySegment(segments: UserTextSegment[], keywords: readonly PromptKeyword[]): PromptKeywordMatch[][] | null {
  if (keywords.length === 0) return null
  let text = ''
  const offsets = segments.map((segment) => {
    const offset = text.length
    text += segment.type === 'text' ? segment.text : '￼'
    return offset
  })
  const matches = findPromptKeywords(text, keywords)
  if (matches.length === 0) return null
  return segments.map((segment, i) => {
    if (segment.type !== 'text') return []
    const from = offsets[i]!
    const to = from + segment.text.length
    return matches
      .filter((match) => match.start >= from && match.end <= to)
      .map((match) => ({ ...match, start: match.start - from, end: match.end - from }))
  })
}

/** `text` with its prompt keywords painted letter by letter, as the composer paints them. */
export function PromptKeywordText({ text, matches }: { text: string; matches?: PromptKeywordMatch[] }) {
  if (!matches?.length) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const { keyword, start, end } of matches) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    for (let i = start; i < end; i++) {
      parts.push(
        <span key={i} className={`prompt-keyword-${keyword}`} style={promptKeywordLetterVars(keyword, i - start) as CSSProperties}>
          {text[i]}
        </span>,
      )
    }
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
