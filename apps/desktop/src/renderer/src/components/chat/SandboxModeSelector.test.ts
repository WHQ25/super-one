import { describe, expect, it } from 'vitest'
import {
  coerceSandboxModeForHarness,
  harnessSandboxModes,
  harnessSandboxSupportLevel,
  harnessSupportsSandbox,
} from './sandboxHarness'

describe('Cursor sandbox harness helpers', () => {
  it('supports sandbox for Claude and Cursor only', () => {
    expect(harnessSupportsSandbox('claude')).toBe(true)
    expect(harnessSupportsSandbox('cursor')).toBe(true)
    expect(harnessSupportsSandbox('codex')).toBe(false)
    expect(harnessSupportsSandbox('acp')).toBe(false)
    expect(harnessSupportsSandbox('opencode')).toBe(false)
  })

  it('offers off/on for Cursor and full set for Claude', () => {
    expect(harnessSandboxModes('cursor')).toEqual(['off', 'on'])
    expect(harnessSandboxModes('claude')).toEqual(['off', 'on', 'auto'])
  })

  it('coerces Cursor auto sandbox to on', () => {
    expect(coerceSandboxModeForHarness('cursor', 'auto')).toBe('on')
    expect(coerceSandboxModeForHarness('cursor', 'on')).toBe('on')
    expect(coerceSandboxModeForHarness('cursor', 'off')).toBe('off')
    expect(coerceSandboxModeForHarness('claude', 'auto')).toBe('auto')
  })

  it('ignores Claude Linux conditional probe for Cursor', () => {
    expect(harnessSandboxSupportLevel('cursor', 'conditional')).toBe('always')
    expect(harnessSandboxSupportLevel('cursor', 'unsupported')).toBe('unsupported')
    expect(harnessSandboxSupportLevel('cursor', 'always')).toBe('always')
    expect(harnessSandboxSupportLevel('claude', 'conditional')).toBe('conditional')
  })
})
