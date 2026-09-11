import { describe, expect, it } from 'vitest'
import { applyDocumentTheme, initialDocumentScheme, type ThemedElement } from './document-theme'

/** Enough of an element to observe what the theme writes and clears. */
function fakeElement(inline: Record<string, string> = {}) {
  const style = { ...inline }
  const classes = new Set<string>()
  const element: ThemedElement = {
    style: {
      colorScheme: '',
      setProperty: (name, value) => { style[name] = value },
      removeProperty: (name) => { const previous = style[name] ?? ''; delete style[name]; return previous },
    },
    classList: {
      contains: (token) => classes.has(token),
      toggle: (token, force) => {
        const on = force ?? !classes.has(token)
        if (on) classes.add(token); else classes.delete(token)
        return on
      },
    },
  }
  return { element, style, classes }
}

describe('applyDocumentTheme', () => {
  it('stamps hue, scheme and the dark class on the root', () => {
    const root = fakeElement()
    applyDocumentTheme(root.element, null, { hue: 30, scheme: 'dark' })
    expect(root.style['--brand-hue']).toBe('30')
    expect(root.element.style.colorScheme).toBe('dark')
    expect(root.classes.has('dark')).toBe(true)

    applyDocumentTheme(root.element, null, { hue: 30, scheme: 'light' })
    expect(root.element.style.colorScheme).toBe('light')
    expect(root.classes.has('dark')).toBe(false)
  })

  it('clears the host pre-paint background so the stylesheet follows the scheme', () => {
    const root = fakeElement({ background: '#fafafa' })
    const body = fakeElement({ background: '#fafafa' })
    applyDocumentTheme(root.element, body.element, { hue: 250, scheme: 'dark' })
    expect(root.style.background).toBeUndefined()
    expect(body.style.background).toBeUndefined()
  })
})

describe('initialDocumentScheme', () => {
  it('reads the scheme the host pre-painted', () => {
    const root = fakeElement()
    expect(initialDocumentScheme(root.element)).toBe('light')
    root.classes.add('dark')
    expect(initialDocumentScheme(root.element)).toBe('dark')
  })
})
