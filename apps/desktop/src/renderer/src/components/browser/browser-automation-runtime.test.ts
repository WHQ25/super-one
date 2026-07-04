/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import { HELPERS } from './browser-automation-runtime'

interface Sone {
  selectorOf(el: Element): string | null
  dynamicToken(v: string): boolean
  stableSelector(el: Element): string | null
}

if (!(globalThis as { CSS?: unknown }).CSS) {
  ;(globalThis as { CSS?: unknown }).CSS = { escape: (v: string) => String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) }
}

function makeSone(): Sone {
  return new Function(HELPERS + '\nreturn __sone;')() as Sone
}

describe('selectorOf', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('prefers a stable id', () => {
    document.body.innerHTML = '<button id="save">Save</button>'
    expect(makeSone().selectorOf(document.querySelector('#save')!)).toBe('#save')
  })

  it('skips framework-generated ids and falls back to a stable attribute', () => {
    document.body.innerHTML = '<button id="radix-:r3:" data-testid="submit">Go</button>'
    expect(makeSone().selectorOf(document.querySelector('[data-testid=submit]')!)).toBe('button[data-testid="submit"]')
  })

  it('drops CSS-in-JS hash classes from the path but keeps semantic ones', () => {
    document.body.innerHTML = '<section><div class="css-1a2b3c card"><span>x</span></div></section>'
    const sel = makeSone().selectorOf(document.querySelector('.card')!)!
    expect(sel).toContain('.card')
    expect(sel).not.toContain('css-1a2b3c')
  })

  it('uses a unique name attribute', () => {
    document.body.innerHTML = '<form><input name="email"><input name="password"></form>'
    expect(makeSone().selectorOf(document.querySelector('[name=email]')!)).toBe('input[name="email"]')
  })

  it('does not use a non-unique attribute', () => {
    document.body.innerHTML = '<div data-testid="row"></div><div data-testid="row"></div>'
    const sel = makeSone().selectorOf(document.querySelectorAll('[data-testid=row]')[0]!)!
    expect(sel).not.toContain('data-testid')
    expect(sel).toContain(':nth-of-type(1)')
  })
})

describe('dynamicToken', () => {
  it('flags generated tokens and spares stable ones', () => {
    const sone = makeSone()
    expect(sone.dynamicToken('css-1a2b3c')).toBe(true)
    expect(sone.dynamicToken('radix-:r3:')).toBe(true)
    expect(sone.dynamicToken('e1a2b3c4')).toBe(true)
    expect(sone.dynamicToken('a1b2c3d4e5f6')).toBe(true)
    expect(sone.dynamicToken('btn-primary')).toBe(false)
    expect(sone.dynamicToken('card')).toBe(false)
    expect(sone.dynamicToken('px-4')).toBe(false)
  })
})
