import { describe, expect, it } from 'vitest'
import { terminalKeySequence } from './terminal-keys'

describe('terminalKeySequence', () => {
  it('maps fixed keys case-insensitively', () => {
    expect(terminalKeySequence('Enter')).toBe('\r')
    expect(terminalKeySequence('TAB')).toBe('\t')
    expect(terminalKeySequence('escape')).toBe('\x1b')
    expect(terminalKeySequence('Backspace')).toBe('\x7f')
    expect(terminalKeySequence('F5')).toBe('\x1b[15~')
  })

  it('maps control chords', () => {
    expect(terminalKeySequence('Ctrl+C')).toBe('\x03')
    expect(terminalKeySequence('ctrl+d')).toBe('\x04')
    expect(terminalKeySequence('Ctrl+Z')).toBe('\x1a')
    expect(terminalKeySequence('Ctrl+[')).toBe('\x1b')
    expect(terminalKeySequence('Ctrl+Shift')).toBeNull()
  })

  it('switches cursor keys with application cursor mode', () => {
    expect(terminalKeySequence('Up')).toBe('\x1b[A')
    expect(terminalKeySequence('Up', { applicationCursor: true })).toBe('\x1bOA')
    expect(terminalKeySequence('Home', { applicationCursor: true })).toBe('\x1bOH')
  })

  it('prefixes alt chords with ESC', () => {
    expect(terminalKeySequence('Alt+b')).toBe('\x1bb')
    expect(terminalKeySequence('Alt+Left')).toBe('\x1b\x1b[D')
  })

  it('rejects unknown names', () => {
    expect(terminalKeySequence('Hyper')).toBeNull()
    expect(terminalKeySequence('')).toBeNull()
  })
})
