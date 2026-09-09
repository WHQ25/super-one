import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_MAX_BYTES, highlightLines, languageForFileName, plainLines } from './code-highlight'

describe('languageForFileName', () => {
  it('maps common extensions and well-known basenames', () => {
    expect(languageForFileName('src/app.tsx')).toBe('typescript')
    expect(languageForFileName('C:\\repo\\main.py')).toBe('python')
    expect(languageForFileName('Dockerfile')).toBe('dockerfile')
    expect(languageForFileName('Makefile')).toBe('makefile')
    expect(languageForFileName('index.html')).toBe('xml')
  })

  it('returns null for unknown or extension-less names', () => {
    expect(languageForFileName('LICENSE')).toBeNull()
    expect(languageForFileName('notes.unknownext')).toBeNull()
  })
})

describe('highlightLines', () => {
  it('splits into lines and colours keywords, strings and comments', () => {
    const lines = highlightLines('const a = "x" // hi\nreturn a\n', 'a.ts', 'dark')
    expect(lines).toHaveLength(2)
    expect(lines[0].map((s) => s.text).join('')).toBe('const a = "x" // hi')
    expect(lines[1].map((s) => s.text).join('')).toBe('return a')
    const keyword = lines[0].find((s) => s.text === 'const')
    const str = lines[0].find((s) => s.text === '"x"')
    const comment = lines[0].find((s) => s.text === '// hi')
    expect(keyword?.color).toBe('#ff7b72')
    expect(str?.color).toBe('#a5d6ff')
    expect(comment).toMatchObject({ color: '#8b949e', italic: true })
  })

  it('uses the light palette for the light scheme', () => {
    const [line] = highlightLines('return 1', 'a.js', 'light')
    expect(line.find((s) => s.text === 'return')?.color).toBe('#d73a49')
  })

  it('keeps blank lines as empty entries and preserves text across a multi-line token', () => {
    const lines = highlightLines('/* a\n\nb */\nx', 'a.c', 'dark')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toEqual([])
    expect(lines[0][0]).toMatchObject({ text: '/* a', italic: true })
    expect(lines[2][0]).toMatchObject({ text: 'b */', italic: true })
    expect(lines[3].map((s) => s.text).join('')).toBe('x')
  })

  it('falls back to plain lines for unknown languages and oversized files', () => {
    expect(highlightLines('hello\nworld', 'README', 'dark')).toEqual(plainLines('hello\nworld'))
    const big = 'x = 1\n'.repeat(HIGHLIGHT_MAX_BYTES / 6 + 10)
    const lines = highlightLines(big, 'big.py', 'dark')
    expect(lines[0]).toEqual([{ text: 'x = 1' }])
  })
})

describe('plainLines', () => {
  it('drops the terminating newline and keeps interior blanks', () => {
    expect(plainLines('a\n\nb\n')).toEqual([[{ text: 'a' }], [], [{ text: 'b' }]])
  })
})
