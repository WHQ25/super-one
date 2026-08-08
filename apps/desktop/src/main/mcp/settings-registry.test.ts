import { describe, it, expect } from 'vitest'
import type { AppSettings } from '@superone/shared/agent-types'
import {
  buildDomainGuide,
  buildPatchFromValues,
  listDomainSummaries,
  settingsDomainsForPlatform,
  toConfirmFields,
  validateChanges,
} from './settings-registry'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    analyticsEnabled: true,
    experimentalAgentsEnabled: false,
    experimentalClaudeOpenAiChatEnabled: false,
    experimentalRemoteNodesEnabled: false,
    crispText: true,
    autoExpandFileDiffs: false,
    detailChatMode: false,
    locale: '',
    updateChannel: null,
    themeMode: 'system',
    terminalLightPalette: null,
    terminalDarkPalette: null,
    terminalFontSize: 14,
    terminalFontFamily: null,
    mermaidLightTheme: null,
    mermaidDarkTheme: null,
    uiFontFamily: null,
    liquidGlass: false,
    cdpEnabled: false,
    computerUseEnabled: false,
    computerUseAllowAllApps: false,
    computerUseAlwaysAllowApps: [],
    cdpCookiesEnabled: false,
    cdpMockEnabled: false,
    cdpEmulateEnabled: false,
    miniAppOrder: {},
    customAppIconPath: null,
    browserBookmarks: [],
    browserBookmarkGroups: [],
    defaultClonePaths: {},
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '', brandHue: null, tokenOverrides: {}, disabledSkills: [], askUserQuestionPreviewFormat: 'markdown' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '', brandHue: null, tokenOverrides: {} },
      acp: { enabled: false, brandHue: null, tokenOverrides: {}, selectedAgentId: null },
    },
    ...overrides,
  }
}

describe('settings registry validation', () => {
  it('hides Computer Use configuration outside macOS', () => {
    expect(settingsDomainsForPlatform('darwin').some((domain) => domain.domain === 'computer-use')).toBe(true)
    expect(settingsDomainsForPlatform('win32').some((domain) => domain.domain === 'computer-use')).toBe(false)
    expect(settingsDomainsForPlatform('linux').some((domain) => domain.domain === 'computer-use')).toBe(false)
  })

  it('rejects an unknown key while keeping valid ones', () => {
    const { valid, rejected } = validateChanges(
      [{ key: 'liquidGlass', value: true }, { key: 'nonexistent', value: 1 }],
      makeSettings(),
    )
    expect(valid.map((v) => v.field.key)).toEqual(['liquidGlass'])
    expect(rejected).toEqual([{ key: 'nonexistent', reason: 'unknown settings key' }])
  })

  it('rejects a non-boolean for a boolean field', () => {
    const { valid, rejected } = validateChanges([{ key: 'liquidGlass', value: 'yes' }], makeSettings())
    expect(valid).toHaveLength(0)
    expect(rejected[0].key).toBe('liquidGlass')
  })

  it('clamps-checks a number field against its range', () => {
    expect(validateChanges([{ key: 'terminalFontSize', value: 40 }], makeSettings()).rejected).toHaveLength(1)
    expect(validateChanges([{ key: 'terminalFontSize', value: 10 }], makeSettings()).rejected).toHaveLength(1)
    expect(validateChanges([{ key: 'terminalFontSize', value: 16 }], makeSettings()).valid[0].proposedValue).toBe(16)
  })

  it('rejects an enum value outside the allowed set', () => {
    expect(validateChanges([{ key: 'updateChannel', value: 'nightly' }], makeSettings()).rejected).toHaveLength(1)
    expect(validateChanges([{ key: 'updateChannel', value: 'beta' }], makeSettings()).valid[0].proposedValue).toBe('beta')
  })

  it('treats empty as clear-to-default for clearable fields', () => {
    expect(validateChanges([{ key: 'updateChannel', value: null }], makeSettings()).valid[0].proposedValue).toBe(null)
    expect(validateChanges([{ key: 'locale', value: '' }], makeSettings()).valid[0].proposedValue).toBe('')
    expect(validateChanges([{ key: 'claudeBrandHue', value: null }], makeSettings()).valid[0].proposedValue).toBe(null)
  })

  it('reads the current value from settings for confirm fields', () => {
    const fields = toConfirmFields(validateChanges([{ key: 'terminalFontSize', value: 18 }], makeSettings({ terminalFontSize: 15 })).valid)
    expect(fields[0]).toMatchObject({ key: 'terminalFontSize', currentValue: 15, proposedValue: 18, min: 12, max: 22 })
  })
})

describe('settings registry patch building', () => {
  it('builds a top-level patch and applied list', () => {
    const { patch, applied } = buildPatchFromValues({ liquidGlass: true, terminalFontSize: 20 }, makeSettings())
    expect(patch).toMatchObject({ liquidGlass: true, terminalFontSize: 20 })
    expect(applied).toEqual([
      { key: 'liquidGlass', label: 'Liquid Glass', oldValue: false, newValue: true },
      { key: 'terminalFontSize', label: 'Terminal Font Size', oldValue: 14, newValue: 20 },
    ])
  })

  it('deep-merges multiple agentPreference fields into one nested patch', () => {
    const { patch } = buildPatchFromValues(
      { claudeDefaultModel: 'claude-opus-4-8', claudeDefaultEffort: 'high', codexDefaultModel: 'gpt-5', codexDefaultPermissionPreset: 'full-access' },
      makeSettings(),
    )
    expect(patch.agentPreference?.claude).toMatchObject({ defaultModel: 'claude-opus-4-8', defaultEffort: 'high' })
    expect(patch.agentPreference?.codex).toMatchObject({ defaultModel: 'gpt-5', defaultPermissionPreset: 'full-access' })
  })

  it('maps a cleared nullable field to its empty representation in the patch', () => {
    const { patch } = buildPatchFromValues({ updateChannel: null, locale: '', claudeBrandHue: null }, makeSettings())
    expect(patch.updateChannel).toBe(null)
    expect(patch.locale).toBe('')
    expect(patch.agentPreference?.claude?.brandHue).toBe(null)
  })

  it('drops invalid edited values instead of writing them', () => {
    const { patch, applied, rejected } = buildPatchFromValues({ terminalFontSize: 999, liquidGlass: true }, makeSettings())
    expect(patch).toEqual({ liquidGlass: true })
    expect(applied).toEqual([{ key: 'liquidGlass', label: 'Liquid Glass', oldValue: false, newValue: true }])
    expect(rejected[0].key).toBe('terminalFontSize')
  })
})

describe('settings registry — new field groups', () => {
  it('round-trips terminal palette enum fields, clearable to null', () => {
    const { patch, applied } = buildPatchFromValues({ terminalLightPalette: 'dayfox', terminalDarkPalette: null }, makeSettings())
    expect(applied).toEqual([
      { key: 'terminalLightPalette', label: 'Terminal Light Palette', oldValue: null, newValue: 'dayfox' },
      { key: 'terminalDarkPalette', label: 'Terminal Dark Palette', oldValue: null, newValue: null },
    ])
    expect(patch.terminalLightPalette).toBe('dayfox')
    expect(patch.terminalDarkPalette).toBe(null)
  })

  it('rejects a terminal palette value outside its scheme’s allowed set', () => {
    expect(validateChanges([{ key: 'terminalLightPalette', value: 'monokai-remastered' }], makeSettings()).rejected).toHaveLength(1)
    expect(validateChanges([{ key: 'terminalDarkPalette', value: 'dayfox' }], makeSettings()).rejected).toHaveLength(1)
    expect(validateChanges([{ key: 'terminalLightPalette', value: 'github-light' }], makeSettings()).valid[0].proposedValue).toBe('github-light')
  })

  it('rejects an unknown ask-user-question preview format and cannot be cleared', () => {
    const rejectedFormat = validateChanges([{ key: 'claudeAskUserQuestionPreviewFormat', value: 'pdf' }], makeSettings())
    expect(rejectedFormat.rejected).toHaveLength(1)
    const rejectedEmpty = validateChanges([{ key: 'claudeAskUserQuestionPreviewFormat', value: null }], makeSettings())
    expect(rejectedEmpty.rejected).toEqual([{ key: 'claudeAskUserQuestionPreviewFormat', reason: 'claudeAskUserQuestionPreviewFormat cannot be empty' }])
    const { patch } = buildPatchFromValues({ claudeAskUserQuestionPreviewFormat: 'html' }, makeSettings())
    expect(patch.agentPreference?.claude?.askUserQuestionPreviewFormat).toBe('html')
  })

  it('applies experimental agent and ACP selection fields under general settings', () => {
    const { patch, applied } = buildPatchFromValues({
      experimentalAgentsEnabled: true,
      acpSelectedAgentId: 'gemini-cli',
    }, makeSettings())
    expect(applied).toEqual([
      { key: 'experimentalAgentsEnabled', label: 'Enable Experimental Agents', oldValue: false, newValue: true },
      { key: 'acpSelectedAgentId', label: 'Selected ACP Agent', oldValue: null, newValue: 'gemini-cli' },
    ])
    expect(patch.experimentalAgentsEnabled).toBe(true)
    expect(patch.agentPreference?.acp).toMatchObject({ selectedAgentId: 'gemini-cli' })
  })

  it('lists experimental and ACP fields under the general domain', () => {
    const domains = listDomainSummaries()
    expect(domains.find((d) => d.domain === 'general')).toBeTruthy()
    expect(domains.find((d) => d.domain === 'agent-acp')).toBeFalsy()
    const guide = buildDomainGuide('general', makeSettings({
      experimentalAgentsEnabled: true,
      agentPreference: { ...makeSettings().agentPreference, acp: { enabled: true, brandHue: null, tokenOverrides: {}, selectedAgentId: 'gemini-cli' } },
    }))
    expect(guide?.fields).toMatchObject([
      { key: 'locale' },
      { key: 'updateChannel' },
      { key: 'analyticsEnabled' },
      { key: 'experimentalAgentsEnabled', currentValue: true },
      { key: 'experimentalRemoteNodesEnabled', currentValue: false },
      { key: 'acpSelectedAgentId', currentValue: 'gemini-cli' },
    ])
  })
})

describe('settings registry guide', () => {
  it('lists every domain with a field count', () => {
    const domains = listDomainSummaries()
    expect(domains.find((d) => d.domain === 'appearance')).toBeTruthy()
    expect(domains.every((d) => d.fieldCount > 0)).toBe(true)
  })

  it('groups appearance + terminal fields under one appearance domain (matches the Appearance settings page)', () => {
    expect(listDomainSummaries().find((d) => d.domain === 'terminal')).toBeFalsy()
    const guide = buildDomainGuide('appearance', makeSettings({ terminalFontSize: 15 }))
    expect(guide?.fields.map((f) => f.key)).toEqual([
      'liquidGlass',
      'uiFontFamily',
      'crispText',
      'autoExpandFileDiffs',
      'detailChatMode',
      'terminalFontSize',
      'terminalFontFamily',
      'terminalLightPalette',
      'terminalDarkPalette',
      'mermaidLightTheme',
      'mermaidDarkTheme',
    ])
  })

  it('returns null for an unknown domain and a guide for a known one', () => {
    expect(buildDomainGuide('bogus', makeSettings())).toBeNull()
    expect(buildDomainGuide('updater', makeSettings())).toBeNull()
    const guide = buildDomainGuide('general', makeSettings({ updateChannel: 'alpha' }))
    expect(guide?.fields.find((f) => f.key === 'updateChannel')).toMatchObject({ currentValue: 'alpha', allowedValues: ['alpha', 'beta', 'stable'], clearable: true })
  })
})
