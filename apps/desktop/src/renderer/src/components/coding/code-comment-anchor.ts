import { expandLineRanges, parseFilePrefix } from '@superone/shared/file-quote-prefix'

/** A code comment's quote, reduced to the lines it covers in a file. */
export interface CodeCommentAnchor {
  filePath: string
  lines: number[]
  startCol: number | null
  endCol: number | null
}

function normPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** The file selection a code comment quotes, or null when the quote is prose. */
export function codeCommentAnchor(quote: string): CodeCommentAnchor | null {
  const parsed = parseFilePrefix(quote)
  if (!parsed) return null
  const lines = expandLineRanges(parsed.rangeText)
  if (lines.length === 0) return null
  return {
    filePath: parsed.filePath,
    lines,
    startCol: parsed.selStartCol,
    endCol: parsed.selEndCol,
  }
}

/** True when a quoted path is this editor's file, absolute or project-relative. */
export function quoteMatchesFile(quotePath: string, fullPath: string, relPath: string): boolean {
  const quoted = normPath(quotePath)
  const full = normPath(fullPath)
  const rel = normPath(relPath)
  if (!quoted || !full) return false
  if (quoted === full || (rel !== '' && quoted === rel)) return true
  if (rel !== '' && quoted.endsWith(`/${rel}`)) return true
  return full.endsWith(`/${quoted}`)
}
