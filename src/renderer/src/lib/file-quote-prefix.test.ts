import { describe, it, expect } from 'vitest'
import {
  compressLineRanges,
  expandLineRanges,
  parseFilePrefix,
  parseDiffBody,
  lineKindToMarker,
  markerToLineKind,
  formatFilePrefix,
} from './file-quote-prefix'

describe('compressLineRanges', () => {
  it('returns empty string for empty input', () => {
    expect(compressLineRanges([])).toBe('')
  })
  it('formats single line as L<n>', () => {
    expect(compressLineRanges([5])).toBe('L5')
  })
  it('compresses contiguous lines', () => {
    expect(compressLineRanges([10, 11, 12])).toBe('L10-L12')
  })
  it('emits multiple ranges for non-contiguous lines', () => {
    expect(compressLineRanges([10, 11, 12, 15, 16, 17])).toBe('L10-L12,L15-L17')
  })
  it('mixes singletons and ranges', () => {
    expect(compressLineRanges([3, 7, 8, 9, 20])).toBe('L3,L7-L9,L20')
  })
  it('dedupes repeated line numbers', () => {
    expect(compressLineRanges([10, 11, 11, 12])).toBe('L10-L12')
  })
})

describe('expandLineRanges', () => {
  it('expands a single line', () => {
    expect(expandLineRanges('L5')).toEqual([5])
  })
  it('expands a range', () => {
    expect(expandLineRanges('L10-L12')).toEqual([10, 11, 12])
  })
  it('expands multiple comma-separated ranges', () => {
    expect(expandLineRanges('L10-L12,L50-L51')).toEqual([10, 11, 12, 50, 51])
  })
  it('mixes singletons and ranges', () => {
    expect(expandLineRanges('L3,L7-L9,L20')).toEqual([3, 7, 8, 9, 20])
  })
  it('returns empty array for malformed input', () => {
    expect(expandLineRanges('not-a-range')).toEqual([])
  })
  it('skips inverted ranges silently', () => {
    expect(expandLineRanges('L10-L5')).toEqual([])
  })
  it('round-trips with compressLineRanges', () => {
    const lines = [3, 7, 8, 9, 20]
    expect(expandLineRanges(compressLineRanges(lines))).toEqual(lines)
  })
})

describe('parseFilePrefix', () => {
  it('parses POSIX absolute path with single range', () => {
    const parsed = parseFilePrefix('/abs/path/foo.ts:L10-L12\nfunction bar() {}')
    expect(parsed).toEqual({
      prefix: '/abs/path/foo.ts:L10-L12',
      filePath: '/abs/path/foo.ts',
      rangeText: 'L10-L12',
      body: 'function bar() {}',
      selStartCol: null,
      selEndCol: null,
      isDiff: false,
    })
  })

  it('parses optional selection col range :C<a>-C<b>', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L10-L12:C5-C20\nbody')
    expect(parsed).toEqual({
      prefix: '/abs/foo.ts:L10-L12:C5-C20',
      filePath: '/abs/foo.ts',
      rangeText: 'L10-L12',
      body: 'body',
      selStartCol: 5,
      selEndCol: 20,
      isDiff: false,
    })
  })

  it('parses :D flag for unified-diff body', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L10-L12:C5-C8:D\n const a\n+const new\n-const old')
    expect(parsed?.isDiff).toBe(true)
    expect(parsed?.body).toBe(' const a\n+const new\n-const old')
  })

  it('parses :D flag without col range', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L10-L12:D\n const a')
    expect(parsed?.isDiff).toBe(true)
    expect(parsed?.selStartCol).toBeNull()
  })

  it('parses single-line C range (no L range hyphen)', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L42:C5-C20\nbody')
    expect(parsed?.rangeText).toBe('L42')
    expect(parsed?.selStartCol).toBe(5)
    expect(parsed?.selEndCol).toBe(20)
  })

  it('parses single-line range L<n>', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L42\nconst x = 1')
    expect(parsed?.filePath).toBe('/abs/foo.ts')
    expect(parsed?.rangeText).toBe('L42')
    expect(parsed?.body).toBe('const x = 1')
  })

  it('parses multi-range non-contiguous selection', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L10-L12,L50-L51\nbody')
    expect(parsed?.rangeText).toBe('L10-L12,L50-L51')
  })

  it('handles Windows-style paths with drive-letter colon', () => {
    const parsed = parseFilePrefix('C:\\Users\\foo\\bar.ts:L10-L12\nbody')
    expect(parsed?.filePath).toBe('C:\\Users\\foo\\bar.ts')
    expect(parsed?.rangeText).toBe('L10-L12')
    expect(parsed?.body).toBe('body')
  })

  it('returns null for plain text without a newline', () => {
    expect(parseFilePrefix('plain text without newline')).toBeNull()
  })

  it('returns null for first line that does not match the prefix pattern', () => {
    expect(parseFilePrefix('hello world\nmore text')).toBeNull()
  })

  it('returns null when the line-range portion is missing', () => {
    expect(parseFilePrefix('/abs/foo.ts\nbody')).toBeNull()
  })

  it('preserves multi-line body verbatim including blank lines', () => {
    const parsed = parseFilePrefix('/abs/foo.ts:L10-L12\nline1\n\nline3')
    expect(parsed?.body).toBe('line1\n\nline3')
  })
})

describe('formatFilePrefix', () => {
  it('formats minimal prefix (path + range only)', () => {
    expect(formatFilePrefix('/abs/foo.ts', 'L10-L12')).toBe('/abs/foo.ts:L10-L12')
  })

  it('appends :C<a>-C<b> when both col offsets are provided', () => {
    expect(formatFilePrefix('/abs/foo.ts', 'L10-L12', 5, 8)).toBe('/abs/foo.ts:L10-L12:C5-C8')
  })

  it('skips :C suffix when either col is missing', () => {
    expect(formatFilePrefix('/abs/foo.ts', 'L10-L12', 5)).toBe('/abs/foo.ts:L10-L12')
    expect(formatFilePrefix('/abs/foo.ts', 'L10-L12', undefined, 8)).toBe('/abs/foo.ts:L10-L12')
  })

  it('appends :D when isDiff=true', () => {
    expect(formatFilePrefix('/abs/foo.ts', 'L10-L12', undefined, undefined, true))
      .toBe('/abs/foo.ts:L10-L12:D')
  })

  it('combines col range and diff flag', () => {
    expect(formatFilePrefix('/abs/foo.ts', 'L10-L12', 5, 8, true))
      .toBe('/abs/foo.ts:L10-L12:C5-C8:D')
  })

  it('round-trips through parseFilePrefix', () => {
    const formatted = formatFilePrefix('/abs/foo.ts', 'L10-L12,L50-L51', 0, 11, true)
    const parsed = parseFilePrefix(`${formatted}\nbody`)
    expect(parsed?.filePath).toBe('/abs/foo.ts')
    expect(parsed?.rangeText).toBe('L10-L12,L50-L51')
    expect(parsed?.selStartCol).toBe(0)
    expect(parsed?.selEndCol).toBe(11)
    expect(parsed?.isDiff).toBe(true)
  })
})

describe('parseDiffBody / kind markers', () => {
  it('round-trips kinds via marker', () => {
    expect(markerToLineKind(lineKindToMarker('unchanged'))).toBe('unchanged')
    expect(markerToLineKind(lineKindToMarker('added'))).toBe('added')
    expect(markerToLineKind(lineKindToMarker('removed'))).toBe('removed')
  })

  it('parses unified-diff body into kind + text per line', () => {
    expect(parseDiffBody(' const a = 1\n+const new = 2\n-const old = 2\n const b = 3')).toEqual([
      { kind: 'unchanged', text: 'const a = 1' },
      { kind: 'added', text: 'const new = 2' },
      { kind: 'removed', text: 'const old = 2' },
      { kind: 'unchanged', text: 'const b = 3' },
    ])
  })

  it('treats unknown leading char as unchanged but strips it', () => {
    expect(parseDiffBody('xline')).toEqual([{ kind: 'unchanged', text: 'line' }])
  })
})
