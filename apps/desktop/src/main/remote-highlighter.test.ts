import { parseAnsiTokens, highlightCodeSync, highlightCodeByLang } from './remote-highlighter'

describe('parseAnsiTokens', () => {
  it('should return single empty token for empty string', () => {
    expect(parseAnsiTokens('')).toEqual([[['', null]]])
  })

  it('should return plain text with null color', () => {
    expect(parseAnsiTokens('hello world')).toEqual([[['hello world', null]]])
  })

  it('should parse basic foreground colors', () => {
    const result = parseAnsiTokens('\x1b[31mred text')
    expect(result).toEqual([[['red text', '#ff7b72']]])
  })

  it('should parse green foreground', () => {
    const result = parseAnsiTokens('\x1b[32mgreen')
    expect(result).toEqual([[['green', '#7ee787']]])
  })

  it('should parse bright/high-intensity foreground colors', () => {
    const result = parseAnsiTokens('\x1b[91mbright red')
    expect(result).toEqual([[['bright red', '#ffa198']]])
  })

  it('should handle reset with \\x1b[0m', () => {
    const result = parseAnsiTokens('\x1b[31mred\x1b[0m plain')
    expect(result).toEqual([[['red', '#ff7b72'], [' plain', null]]])
  })

  it('should handle reset with \\x1b[m (no code)', () => {
    const result = parseAnsiTokens('\x1b[31mred\x1b[m plain')
    expect(result).toEqual([[['red', '#ff7b72'], [' plain', null]]])
  })

  it('should handle reset with code 39', () => {
    const result = parseAnsiTokens('\x1b[31mred\x1b[39m default')
    expect(result).toEqual([[['red', '#ff7b72'], [' default', null]]])
  })

  it('should handle 24-bit RGB color', () => {
    const result = parseAnsiTokens('\x1b[38;2;255;128;0mrgb text')
    expect(result).toEqual([[['rgb text', '#ff8000']]])
  })

  it('should handle 24-bit RGB with zero components', () => {
    const result = parseAnsiTokens('\x1b[38;2;0;0;0mblack')
    expect(result).toEqual([[['black', '#000000']]])
  })

  it('should handle 256-color mode (skips without setting color)', () => {
    const result = parseAnsiTokens('\x1b[38;5;196mtext')
    expect(result).toEqual([[['text', null]]])
  })

  it('should ignore bold/unbold modifiers', () => {
    const result = parseAnsiTokens('\x1b[1mbold text')
    expect(result).toEqual([[['bold text', null]]])
  })

  it('should ignore code 22 (unbold)', () => {
    const result = parseAnsiTokens('\x1b[22mnormal')
    expect(result).toEqual([[['normal', null]]])
  })

  it('should handle multiple colors in sequence', () => {
    const result = parseAnsiTokens('\x1b[31mred \x1b[32mgreen')
    expect(result).toEqual([[['red ', '#ff7b72'], ['green', '#7ee787']]])
  })

  it('should carry color state across lines', () => {
    const result = parseAnsiTokens('\x1b[31mline1\nline2')
    expect(result).toEqual([
      [['line1', '#ff7b72']],
      [['line2', '#ff7b72']],
    ])
  })

  it('should handle multiple lines with color changes', () => {
    const result = parseAnsiTokens('plain\n\x1b[31mred\n\x1b[0mback')
    expect(result).toEqual([
      [['plain', null]],
      [['red', '#ff7b72']],
      [['back', null]],
    ])
  })

  it('should return empty token for blank lines', () => {
    const result = parseAnsiTokens('a\n\nb')
    expect(result).toEqual([
      [['a', null]],
      [['', null]],
      [['b', null]],
    ])
  })

  it('should handle text before and after escape sequences', () => {
    const result = parseAnsiTokens('before\x1b[31mred\x1b[0mafter')
    expect(result).toEqual([[['before', null], ['red', '#ff7b72'], ['after', null]]])
  })

  it('should handle combined SGR codes in one sequence', () => {
    const result = parseAnsiTokens('\x1b[1;31mbold red')
    expect(result).toEqual([[['bold red', '#ff7b72']]])
  })

  it('should handle unknown SGR codes gracefully', () => {
    const result = parseAnsiTokens('\x1b[3;4mitalic underline text')
    expect(result).toEqual([[['italic underline text', null]]])
  })

  it('should handle background color codes (no effect on color)', () => {
    const result = parseAnsiTokens('\x1b[41mred bg text')
    expect(result).toEqual([[['red bg text', null]]])
  })

  it('should handle consecutive escape sequences with no text between', () => {
    const result = parseAnsiTokens('\x1b[1m\x1b[31mtext')
    expect(result).toEqual([[['text', '#ff7b72']]])
  })

  it('should handle RGB with missing components (defaults to 0)', () => {
    const result = parseAnsiTokens('\x1b[38;2;255m partial rgb')
    expect(result).toEqual([[[' partial rgb', '#ff0000']]])
  })

  it('should handle all basic SGR foreground colors', () => {
    const cases: [number, string][] = [
      [30, '#6e7681'], [31, '#ff7b72'], [32, '#7ee787'], [33, '#e3b341'],
      [34, '#79c0ff'], [35, '#d2a8ff'], [36, '#a5d6ff'], [37, '#c9d1d9'],
      [90, '#8b949e'], [91, '#ffa198'], [92, '#9beeac'], [93, '#f0d674'],
      [94, '#a5c6ff'], [95, '#e2c5ff'], [96, '#bce8ff'], [97, '#f0f6fc'],
    ]
    for (const [code, hex] of cases) {
      const result = parseAnsiTokens(`\x1b[${code}mx`)
      expect(result).toEqual([[['x', hex]]])
    }
  })
})

describe('highlightCodeSync', () => {
  it('should return null when highlighter is not initialized', () => {
    expect(highlightCodeSync('const x = 1', 'test.ts')).toBeNull()
  })

  it('should return null for unknown file extensions', () => {
    expect(highlightCodeSync('data', 'file.xyz')).toBeNull()
  })
})

describe('highlightCodeByLang', () => {
  it('should return null when highlighter is not initialized', () => {
    expect(highlightCodeByLang('const x = 1', 'typescript')).toBeNull()
  })
})
