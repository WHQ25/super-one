import { describe, expect, it } from 'vitest'
import { harnessDisplayName, harnessSupportsAdditionalDirs, MOBILE_HARNESS_IDS } from './provider-state'

describe('mobile provider state', () => {
  it('exposes every desktop harness', () => {
    expect(MOBILE_HARNESS_IDS).toEqual([
      'claude',
      'codex',
      'acp',
      'opencode',
      'cursor',
      'dsh',
    ])
  })

  it('uses shared capability flags for additional directories', () => {
    expect(harnessSupportsAdditionalDirs('claude')).toBe(true)
    expect(harnessSupportsAdditionalDirs('codex')).toBe(true)
    expect(harnessSupportsAdditionalDirs('opencode')).toBe(false)
    expect(harnessSupportsAdditionalDirs('cursor')).toBe(false)
  })

  it('uses desktop harness display names', () => {
    expect(harnessDisplayName('dsh')).toBe('DeepSeek')
    expect(harnessDisplayName('opencode')).toBe('OpenCode')
  })
})
