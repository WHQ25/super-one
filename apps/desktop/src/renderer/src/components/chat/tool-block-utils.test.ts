import {
  tryPrettifyJson,
  parseQAPairs,
  countUnifiedDiffDelta,
  countPrefixedDiffDelta,
  computeLineDelta,
  computeStreamingEditDelta,
} from './tool-block-utils'

describe('tryPrettifyJson', () => {
  it('should return prettified JSON for valid object input', () => {
    expect(tryPrettifyJson('{"a":1,"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}')
  })

  it('should return prettified JSON for valid array input', () => {
    expect(tryPrettifyJson('[1,2,3]')).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('should return null for non-JSON strings', () => {
    expect(tryPrettifyJson('hello world')).toBeNull()
  })

  it('should return null for primitive JSON values', () => {
    expect(tryPrettifyJson('42')).toBeNull()
    expect(tryPrettifyJson('"hello"')).toBeNull()
    expect(tryPrettifyJson('true')).toBeNull()
    expect(tryPrettifyJson('null')).toBeNull()
  })

  it('should handle nested objects', () => {
    const input = '{"a":{"b":{"c":1}}}'
    const expected = '{\n  "a": {\n    "b": {\n      "c": 1\n    }\n  }\n}'
    expect(tryPrettifyJson(input)).toBe(expected)
  })
})

describe('parseQAPairs', () => {
  it('should parse standard Q&A pairs', () => {
    const input = '"What is your name?"="Alice"'
    expect(parseQAPairs(input)).toEqual([
      { question: 'What is your name?', answer: 'Alice' },
    ])
  })

  it('should return empty array for empty string', () => {
    expect(parseQAPairs('')).toEqual([])
  })

  it('should return empty array for non-matching input', () => {
    expect(parseQAPairs('no pairs here')).toEqual([])
  })

  it('should handle multiple pairs', () => {
    const input = '"q1"="a1" "q2"="a2" "q3"="a3"'
    expect(parseQAPairs(input)).toEqual([
      { question: 'q1', answer: 'a1' },
      { question: 'q2', answer: 'a2' },
      { question: 'q3', answer: 'a3' },
    ])
  })

  it('should handle empty answers', () => {
    const input = '"question"=""'
    expect(parseQAPairs(input)).toEqual([
      { question: 'question', answer: '' },
    ])
  })
})

describe('countUnifiedDiffDelta', () => {
  it('should return null for empty diff', () => {
    expect(countUnifiedDiffDelta('')).toBeNull()
  })

  it('should count added and removed lines correctly', () => {
    const diff = [
      '@@ -1,3 +1,4 @@',
      ' unchanged',
      '-removed1',
      '-removed2',
      '+added1',
      '+added2',
      '+added3',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 3, removed: 2 })
  })

  it('should ignore lines before the first hunk header', () => {
    const diff = [
      '+not counted',
      '-not counted',
      '@@ -1,2 +1,2 @@',
      '-real',
      '+real',
    ].join('\n')
    expect(countUnifiedDiffDelta(diff)).toEqual({ added: 1, removed: 1 })
  })

  it('should return null when diff has no changes', () => {
    const diff = '@@ -1,1 +1,1 @@\n unchanged'
    expect(countUnifiedDiffDelta(diff)).toBeNull()
  })
})

describe('countPrefixedDiffDelta', () => {
  it('should return null for empty diff', () => {
    expect(countPrefixedDiffDelta('')).toBeNull()
  })

  it('should ignore +++ and --- header lines', () => {
    const diff = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '+added',
      '-removed',
    ].join('\n')
    expect(countPrefixedDiffDelta(diff)).toEqual({ added: 1, removed: 1 })
  })

  it('should count all prefixed lines', () => {
    const diff = [
      '+line1',
      '+line2',
      '-line3',
    ].join('\n')
    expect(countPrefixedDiffDelta(diff)).toEqual({ added: 2, removed: 1 })
  })

  it('should return null when no changes', () => {
    expect(countPrefixedDiffDelta('unchanged line')).toBeNull()
  })
})

describe('computeLineDelta', () => {
  it('should count added lines for Write tool', () => {
    expect(computeLineDelta('Write', { content: 'line1\nline2\nline3' }))
      .toEqual({ added: 3, removed: 0 })
  })

  it('should return null for Write with empty content', () => {
    expect(computeLineDelta('Write', { content: '' })).toBeNull()
  })

  it('should count only actually changed lines for Edit tool (LCS diff)', () => {
    expect(computeLineDelta('Edit', { old_string: 'a\nb', new_string: 'c\nd\ne' }))
      .toEqual({ added: 3, removed: 2 })
  })

  it('should ignore unchanged lines shared between old_string and new_string', () => {
    const oldStr = 'keep1\nkeep2\nold\nkeep3'
    const newStr = 'keep1\nkeep2\nnew\nkeep3'
    expect(computeLineDelta('Edit', { old_string: oldStr, new_string: newStr }))
      .toEqual({ added: 1, removed: 1 })
  })

  it('should return null for Edit when old_string equals new_string', () => {
    expect(computeLineDelta('Edit', { old_string: 'a\nb', new_string: 'a\nb' })).toBeNull()
  })

  it('should return null for Edit with both strings empty', () => {
    expect(computeLineDelta('Edit', { old_string: '', new_string: '' })).toBeNull()
  })

  it('should handle FileChange with add kind', () => {
    expect(computeLineDelta('FileChange', { kind: 'add', diff: 'line1\nline2' }))
      .toEqual({ added: 2, removed: 0 })
  })

  it('should handle FileChange with delete kind', () => {
    expect(computeLineDelta('FileChange', { kind: 'delete', diff: 'line1\nline2' }))
      .toEqual({ added: 0, removed: 2 })
  })

  it('should handle FileChange with modify kind using unified diff', () => {
    const diff = '@@ -1,1 +1,2 @@\n-old\n+new1\n+new2'
    expect(computeLineDelta('FileChange', { kind: 'modify', diff }))
      .toEqual({ added: 2, removed: 1 })
  })

  it('should return null for unknown tool names', () => {
    expect(computeLineDelta('Unknown', {})).toBeNull()
  })

  it('should return null for FileChange with empty diff', () => {
    expect(computeLineDelta('FileChange', { kind: 'modify', diff: '' })).toBeNull()
  })
})

describe('computeStreamingEditDelta', () => {
  it('returns null when new_string is empty', () => {
    expect(computeStreamingEditDelta('A\nB\nC', '')).toBeNull()
  })

  it('returns null until the first newline arrives', () => {
    expect(computeStreamingEditDelta('A\nB\nC', 'A')).toBeNull()
  })

  it('returns null when only context is matched (nothing confirmed)', () => {
    expect(computeStreamingEditDelta('A\nB\nC', 'A\n')).toBeNull()
  })

  it('counts confirmed added/removed within last unchanged anchor', () => {
    const result = computeStreamingEditDelta('A\nB\nC\nD\nE\nF', 'A\nB\nX\nE\nF\n')
    expect(result).toEqual({ added: 1, removed: 2 })
  })

  it('does not over-count tail old as removed when no anchor reaches end', () => {
    const result = computeStreamingEditDelta('A\nB\nC\nD', 'A\nX\n')
    expect(result).toEqual({ added: 1, removed: 0 })
  })

  it('is monotonic non-decreasing as new_string grows', () => {
    const oldStr = 'A\nB\nC\nD\nE\nF'
    const stages = ['A\n', 'A\nB\n', 'A\nB\nX\n', 'A\nB\nX\nE\n', 'A\nB\nX\nE\nF\n']
    let prevAdded = 0
    let prevRemoved = 0
    for (const stage of stages) {
      const result = computeStreamingEditDelta(oldStr, stage) ?? { added: 0, removed: 0 }
      expect(result.added).toBeGreaterThanOrEqual(prevAdded)
      expect(result.removed).toBeGreaterThanOrEqual(prevRemoved)
      prevAdded = result.added
      prevRemoved = result.removed
    }
  })

  it('matches LCS final result when last anchor reaches end of old', () => {
    const oldStr = 'A\nB\nC\nD\nE\nF'
    const newStr = 'A\nB\nX\nE\nF\n'
    const streamingFinal = computeStreamingEditDelta(oldStr, newStr)
    const lcsFinal = computeLineDelta('Edit', { old_string: oldStr, new_string: newStr })
    expect(streamingFinal).toEqual(lcsFinal)
  })

  it('handles repeated lines without spurious large counts (greedy would mis-match)', () => {
    const oldStr = 'function a() {\n  return 1\n}\nfunction b() {\n  return 2\n}\nfunction c() {\n  return 3\n}'
    const newStr = 'function a() {\n  return 1\n}\nfunction b() {\n  return 2\n}\nfunction d() {\n  return 4\n}\n'
    const streamingResult = computeStreamingEditDelta(oldStr, newStr)
    const finalResult = computeLineDelta('Edit', { old_string: oldStr, new_string: newStr })
    expect(streamingResult).toEqual({ added: 2, removed: 2 })
    expect(finalResult).toEqual(streamingResult)
  })
})
