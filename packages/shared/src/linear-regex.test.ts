import { describe, expect, it } from 'vitest'
import { compileLinearRegex, UnsupportedPattern } from './linear-regex'

const PATTERNS = [
  '^(cad|file):',
  '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  '^\\d{4}-\\d{2}-\\d{2}$',
  'a|b|',
  '(?:ab)+c?',
  '^(?<scheme>[a-z][a-z0-9+.-]*):\\/\\/',
  'x{2,3}y{0,}z{1}',
  '\\bword\\b',
  '\\Bin\\B',
  '^$',
  '',
  '[\\]\\-a-c]+',
  '[^a-z]',
  '\\p{L}+\\p{Nd}',
  '\\u{1F600}|\\uD83D\\uDE00',
  '\\x41\\u0042\\cJ?',
  '.+?!',
  '^(a|ab)(c|bcd)(d*)$',
  '(a*)*b',
  '^(a+)+$',
]

const INPUTS = ['', 'a', 'ab', 'abc', 'abcd', 'cad://parts/hex', 'file:/x', 'https://x.y', 'name@example.com', 'a@b', '2026-10-01',
  'xxyz', 'xxxyyyz', 'a word here', 'within', 'éa1', '😀', 'AB\n', '!', 'aaab', 'aaaa', 'ABC', 'ac', 'c-]', 'x://']

describe('compileLinearRegex', () => {
  it.each(PATTERNS)('agrees with the native engine on %j', (pattern) => {
    const linear = compileLinearRegex(pattern)
    const native = new RegExp(pattern, 'u')
    for (const input of INPUTS) expect([input, linear.test(input)]).toEqual([input, native.test(input)])
  })

  it.each([
    ['^(a+)+$', `${'a'.repeat(5000)}!`],
    ['(a|a)*b', 'a'.repeat(5000)],
    ['^([a-z]+)*$', `${'a'.repeat(5000)}1`],
    ['^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', `a@${'.'.repeat(5000)}@`],
    ['\\d+\\d+\\d+x', '1'.repeat(5000)],
  ])('runs %j in linear time', (pattern, input) => {
    const linear = compileLinearRegex(pattern)
    const start = performance.now()
    expect(linear.test(input)).toBe(false)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it.each([
    ['(a)\\1', 'a backreference'],
    ['(?<n>a)\\k<n>', 'a backreference'],
    ['a(?=b)', 'lookaround'],
    ['(?<!a)b', 'lookaround'],
    ['(?:a{1000}){1000}', 'too complex'],
  ])('reports %j as unsupported (%s)', (pattern, reason) => {
    expect(() => compileLinearRegex(pattern)).toThrow(new UnsupportedPattern(reason))
  })

  it('rejects invalid syntax like the native engine', () => {
    expect(() => compileLinearRegex('(')).toThrow(SyntaxError)
    expect(() => compileLinearRegex('a**')).toThrow(SyntaxError)
  })
})
