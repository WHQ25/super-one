import { describe, expect, it } from 'vitest'
import { diffConfigFieldValue, formatConfigFieldValue, formatSettingsFieldDisplay } from './config-field-summary'

const EMPTY = 'Not set'

describe('config field summaries', () => {
  it('names only the env vars that moved instead of printing both maps', () => {
    const diff = diffConfigFieldValue(
      'env',
      { KEEP_ME: '1', API_TIMEOUT_MS: '60000', GONE: 'x' },
      { KEEP_ME: '1', API_TIMEOUT_MS: '120000', ADDED: 'y' },
    )
    expect(diff).toBe('API_TIMEOUT_MS 60000 → 120000, +ADDED y, −GONE')
  })

  it('summarizes a model-mapping change by slot', () => {
    const diff = diffConfigFieldValue('model-mapping', { opus: { id: 'glm-4.5' } }, { opus: { id: 'glm-4.5' }, sonnet: { id: 'glm-4.6' } })
    expect(diff).toBe('+sonnet glm-4.6')
  })

  it('summarizes an enabled-model list as additions and removals', () => {
    const diff = diffConfigFieldValue('models', [{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])
    expect(diff).toBe('+c, −a')
  })

  it('summarizes a capability change per format', () => {
    const diff = diffConfigFieldValue(
      'capabilities',
      { families: ['openai'], tasks: { openai: ['chat'] }, extras: {} },
      { families: ['openai'], tasks: { openai: ['chat', 'image'] }, extras: {} },
    )
    expect(diff).toBe('+OpenAI·image')
  })

  it('has no diff for scalars, leaving the caller to show old → new', () => {
    expect(diffConfigFieldValue('string', 'a', 'b')).toBeNull()
    expect(diffConfigFieldValue('boolean', true, false)).toBeNull()
  })

  it('renders structured values as one readable line rather than JSON', () => {
    expect(formatConfigFieldValue('env', { A: '1', B: '2' }, EMPTY)).toBe('A=1, B=2')
    expect(formatConfigFieldValue('models', [{ id: 'glm-4.6', name: 'GLM 4.6' }], EMPTY)).toBe('GLM 4.6')
    expect(
      formatConfigFieldValue('capabilities', { families: ['openai'], tasks: { openai: ['chat', 'image'] }, extras: {} }, EMPTY),
    ).toBe('OpenAI · chat, image')
    expect(formatConfigFieldValue('env', {}, EMPTY)).toBe(EMPTY)
  })

  it('maps mermaid / terminal palette ids to the same labels the pickers show', () => {
    expect(formatSettingsFieldDisplay('mermaidDarkTheme', 'enum', 'dark', EMPTY)).toBe('Default Dark')
    expect(formatSettingsFieldDisplay('mermaidLightTheme', 'enum', 'forest', EMPTY)).toBe('Forest')
    expect(formatSettingsFieldDisplay('mermaidLightTheme', 'enum', null, EMPTY)).toBe(EMPTY)
    expect(formatSettingsFieldDisplay('terminalDarkPalette', 'enum', 'dracula', EMPTY)).toBe('Dracula+')
    expect(formatSettingsFieldDisplay('updateChannel', 'enum', 'beta', EMPTY)).toBe('beta')
  })

  it('maps default/secondary harness keys to readable labels', () => {
    expect(formatSettingsFieldDisplay('defaultHarness', 'string', null, EMPTY)).toBe('Auto')
    expect(formatSettingsFieldDisplay('defaultHarness', 'string', 'claude', EMPTY)).toBe('Claude Code')
    expect(formatSettingsFieldDisplay('secondaryHarness', 'string', 'acp:grok-build', EMPTY)).toMatch(/Grok/i)
  })
})
