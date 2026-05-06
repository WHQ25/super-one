import type { DiffLine, HLToken } from './diff-utils'

export function mergeQuoteTokens(
  lines: Pick<DiffLine, 'kind' | 'lineNum'>[],
  fullTokens: HLToken[][] | null,
  snippetTokens: HLToken[][] | null,
): HLToken[][] | null {
  if (!fullTokens && !snippetTokens) return null
  return lines.map((line, i) => {
    if (line.kind === 'removed') return snippetTokens?.[i] ?? []
    const idx = line.lineNum - 1
    if (fullTokens && idx >= 0 && idx < fullTokens.length) return fullTokens[idx]
    return snippetTokens?.[i] ?? []
  })
}
