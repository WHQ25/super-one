import { describe, expect, it } from 'vitest'
import { escapeHtml, renderMarkdownLite, renderTodos } from './markdown'

describe('markdown lite', () => {
  it('escapes HTML then applies a closed subset', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
    expect(renderMarkdownLite('use `foo` and **bar**')).toContain('<code>foo</code>')
    expect(renderMarkdownLite('use `foo` and **bar**')).toContain('<strong>bar</strong>')
    expect(renderMarkdownLite('[x](https://ex)')).toContain('<a href="https://ex">x</a>')
    expect(renderMarkdownLite('[x](javascript:alert(1))')).not.toContain('<a ')
  })

  it('renders todo rows from a map or list', () => {
    const html = renderTodos({ a: { id: 'a', content: 'Ship', status: 'completed' } })
    expect(html).toContain('✓')
    expect(html).toContain('Ship')
    expect(renderTodos([])).toBe('')
  })
})
