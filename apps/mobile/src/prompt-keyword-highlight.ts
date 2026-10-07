import { PROMPT_KEYWORD_SHIMMER, promptKeywordLetterColors, type Rgb } from '@superone/shared/composer-mode'
import { findPromptKeywords, type PromptKeyword } from '@superone/shared/prompt-keywords'

/** One keyword letter for the native editor: where it is, its place in the word, and its two colours. */
export type KeywordLetter = { offset: number; index: number; color: string; shimmer: string }

/**
 * What the native editor paints over a draft's prompt keywords, as the desktop
 * composer does (`prompt-keyword-decoration`): pixel capitals, letter colours,
 * and the shimmer stepping across them. Native code only paints; which words
 * count and in what colours stays here and in `@superone/shared`.
 *
 * `eventCount` ties it to the draft it was computed for. The editor applies it
 * only to that draft, so a keystroke that lands first never gets a stale paint.
 */
export type KeywordHighlight = {
  eventCount: number
  animate: boolean
  stepMs: number
  steps: number
  band: number
  letters: KeywordLetter[]
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`

/**
 * The highlight for a native editor snapshot. Its text holds one U+FFFC per
 * chip, as the desktop scan's draft does, so match offsets are the editor's.
 */
export function keywordHighlight(
  snapshot: { text: string; eventCount: number },
  keywords: readonly PromptKeyword[],
  { dark, animate }: { dark: boolean; animate: boolean },
): KeywordHighlight {
  const letters: KeywordLetter[] = []
  for (const match of findPromptKeywords(snapshot.text, keywords)) {
    for (let offset = match.start; offset < match.end; offset++) {
      const index = offset - match.start
      const { color, shimmer } = promptKeywordLetterColors(match.keyword, index, dark)
      letters.push({ offset, index, color: hex(color), shimmer: hex(shimmer) })
    }
  }
  return { eventCount: snapshot.eventCount, animate, ...PROMPT_KEYWORD_SHIMMER, letters }
}
