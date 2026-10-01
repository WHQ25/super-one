import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSingleCodePointAtom, compileLinearRegex, UnsupportedPattern } from './linear-regex'

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
  '(?:^)*a(\\b)+|(?:$|x)?',
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

describe('atom isolation', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it.each(['.', '[ab]', '[(]', '[+*]', '[\\]]', '[^a-z]', '[\\p{L}()|*]', '\\p{Script=Greek}', '\\P{L}', '\\(', '\\)', '\\d', '\\u{1F600}',
    '\\uD83D\\uDE00', '\\u0041', '\\x41', '\\cJ', '\\0', '\\.', '\\/'])('accepts the single-code-point atom %j', (atom) => {
    expect(() => assertSingleCodePointAtom(atom)).not.toThrow()
  })

  it.each(['(a+)+', 'ab', '[a]b', '[a]|[b]', '\\d+', '\\p{L}*', '.*', '[a]{2}', '^.', '.$', '(?:.)', '[a', '', '\\1', '\\d\\d'])(
    'fails closed on %j', (atom) => {
      expect(() => assertSingleCodePointAtom(atom)).toThrow(new UnsupportedPattern('an unexpected atom'))
    })

  it('hands the native engine only single-code-point atoms for tricky patterns', () => {
    const NativeRegExp = RegExp
    const sources: string[] = []
    vi.spyOn(globalThis, 'RegExp').mockImplementation(function (this: unknown, source: string | RegExp, flags?: string) {
      sources.push(String(source instanceof NativeRegExp ? source.source : source))
      return new NativeRegExp(source, flags)
    } as unknown as RegExpConstructor)
    const patterns = ['[(]+(a)', '[+*]{2}x', '[\\]]*\\]', '\\p{L}+\\P{L}?', '\\(\\)|\\[\\]', '[|()?]+|.', '[^)]*\\)', '(?:[{}]|\\{)+']
    for (const pattern of patterns) {
      const linear = compileLinearRegex(pattern)
      for (const input of ['((a', '+*x', ']]]]', 'éé1', '()', '|?', 'ab)', '{}{']) linear.test(input)
    }
    const atoms = sources.filter((source) => source.startsWith('^(?:')).map((source) => source.slice(4, -2))
    expect(atoms.length).toBeGreaterThan(0)
    for (const atom of atoms) expect(() => assertSingleCodePointAtom(atom)).not.toThrow()
    // Whole patterns are only ever constructed for the syntax check, never matched.
    expect(sources.filter((source) => !source.startsWith('^(?:')).sort()).toEqual([...patterns].sort())
  })
})

describe('differential fuzz against the native engine', () => {
  // Deterministic PRNG so failures reproduce; mulberry32.
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const ATOMS = ['a', 'b', 'c', '.', '[ab]', '[^a]', '\\d', '\\w', '[a-c1]', '\\.']
  const QUANTIFIERS = ['', '', '*', '+', '?', '{2}', '{0,2}', '{1,}', '*?', '+?']

  function pattern(next: () => number, depth: number): string {
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!
    const piece = (): string => {
      const roll = next()
      if (depth < 2 && roll < 0.2) return `(${pattern(next, depth + 1)})${pick(QUANTIFIERS)}`
      if (depth < 2 && roll < 0.3) return `(?:${pattern(next, depth + 1)})${pick(QUANTIFIERS)}`
      if (roll < 0.36) return pick(['^', '$', '\\b', '\\B'])
      return `${pick(ATOMS)}${pick(QUANTIFIERS)}`
    }
    const branch = () => Array.from({ length: 1 + Math.floor(next() * 3) }, piece).join('')
    return next() < 0.25 ? `${branch()}|${branch()}` : branch()
  }

  it('agrees on 400 generated patterns', () => {
    const next = rng(20261001)
    let cases = 0
    for (let n = 0; n < 400; n++) {
      const source = pattern(next, 0)
      const native = new RegExp(source, 'u')
      const linear = compileLinearRegex(source)
      for (let k = 0; k < 6; k++) {
        const input = Array.from({ length: Math.floor(next() * 7) }, () => 'abc1. '[Math.floor(next() * 6)]).join('')
        expect([source, input, linear.test(input)]).toEqual([source, input, native.test(input)])
        cases++
      }
    }
    expect(cases).toBe(2400)
  })
})
