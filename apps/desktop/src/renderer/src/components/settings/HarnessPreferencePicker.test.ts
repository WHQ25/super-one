import { describe, expect, it } from 'vitest'
import {
  formatHarnessPreferenceLabel,
  harnessPreferenceToKey,
  harnessPreferencesEqual,
  isHarnessPreferenceFieldKey,
  keyToHarnessPreference,
} from './HarnessPreferencePicker'

describe('harness preference key helpers', () => {
  it('round-trips top-level harnesses and ACP agents', () => {
    expect(keyToHarnessPreference('claude')).toEqual({ provider: 'claude', acpAgentId: null })
    expect(keyToHarnessPreference('acp:grok-build')).toEqual({
      provider: 'acp',
      acpAgentId: 'grok-build',
    })
    expect(harnessPreferenceToKey({ provider: 'codex', acpAgentId: null })).toBe('codex')
    expect(harnessPreferenceToKey({ provider: 'acp', acpAgentId: 'grok-build' })).toBe('acp:grok-build')
  })

  it('treats null/auto/empty as Auto', () => {
    expect(keyToHarnessPreference(null)).toBeNull()
    expect(keyToHarnessPreference('auto')).toBeNull()
    expect(keyToHarnessPreference('')).toBeNull()
    expect(harnessPreferenceToKey(null)).toBeNull()
  })

  it('compares preferences including ACP agent ids', () => {
    expect(harnessPreferencesEqual(
      { provider: 'acp', acpAgentId: 'grok-build' },
      { provider: 'acp', acpAgentId: 'grok-build' },
    )).toBe(true)
    expect(harnessPreferencesEqual(
      { provider: 'acp', acpAgentId: 'grok-build' },
      { provider: 'acp', acpAgentId: 'other' },
    )).toBe(false)
    expect(harnessPreferencesEqual(null, null)).toBe(true)
  })

  it('formats labels for display', () => {
    const labels = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }
    expect(formatHarnessPreferenceLabel(null, 'Auto', labels)).toBe('Auto')
    expect(formatHarnessPreferenceLabel('claude', 'Auto', labels)).toBe('Claude Code')
    expect(formatHarnessPreferenceLabel('acp:grok-build', 'Auto', labels)).toMatch(/Grok/i)
  })

  it('recognizes harness field keys', () => {
    expect(isHarnessPreferenceFieldKey('defaultHarness')).toBe(true)
    expect(isHarnessPreferenceFieldKey('secondaryHarness')).toBe(true)
    expect(isHarnessPreferenceFieldKey('locale')).toBe(false)
  })
})
