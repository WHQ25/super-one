import { describe, it, expect } from 'vitest'
import { countUnifiedDiffDelta, countPrefixedDiffDelta, computeLineDelta, parseQAPairs } from './tool-block-utils'

describe('countUnifiedDiffDelta', () => {
  it('should return null for empty string', () => {
    expect(countUnifiedDiffDelta('')).toBeNull()
  })

  it('should count additions and removals in unified diff', () => {
    const diff = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,4 @@',
      ' unchanged',
      '-removed line',
      '+added line 1',
      '+added line 2',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 2, removed: 1 })
  })

  it('should ignore lines before first hunk marker', () => {
    const diff = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '+not a real addition',
      '@@ -1,2 +1,2 @@',
      '-real removal',
      '+real addition',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 1, removed: 1 })
  })

  it('should ignore no-newline markers', () => {
    const diff = [
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '\\ No newline at end of file',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 1, removed: 1 })
  })

  it('should return null when no changes in hunks', () => {
    const diff = [
      '@@ -1,2 +1,2 @@',
      ' same line 1',
      ' same line 2',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toBeNull()
  })

  it('should handle CRLF line endings', () => {
    const diff = '@@ -1 +1,2 @@\r\n unchanged\r\n+added\r\n'
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 1, removed: 0 })
  })

  it('should handle multiple hunks', () => {
    const diff = [
      '@@ -1,2 +1,2 @@',
      '-old1',
      '+new1',
      '@@ -10,2 +10,3 @@',
      ' context',
      '+added1',
      '+added2',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 3, removed: 1 })
  })
})

describe('countPrefixedDiffDelta', () => {
  it('should return null for empty string', () => {
    expect(countPrefixedDiffDelta('')).toBeNull()
  })

  it('should count + and - prefixed lines', () => {
    const diff = [
      '+added line',
      '-removed line',
      ' context line',
    ].join('\n')
    expect(countPrefixedDiffDelta(diff)).toEqual({ added: 1, removed: 1 })
  })

  it('should ignore +++ and --- file headers', () => {
    const diff = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '+real addition',
    ].join('\n')
    expect(countPrefixedDiffDelta(diff)).toEqual({ added: 1, removed: 0 })
  })

  it('should return null when no changes', () => {
    expect(countPrefixedDiffDelta(' unchanged')).toBeNull()
  })
})

describe('computeLineDelta', () => {
  it('should return null for unknown tool', () => {
    expect(computeLineDelta('Read', {})).toBeNull()
  })

  it('should count lines for Write tool', () => {
    expect(computeLineDelta('Write', { content: 'line1\nline2\nline3' }))
      .toEqual({ added: 3, removed: 0 })
  })

  it('should return null for Write with empty content', () => {
    expect(computeLineDelta('Write', { content: '' })).toBeNull()
  })

  it('should count old/new lines for Edit tool', () => {
    expect(computeLineDelta('Edit', {
      old_string: 'old1\nold2',
      new_string: 'new1\nnew2\nnew3',
    })).toEqual({ added: 3, removed: 2 })
  })

  it('should return null for Edit with both empty strings', () => {
    expect(computeLineDelta('Edit', { old_string: '', new_string: '' })).toBeNull()
  })

  it('should handle FileChange add kind', () => {
    expect(computeLineDelta('FileChange', {
      kind: 'add',
      diff: 'line1\nline2',
    })).toEqual({ added: 2, removed: 0 })
  })

  it('should handle FileChange delete kind', () => {
    expect(computeLineDelta('FileChange', {
      kind: 'delete',
      diff: 'line1\nline2\nline3',
    })).toEqual({ added: 0, removed: 3 })
  })

  it('should handle FileChange modify kind with unified diff', () => {
    const diff = [
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
    ].join('\n')
    expect(computeLineDelta('FileChange', { kind: 'modify', diff }))
      .toEqual({ added: 1, removed: 1 })
  })

  it('should return null for FileChange with empty diff', () => {
    expect(computeLineDelta('FileChange', { kind: 'modify', diff: '' })).toBeNull()
  })
})

describe('parseQAPairs', () => {
  it('should parse single Q&A pair', () => {
    expect(parseQAPairs('"What color?"="Blue"')).toEqual([
      { question: 'What color?', answer: 'Blue' },
    ])
  })

  it('should parse multiple Q&A pairs', () => {
    const text = '"Q1"="A1", "Q2"="A2"'
    expect(parseQAPairs(text)).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ])
  })

  it('should handle empty answer', () => {
    expect(parseQAPairs('"Question?"=""')).toEqual([
      { question: 'Question?', answer: '' },
    ])
  })

  it('should return empty array for non-matching text', () => {
    expect(parseQAPairs('random text')).toEqual([])
  })

  it('should return empty array for empty string', () => {
    expect(parseQAPairs('')).toEqual([])
  })
})
