import { describe, it, expect } from 'vitest'
import { extractJsonStringValue, extractJsonNumberValue } from './partial-json'

describe('extractJsonStringValue', () => {
  describe('complete strings', () => {
    it('extracts a plain ASCII value', () => {
      expect(extractJsonStringValue(`{"x":"hello"}`, 'x')).toBe('hello')
    })

    it('decodes common escape sequences', () => {
      expect(extractJsonStringValue(`{"x":"a\\nb"}`, 'x')).toBe('a\nb')
      expect(extractJsonStringValue(`{"x":"a\\tb"}`, 'x')).toBe('a\tb')
      expect(extractJsonStringValue(`{"x":"a\\"b"}`, 'x')).toBe('a"b')
      expect(extractJsonStringValue(`{"x":"a\\\\b"}`, 'x')).toBe('a\\b')
      expect(extractJsonStringValue(`{"x":"a\\/b"}`, 'x')).toBe('a/b')
    })

    it('decodes \\uXXXX', () => {
      expect(extractJsonStringValue(`{"x":"caf\\u00e9"}`, 'x')).toBe('café')
    })

    it('returns undefined when the key is missing', () => {
      expect(extractJsonStringValue(`{"y":"hi"}`, 'x')).toBeUndefined()
    })
  })

  describe('truncated streams (real SDK delta cut points)', () => {
    it('returns what has been streamed when the closing quote is missing', () => {
      expect(extractJsonStringValue(`{"x":"abc`, 'x')).toBe('abc')
    })

    it('requireClosed refuses an unclosed value', () => {
      expect(extractJsonStringValue(`{"x":"abc`, 'x', { requireClosed: true })).toBeUndefined()
      expect(extractJsonStringValue(`{"x":"abc"}`, 'x', { requireClosed: true })).toBe('abc')
    })

    it('does not hang when the stream ends on a lone backslash', () => {
      // regression: prior O(n²)→O(n) rewrite hit an infinite loop here because
      // the else-branch inner scan could not advance past `\` without a partner.
      const t0 = performance.now()
      expect(extractJsonStringValue(`{"x":"line1\\`, 'x')).toBe('line1\\')
      expect(performance.now() - t0).toBeLessThan(50)
    })

    it('does not hang when the stream ends mid-\\uXXXX', () => {
      const t0 = performance.now()
      expect(extractJsonStringValue(`{"x":"a\\u12`, 'x')).toBe('a\\u12')
      expect(performance.now() - t0).toBeLessThan(50)
    })

    it('handles several escapes then a trailing backslash', () => {
      expect(extractJsonStringValue(`{"x":"a\\nb\\tc\\`, 'x')).toBe('a\nb\tc\\')
    })

    it('handles the very first char of the value being `\\` with no partner yet', () => {
      expect(extractJsonStringValue(`{"x":"\\`, 'x')).toBe('\\')
    })

    it('handles unknown escape char (\\z) same as old impl: keeps the backslash', () => {
      expect(extractJsonStringValue(`{"x":"a\\zb"}`, 'x')).toBe('a\\zb')
    })
  })

  describe('incremental streaming invariants', () => {
    it('a sequence of every-prefix parses terminates in bounded time', () => {
      // Simulate 2000 deltas of a growing JSON body with escapes sprinkled in.
      // Before the fix, any prefix ending in `\` would hang.
      const target = `{"file_path":"/x.ts","new_string":"line1\\nline2\\tfoo\\\\bar\\"quoted\\"end`
      const t0 = performance.now()
      for (let end = 1; end <= target.length; end++) {
        extractJsonStringValue(target.slice(0, end), 'new_string')
        extractJsonStringValue(target.slice(0, end), 'file_path')
        if (performance.now() - t0 > 1000) throw new Error(`stuck at prefix length ${end}`)
      }
      expect(performance.now() - t0).toBeLessThan(500)
    })

    it('agrees with a reference (JSON.parse) on complete inputs', () => {
      const cases = [
        `{"a":"plain"}`,
        `{"a":"a\\nb"}`,
        `{"a":"a\\"b\\\\c"}`,
        `{"a":"caf\\u00e9"}`,
      ]
      for (const c of cases) {
        const expected = (JSON.parse(c) as { a: string }).a
        expect(extractJsonStringValue(c, 'a')).toBe(expected)
      }
    })
  })
})

describe('extractJsonNumberValue', () => {
  it('extracts integers and floats', () => {
    expect(extractJsonNumberValue(`{"n":42}`, 'n')).toBe(42)
    expect(extractJsonNumberValue(`{"n":-3.14}`, 'n')).toBe(-3.14)
  })

  it('returns undefined when missing', () => {
    expect(extractJsonNumberValue(`{"m":1}`, 'n')).toBeUndefined()
  })
})
