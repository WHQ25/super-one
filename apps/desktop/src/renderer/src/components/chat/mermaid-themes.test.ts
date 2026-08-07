import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DARK_MERMAID_THEME_ID,
  DEFAULT_LIGHT_MERMAID_THEME_ID,
  getMermaidThemeOption,
  isMermaidThemeId,
  mermaidThemesFor,
  resolveMermaidThemeId,
} from './mermaid-themes'

describe('mermaid-themes', () => {
  it('exposes non-empty light and dark catalogs', () => {
    expect(mermaidThemesFor('light').length).toBeGreaterThan(0)
    expect(mermaidThemesFor('dark').length).toBeGreaterThan(0)
  })

  it('resolves null / unknown to scheme defaults', () => {
    expect(resolveMermaidThemeId('light', null)).toBe(DEFAULT_LIGHT_MERMAID_THEME_ID)
    expect(resolveMermaidThemeId('dark', null)).toBe(DEFAULT_DARK_MERMAID_THEME_ID)
    expect(resolveMermaidThemeId('light', 'not-a-theme')).toBe(DEFAULT_LIGHT_MERMAID_THEME_ID)
    expect(resolveMermaidThemeId('dark', 'forest')).toBe(DEFAULT_DARK_MERMAID_THEME_ID)
  })

  it('keeps valid ids for the matching scheme', () => {
    expect(resolveMermaidThemeId('light', 'neo')).toBe('neo')
    expect(resolveMermaidThemeId('dark', 'redux-dark-color')).toBe('redux-dark-color')
    // neutral is valid for both schemes
    expect(resolveMermaidThemeId('light', 'neutral')).toBe('neutral')
    expect(resolveMermaidThemeId('dark', 'neutral')).toBe('neutral')
  })

  it('rejects a light-only id when resolving for dark (and vice versa)', () => {
    expect(resolveMermaidThemeId('dark', 'default')).toBe(DEFAULT_DARK_MERMAID_THEME_ID)
    expect(resolveMermaidThemeId('light', 'dark')).toBe(DEFAULT_LIGHT_MERMAID_THEME_ID)
  })

  it('getMermaidThemeOption returns a named option for the resolved id', () => {
    expect(getMermaidThemeOption('light', 'forest')).toMatchObject({ id: 'forest', name: 'Forest' })
    expect(getMermaidThemeOption('light', null)).toMatchObject({ id: 'default', name: 'Default Light' })
    expect(getMermaidThemeOption('dark', null)).toMatchObject({
      id: DEFAULT_DARK_MERMAID_THEME_ID,
      name: 'Default Dark',
    })
  })

  it('isMermaidThemeId accepts catalog ids only', () => {
    expect(isMermaidThemeId('default')).toBe(true)
    expect(isMermaidThemeId('neo-dark')).toBe(true)
    expect(isMermaidThemeId('base')).toBe(false)
    expect(isMermaidThemeId(null)).toBe(false)
  })
})
