import { describe, it, expect } from 'vitest'
import { parseAnsi, parseAnsiToTailwind } from './ansi'

describe('parseAnsi', () => {
  it('should return plain text as a single span', () => {
    expect(parseAnsi('hello world')).toEqual([
      { text: 'hello world', bold: false, dim: false, color: null },
    ])
  })

  it('should parse bold text', () => {
    const spans = parseAnsi('\x1b[1mbold\x1b[0m normal')
    expect(spans).toEqual([
      { text: 'bold', bold: true, dim: false, color: null },
      { text: ' normal', bold: false, dim: false, color: null },
    ])
  })

  it('should parse dim text', () => {
    const spans = parseAnsi('\x1b[2mdim\x1b[0m')
    expect(spans).toEqual([
      { text: 'dim', bold: false, dim: true, color: null },
    ])
  })

  it('should parse foreground colors', () => {
    const spans = parseAnsi('\x1b[31mred\x1b[32mgreen\x1b[0m')
    expect(spans).toHaveLength(2)
    expect(spans[0]).toEqual({ text: 'red', bold: false, dim: false, color: '#f87171' })
    expect(spans[1]).toEqual({ text: 'green', bold: false, dim: false, color: '#4ade80' })
  })

  it('should parse bright colors (90-97)', () => {
    const spans = parseAnsi('\x1b[97mbright white\x1b[0m')
    expect(spans[0].color).toBe('#ffffff')
  })

  it('should handle reset code 0', () => {
    const spans = parseAnsi('\x1b[1;31mbold red\x1b[0mnormal')
    expect(spans[0]).toEqual({ text: 'bold red', bold: true, dim: false, color: '#f87171' })
    expect(spans[1]).toEqual({ text: 'normal', bold: false, dim: false, color: null })
  })

  it('should handle combined codes in single escape', () => {
    const spans = parseAnsi('\x1b[1;33myellow bold\x1b[0m')
    expect(spans[0]).toEqual({ text: 'yellow bold', bold: true, dim: false, color: '#facc15' })
  })

  it('should handle code 22 to reset bold/dim', () => {
    const spans = parseAnsi('\x1b[1mbold\x1b[22mnot bold')
    expect(spans[0].bold).toBe(true)
    expect(spans[1].bold).toBe(false)
  })

  it('should handle code 39 to reset color', () => {
    const spans = parseAnsi('\x1b[31mred\x1b[39mdefault')
    expect(spans[0].color).toBe('#f87171')
    expect(spans[1].color).toBeNull()
  })

  it('should return empty array for empty string', () => {
    expect(parseAnsi('')).toEqual([])
  })

  it('should handle consecutive escape codes without text', () => {
    const spans = parseAnsi('\x1b[31m\x1b[1mbold red\x1b[0m')
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({ text: 'bold red', bold: true, dim: false, color: '#f87171' })
  })

  it('should handle text after all escape codes', () => {
    const spans = parseAnsi('prefix\x1b[32mgreen')
    expect(spans).toEqual([
      { text: 'prefix', bold: false, dim: false, color: null },
      { text: 'green', bold: false, dim: false, color: '#4ade80' },
    ])
  })
})

describe('parseAnsiToTailwind', () => {
  it('should return plain text with default class', () => {
    expect(parseAnsiToTailwind('hello')).toEqual([
      { text: 'hello', className: 'text-zinc-300' },
    ])
  })

  it('should map ANSI colors to Tailwind classes', () => {
    const spans = parseAnsiToTailwind('\x1b[31mred\x1b[0m rest')
    expect(spans[0]).toEqual({ text: 'red', className: 'text-red-400' })
    expect(spans[1]).toEqual({ text: ' rest', className: 'text-zinc-300' })
  })

  it('should handle bold modifier', () => {
    const spans = parseAnsiToTailwind('\x1b[1mbold\x1b[0m')
    expect(spans[0].className).toContain('font-bold')
  })

  it('should reset to default on code 0', () => {
    const spans = parseAnsiToTailwind('\x1b[34mblue\x1b[0mdefault')
    expect(spans[1].className).toBe('text-zinc-300')
  })

  it('should reset to default on code 39', () => {
    const spans = parseAnsiToTailwind('\x1b[35mpurple\x1b[39mdefault')
    expect(spans[1].className).toBe('text-zinc-300')
  })

  it('should return empty array for empty string', () => {
    expect(parseAnsiToTailwind('')).toEqual([])
  })
})
