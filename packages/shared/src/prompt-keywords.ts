/**
 * Words a harness reads out of the prompt text and acts on for that one turn.
 *
 * Claude Code's `ultrathink` adds a "reason more deeply" system reminder to the
 * turn; effort and the thinking budget stay as they are. `ultracode` opts the
 * turn into the Workflow tool (multi-agent orchestration), and only on messages
 * stamped as human-typed. The composer paints them so the user can see the turn
 * will change before sending it. Which harness understands which word is
 * `HarnessCapabilities.promptKeywords`.
 */
export type PromptKeyword = 'ultrathink' | 'ultracode'

export interface PromptKeywordMatch {
  keyword: PromptKeyword
  start: number
  end: number
}

const QUOTE_PAIRS: Record<string, string> = { '`': '`', '"': '"', '<': '>', '{': '}', '[': ']', '(': ')', "'": "'" }

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char)

/** Closed quoted, bracketed or tag spans: a keyword inside one is only being mentioned. */
function quotedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let opener: string | null = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (opener) {
      if (opener === '[' && char === '[') { start = i; continue }
      if (char !== QUOTE_PAIRS[opener]) continue
      // An apostrophe inside a word ("don't") does not close a quote.
      if (opener === "'" && isWordChar(text[i + 1])) continue
      spans.push([start, i + 1])
      opener = null
    } else if (
      (char === '<' && /[a-zA-Z/]/.test(text[i + 1] ?? ''))
      || (char === "'" && !isWordChar(text[i - 1]))
      || (char !== '<' && char !== "'" && Object.hasOwn(QUOTE_PAIRS, char))
    ) {
      opener = char
      start = i
    }
  }
  return spans
}

/**
 * Claude Code's scan for its `ultra*` mode keywords. Stricter than a word test:
 * a slash command, a quoted or bracketed word, part of a path, flag or file
 * name, or a question about the word ("what is ultracode?") does not trigger.
 */
function scanModeKeyword(text: string, word: string): Array<[number, number]> {
  if (text.startsWith('/')) return []
  const spans = quotedSpans(text)
  const found: Array<[number, number]> = []
  for (const match of text.matchAll(new RegExp(`\\b${word}\\b`, 'gi'))) {
    const start = match.index
    const end = start + match[0].length
    if (spans.some(([from, to]) => start >= from && start < to)) continue
    const before = text[start - 1]
    const after = text[end]
    if (before === '/' || before === '\\' || before === '-') continue
    if (after === '/' || after === '\\' || after === '-' || after === '?') continue
    if (after === '.' && isWordChar(text[end + 1])) continue
    found.push([start, end])
  }
  return found
}

// Ported from Claude Code. `ultrathink` is a bare `/\bultrathink\b/i`: any
// position, no slash, quote or message-origin exceptions.
const MATCHERS: Record<PromptKeyword, (text: string) => Array<[number, number]>> = {
  ultrathink: (text) => [...text.matchAll(/\bultrathink\b/gi)].map((match) => [match.index, match.index + match[0].length]),
  ultracode: (text) => scanModeKeyword(text, 'ultracode'),
}

/** Whether the whole prompt `text` asks for `keyword`. */
export function hasPromptKeyword(text: string, keyword: PromptKeyword): boolean {
  return MATCHERS[keyword](text).length > 0
}

/** Every occurrence of `keywords` in the whole prompt `text`, in text order. */
export function findPromptKeywords(text: string, keywords: readonly PromptKeyword[]): PromptKeywordMatch[] {
  return keywords
    .flatMap((keyword) => MATCHERS[keyword](text).map(([start, end]) => ({ keyword, start, end })))
    .sort((a, b) => a.start - b.start)
}
