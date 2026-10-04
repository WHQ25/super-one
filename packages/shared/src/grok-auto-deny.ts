const MARKER = 'Auto mode blocked this action'

/**
 * Grok Generic Auto records a classifier block as a failed tool whose text is
 * `Tool \`name\` was not executed: Auto mode blocked this action (…)`.
 * A successful result that merely quotes that sentence is not a deny.
 */
export function isGrokAutoClassifierDeny(text: string | null | undefined): boolean {
  if (!text) return false
  const body = text.startsWith('[denied] ') ? text.slice('[denied] '.length) : text
  if (!body.startsWith('Tool `')) return false
  const markerAt = body.indexOf('` was not executed:')
  if (markerAt < 0) return false
  return body.slice(markerAt).includes(MARKER)
}

/** Classifier sentence shown on the denied tool card, when the failure matches. */
export function grokAutoClassifierDenyText(result: string | null | undefined): string | null {
  if (!isGrokAutoClassifierDeny(result) || !result) return null
  const body = result.startsWith('[denied] ') ? result.slice('[denied] '.length) : result
  const index = body.indexOf(MARKER)
  const text = body.slice(index).trim()
  return text || null
}

/** Prefix denied-row chrome. Successful results and other failures stay unchanged. */
export function withGrokAutoDenyPrefix(summary: string, failed = true): string {
  if (!failed || !isGrokAutoClassifierDeny(summary)) return summary
  if (summary.startsWith('[denied] ')) return summary
  return `[denied] ${summary}`
}
