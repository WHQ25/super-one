import { describe, expect, it } from 'vitest'
import { fenceHighlightLanguage } from './fence-language'

describe('fence citation languages', () => {
  it('reads the extension from a start:end:path citation', () => {
    expect(fenceHighlightLanguage('92:101:apps/desktop/src/renderer/src/components/chat/file-chip-context-menu.ts')).toBe('ts')
    expect(fenceHighlightLanguage('12:18:src/session.tsx')).toBe('tsx')
    expect(fenceHighlightLanguage('1:4:pkg/main.go')).toBe('go')
  })

  it('reads a single-line citation, a bare filename, and a windows path', () => {
    expect(fenceHighlightLanguage('12:src/app.py')).toBe('py')
    expect(fenceHighlightLanguage('notes.rs')).toBe('rs')
    expect(fenceHighlightLanguage('src/styles.css')).toBe('css')
    expect(fenceHighlightLanguage('10:20:C:\\Users\\me\\app.ts')).toBe('ts')
  })

  it('maps extensions the highlighter does not alias on its own', () => {
    expect(fenceHighlightLanguage('1:2:include/foo.hpp')).toBe('cpp')
    expect(fenceHighlightLanguage('icon.svg')).toBe('xml')
    expect(fenceHighlightLanguage('Dockerfile')).toBe('dockerfile')
    expect(fenceHighlightLanguage('script.rhai')).toBe('rhai')
  })

  it('leaves ordinary language tags unchanged', () => {
    expect(fenceHighlightLanguage('typescript')).toBe('typescript')
    expect(fenceHighlightLanguage('TS')).toBe('TS')
    expect(fenceHighlightLanguage('c++')).toBe('c++')
    expect(fenceHighlightLanguage('mermaid')).toBe('mermaid')
    expect(fenceHighlightLanguage('')).toBe('')
  })
})
