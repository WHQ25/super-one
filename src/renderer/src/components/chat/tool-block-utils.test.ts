import {
  tryPrettifyJson,
  parseQAPairs,
  countUnifiedDiffDelta,
  countPrefixedDiffDelta,
  computeLineDelta,
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

  it('should count added and removed lines for Edit tool', () => {
    expect(computeLineDelta('Edit', { old_string: 'a\nb', new_string: 'c\nd\ne' }))
      .toEqual({ added: 3, removed: 2 })
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
