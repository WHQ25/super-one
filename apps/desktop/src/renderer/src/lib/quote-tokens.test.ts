import { describe, it, expect } from 'vitest'
import { mergeQuoteTokens } from './quote-tokens'
import type { HLToken } from './diff-utils'

function tk(content: string): HLToken[] {
  return [{ content }]
}

describe('mergeQuoteTokens', () => {
  it('returns null when neither token array is available', () => {
    expect(mergeQuoteTokens([{ kind: 'unchanged', lineNum: 1 }], null, null)).toBeNull()
  })

  it('uses fullTokens at lineNum-1 for unchanged lines', () => {
    const full: HLToken[][] = [tk('A'), tk('B'), tk('C'), tk('D')]
    const result = mergeQuoteTokens(
      [{ kind: 'unchanged', lineNum: 2 }, { kind: 'unchanged', lineNum: 4 }],
      full,
      null,
    )
    expect(result).toEqual([tk('B'), tk('D')])
  })

  it('uses fullTokens for added lines (line is in current file)', () => {
    const full: HLToken[][] = [tk('a'), tk('b'), tk('c')]
    const result = mergeQuoteTokens(
      [{ kind: 'added', lineNum: 2 }],
      full,
      null,
    )
    expect(result).toEqual([tk('b')])
  })

  it('uses snippetTokens by snippet index for removed lines, even when fullTokens has the lineNum', () => {
    const full: HLToken[][] = [tk('A'), tk('B'), tk('C')]
    const snippet: HLToken[][] = [tk('removed-old')]
    const result = mergeQuoteTokens(
      [{ kind: 'removed', lineNum: 2 }],
      full,
      snippet,
    )
    expect(result).toEqual([tk('removed-old')])
  })

  it('mixes per-line correctly: unchanged uses full, removed uses snippet', () => {
    const full: HLToken[][] = [tk('a'), tk('b'), tk('c'), tk('d')]
    const snippet: HLToken[][] = [tk('s0'), tk('s1'), tk('s2')]
    const result = mergeQuoteTokens(
      [
        { kind: 'unchanged', lineNum: 1 },
        { kind: 'removed', lineNum: 2 },
        { kind: 'added', lineNum: 3 },
      ],
      full,
      snippet,
    )
    expect(result).toEqual([tk('a'), tk('s1'), tk('c')])
  })

  it('falls back to snippetTokens when lineNum exceeds fullTokens length', () => {
    const full: HLToken[][] = [tk('a'), tk('b')]
    const snippet: HLToken[][] = [tk('snip-fallback')]
    const result = mergeQuoteTokens(
      [{ kind: 'unchanged', lineNum: 99 }],
      full,
      snippet,
    )
    expect(result).toEqual([tk('snip-fallback')])
  })

  it('returns empty arrays when neither slice has tokens for a line', () => {
    const result = mergeQuoteTokens(
      [{ kind: 'unchanged', lineNum: 99 }],
      null,
      [],
    )
    expect(result).toEqual([[]])
  })

  it('handles only-snippet path (cross-project / fullTokens unavailable)', () => {
    const snippet: HLToken[][] = [tk('s0'), tk('s1')]
    const result = mergeQuoteTokens(
      [{ kind: 'unchanged', lineNum: 10 }, { kind: 'unchanged', lineNum: 11 }],
      null,
      snippet,
    )
    expect(result).toEqual([tk('s0'), tk('s1')])
  })

  it('handles only-full path (no snippet, all in range)', () => {
    const full: HLToken[][] = [tk('a'), tk('b'), tk('c')]
    const result = mergeQuoteTokens(
      [{ kind: 'unchanged', lineNum: 2 }, { kind: 'added', lineNum: 3 }],
      full,
      null,
    )
    expect(result).toEqual([tk('b'), tk('c')])
  })
})
