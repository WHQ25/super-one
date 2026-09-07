/**
 * Selecting a slash command rewrites the command line, not the draft.
 *
 * The composer used to replace the whole document, which was invisible only
 * because the overlay refused to open once the draft contained any whitespace.
 * Relaxing that gate without this would delete every line after the first —
 * and, in the native editor, every mention chip with them.
 */

/** Range covering the draft's first line, excluding its newline. */
export function firstLineRange(text: string): { start: number; end: number } {
  const newline = text.indexOf('\n')
  return { start: 0, end: newline < 0 ? text.length : newline }
}

/** The first line on its own — what a command query is matched against. */
export function firstLine(text: string): string {
  return text.slice(0, firstLineRange(text).end)
}

/** Replace only the first line, keeping the newline and everything after it. */
export function replaceFirstLine(text: string, replacement: string): string {
  const { end } = firstLineRange(text)
  return replacement + text.slice(end)
}
