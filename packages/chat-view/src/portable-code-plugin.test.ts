import { describe, expect, it } from 'vitest'
import { createPortableCodePlugin, resolveLanguage } from './portable-code-plugin'

const TS = 'export const answer: number = 42\n'

describe('resolveLanguage', () => {
  it('maps the TypeScript and JSX family onto the one tsx grammar', () => {
    expect(resolveLanguage('ts')).toBe('tsx')
    expect(resolveLanguage('typescript')).toBe('tsx')
    expect(resolveLanguage('TSX')).toBe('tsx')
    expect(resolveLanguage('jsx')).toBe('tsx')
  })

  it('resolves the grammars html drags in, so a bare js fence still highlights', () => {
    expect(resolveLanguage('js')).toBe('javascript')
    expect(resolveLanguage('javascript')).toBe('javascript')
    expect(resolveLanguage('css')).toBe('css')
  })

  it('folds shell dialects onto shellscript', () => {
    for (const tag of ['sh', 'bash', 'zsh', 'shell', 'console']) {
      expect(resolveLanguage(tag)).toBe('shellscript')
    }
  })

  it('returns null for a grammar this document does not carry', () => {
    // Deliberately outside the curated set — the block stays monochrome.
    expect(resolveLanguage('fortran')).toBeNull()
    expect(resolveLanguage('')).toBeNull()
  })
})

describe('createPortableCodePlugin', () => {
  it.each(['github-dark', 'github-light'] as const)('colours tokens under %s', (theme) => {
    const plugin = createPortableCodePlugin(theme)
    const result = plugin.highlight({ code: TS, language: 'ts', themes: [theme, theme] })
    expect(result).not.toBeNull()
    const colors = result!.tokens.flat().map((token) => token.color).filter(Boolean)
    // Monochrome output would leave every token on the foreground colour.
    expect(new Set(colors).size).toBeGreaterThan(1)
  })

  it('highlights synchronously, so the presenter never waits on a callback', () => {
    const plugin = createPortableCodePlugin('github-dark')
    let calledBack = false
    const result = plugin.highlight(
      { code: TS, language: 'ts', themes: ['github-dark', 'github-dark'] },
      () => { calledBack = true },
    )
    expect(result).not.toBeNull()
    expect(calledBack).toBe(false)
  })

  it('declines an unsupported language instead of falling back to plain text', () => {
    const plugin = createPortableCodePlugin('github-dark')
    expect(plugin.supportsLanguage('fortran' as never)).toBe(false)
    expect(plugin.highlight({ code: TS, language: 'fortran' as never, themes: ['github-dark', 'github-dark'] })).toBeNull()
  })
})
