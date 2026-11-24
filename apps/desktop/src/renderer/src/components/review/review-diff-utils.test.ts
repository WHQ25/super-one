import { describe, expect, it } from 'vitest'
import type { ReplyComment } from '@/stores/chat'
import {
  buildAnnotationsForFile,
  computeSplitDiffMinWidthPx,
  countCommentsByFile,
  extractIndividualHunkPatches,
  formatReviewSelectionQuote,
  maxLineNumberDigitsForFiles,
  maxLineNumberInPatch,
  normalizeLineSelection,
  resolveAutoDiffStyle,
  SPLIT_DIFF_MIN_COLUMNS,
} from './review-diff-utils'

const SAMPLE_PATCH = [
  'diff --git a/src/demo.ts b/src/demo.ts',
  '--- a/src/demo.ts',
  '+++ b/src/demo.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 20',
  ' const c = 3',
  '@@ -10,3 +10,4 @@',
  ' const x = 10',
  '+const y = 20',
  ' const z = 30',
].join('\n')

describe('review-diff-utils', () => {
  it('splits multi-hunk unified patch into individual revertible hunk patches', () => {
    const hunks = extractIndividualHunkPatches('src/demo.ts', SAMPLE_PATCH)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].additions).toBe(1)
    expect(hunks[0].deletions).toBe(1)
    expect(hunks[0].singleHunkPatch).toContain('@@ -1,3 +1,3 @@')
    expect(hunks[0].singleHunkPatch).not.toContain('@@ -10,3 +10,4 @@')
    expect(hunks[1].newStart).toBe(10)
    expect(hunks[1].additions).toBe(1)
    expect(hunks[1].deletions).toBe(0)
  })

  it('formats selection quotes and maps ReplyComments back into @pierre/diffs lineAnnotations', () => {
    const draft = normalizeLineSelection({ start: 2, end: 2, side: 'additions' })
    const quote = formatReviewSelectionQuote('src/demo.ts', draft, SAMPLE_PATCH)
    expect(quote).toContain('src/demo.ts:L2:D')
    expect(quote).toContain('+const b = 20')

    const comments: ReplyComment[] = [
      {
        id: 'c1',
        messageId: null,
        anchorText: quote,
        quote,
        text: 'Rename b to something descriptive',
        surface: 'code',
      },
    ]

    const annotations = buildAnnotationsForFile(comments, 'src/demo.ts', '/repo', draft)
    expect(annotations).toHaveLength(2)
    expect(annotations[0].lineNumber).toBe(2)
    expect(annotations[0].metadata?.kind).toBe('comment')
    expect(annotations[1].metadata?.kind).toBe('draft')

    const counts = countCommentsByFile(
      comments,
      [{ path: 'src/demo.ts', status: 'modified', additions: 2, deletions: 1, patch: SAMPLE_PATCH }],
      '/repo',
    )
    expect(counts.get('src/demo.ts')).toBe(1)
  })

  it('switches auto diff layout to split only when both sides fit 80 columns plus line-number gutter', () => {
    expect(SPLIT_DIFF_MIN_COLUMNS).toBe(80)
    expect(maxLineNumberInPatch(SAMPLE_PATCH)).toBe(13)
    expect(maxLineNumberDigitsForFiles([{ patch: SAMPLE_PATCH }])).toBe(2)
    expect(maxLineNumberDigitsForFiles([{ patch: '@@ -1000,5 +1000,5 @@\n a' }])).toBe(4)

    const min3Digits = computeSplitDiffMinWidthPx(8, 3)
    const min4Digits = computeSplitDiffMinWidthPx(8, 4)
    expect(min3Digits).toBe((80 + 3 + 5) * 2 * 8 + 5)
    expect(min4Digits).toBe((80 + 4 + 5) * 2 * 8 + 5)
    expect(resolveAutoDiffStyle(min3Digits - 1, 8, 3)).toBe('unified')
    expect(resolveAutoDiffStyle(min3Digits, 8, 3)).toBe('split')
    expect(resolveAutoDiffStyle(min3Digits, 8, 4)).toBe('unified')
    expect(resolveAutoDiffStyle(min4Digits, 8, 4)).toBe('split')
  })
})
