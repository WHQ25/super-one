import { describe, expect, it } from 'vitest'
import {
  DARK_TERMINAL_PALETTES,
  DEFAULT_DARK_PALETTE_ID,
  DEFAULT_LIGHT_PALETTE_ID,
  LIGHT_TERMINAL_PALETTES,
  clampTerminalFontSize,
  getTerminalPalette,
  terminalPalettesFor,
} from './terminal-palettes'

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

describe('terminal palettes', () => {
  it('resolves a known palette within its own scheme', () => {
    expect(getTerminalPalette('dracula', 'dark').id).toBe('dracula')
    expect(getTerminalPalette('bluloco-light', 'light').id).toBe('bluloco-light')
  })

  it('falls back to the scheme default for unknown, null, empty, or cross-scheme ids', () => {
    expect(getTerminalPalette('does-not-exist', 'dark').id).toBe(DEFAULT_DARK_PALETTE_ID)
    expect(getTerminalPalette(null, 'light').id).toBe(DEFAULT_LIGHT_PALETTE_ID)
    expect(getTerminalPalette('', 'dark').id).toBe(DEFAULT_DARK_PALETTE_ID)
    // a dark-only id requested for the light scheme falls back to the light default
    expect(getTerminalPalette('dracula', 'light').id).toBe(DEFAULT_LIGHT_PALETTE_ID)
  })

  it('defines a complete 16-color ANSI set for every palette in both schemes', () => {
    for (const palette of [...DARK_TERMINAL_PALETTES, ...LIGHT_TERMINAL_PALETTES]) {
      for (const key of ANSI_KEYS) {
        expect(palette.ansi[key], `${palette.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('exposes the scheme default inside its own list only', () => {
    expect(terminalPalettesFor('dark').some((p) => p.id === DEFAULT_DARK_PALETTE_ID)).toBe(true)
    expect(terminalPalettesFor('light').some((p) => p.id === DEFAULT_LIGHT_PALETTE_ID)).toBe(true)
    expect(terminalPalettesFor('light').some((p) => p.id === DEFAULT_DARK_PALETTE_ID)).toBe(false)
  })

  it('clamps font size into [12, 22] and rejects non-numbers', () => {
    expect(clampTerminalFontSize(14)).toBe(14)
    expect(clampTerminalFontSize(4)).toBe(12)
    expect(clampTerminalFontSize(99)).toBe(22)
    expect(clampTerminalFontSize(13.6)).toBe(14)
    expect(clampTerminalFontSize('big')).toBe(14)
    expect(clampTerminalFontSize(NaN)).toBe(14)
  })
})
