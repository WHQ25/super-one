import { describe, expect, it } from 'vitest'
import { parseNativeDiff } from './remote-diff'

describe('parseNativeDiff', () => {
  it.each(['add', 'delete'] as const)('preserves raw %s contents including indentation and diff-like prefixes', (kind) => {
    const lines = parseNativeDiff('  const value = 1\n+literal\n-literal\n\n', undefined, kind)
    expect(lines.map(line => line.text)).toEqual(['  const value = 1', '+literal', '-literal', ''])
    expect(lines.map(line => line.kind)).toEqual(Array(4).fill(kind === 'add' ? 'added' : 'removed'))
    expect(lines.map(line => line.line)).toEqual([1, 2, 3, 4])
    expect(parseNativeDiff('', undefined, kind)).toEqual([])
  })

  it('uses hunk line numbers and skips file headers and the no-newline marker', () => {
    expect(parseNativeDiff('--- a/a.ts\n+++ b/a.ts\n@@ -8,2 +9,2 @@\n same\n-old\n+new\n\\ No newline at end of file').map(({ kind, line, text }) => ({ kind, line, text }))).toEqual([
      { kind: 'context', line: 9, text: 'same' },
      { kind: 'removed', line: 9, text: 'old' },
      { kind: 'added', line: 10, text: 'new' },
    ])
  })

  it('uses source-indexed tokens for context and changes, and rejects stale tokens', () => {
    const lines = parseNativeDiff(' same\n-old\n+new', {
      removed: [[['same', '#fff']], [['old', '#f00']]],
      added: [[['same', '#fff']], [['stale', '#0f0']]],
    })
    expect(lines[0].tokens).toEqual([['same', '#fff']])
    expect(lines[1].tokens).toEqual([['old', '#f00']])
    expect(lines[2].tokens).toBeUndefined()
  })
})
