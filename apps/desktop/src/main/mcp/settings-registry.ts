import type { AppSettings, AppSettingsPatch, ConfigConfirmField } from '@superone/shared/agent-types'

export type ConfigValue = string | number | boolean | null

export interface SettingsFieldDef {
  key: string
  label: string
  type: 'boolean' | 'enum' | 'number' | 'string'
  enumValues?: readonly string[]
  min?: number
  max?: number
  /** Empty representation when the field is reset to default. undefined = not clearable. */
  clearTo?: '' | null
  note?: string
  read: (s: AppSettings) => ConfigValue
  toPatch: (value: ConfigValue) => AppSettingsPatch
}

export interface SettingsDomainDef {
  domain: string
  label: string
  description: string
  fields: SettingsFieldDef[]
}

const EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const PERMISSION_VALUES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'] as const
const SANDBOX_VALUES = ['off', 'on', 'auto'] as const
const CODEX_EFFORT_VALUES = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
const CODEX_PERMISSION_VALUES = ['read-only', 'default', 'full-access'] as const
const QUESTION_PREVIEW_FORMAT_VALUES = ['markdown', 'html'] as const
const TERMINAL_LIGHT_PALETTE_VALUES = ['catppuccin-latte', 'github-light', 'atom-one-light', 'ayu-light', 'dayfox', 'bluloco-light'] as const
const TERMINAL_DARK_PALETTE_VALUES = ['monokai-remastered', 'catppuccin-mocha', 'tokyo-night', 'dracula', 'gruvbox-dark', 'nord', 'rose-pine'] as const

export const SETTINGS_DOMAINS: SettingsDomainDef[] = [
  {
    domain: 'general',
    label: 'General',
    description: 'Language, updates, privacy, and experimental features — matches the General settings page.',
    fields: [
      {
        key: 'locale',
        label: 'Language',
        type: 'enum',
        enumValues: ['en', 'zh'],
        clearTo: '',
        note: 'Clear to follow the system language.',
        read: (s) => s.locale,
        toPatch: (v) => ({ locale: (v ?? '') as AppSettings['locale'] }),
      },
      {
        key: 'updateChannel',
        label: 'Update Channel',
        type: 'enum',
        enumValues: ['alpha', 'beta', 'stable'],
        clearTo: null,
        note: 'Clear to follow the channel this build shipped on.',
        read: (s) => s.updateChannel,
        toPatch: (v) => ({ updateChannel: (v ?? null) as AppSettings['updateChannel'] }),
      },
      {
        key: 'analyticsEnabled',
        label: 'Analytics',
        type: 'boolean',
        note: 'Anonymous usage analytics.',
        read: (s) => s.analyticsEnabled,
        toPatch: (v) => ({ analyticsEnabled: v as boolean }),
      },
      {
        key: 'experimentalAgentsEnabled',
        label: 'Enable Experimental Agents',
        type: 'boolean',
        read: (s) => s.experimentalAgentsEnabled,
        toPatch: (v) => ({ experimentalAgentsEnabled: v as boolean }),
      },
      {
        key: 'experimentalAgentCollaborationEnabled',
        label: 'Enable Agent Session Collaboration',
        type: 'boolean',
        note: 'Allow agents to request user-approved child sessions and communicate through a persistent mailbox.',
        read: (s) => s.experimentalAgentCollaborationEnabled,
        toPatch: (v) => ({ experimentalAgentCollaborationEnabled: v as boolean }),
      },
      {
        key: 'acpSelectedAgentId',
        label: 'Selected ACP Agent',
        type: 'string',
        clearTo: null,
        note: 'Id of the ACP agent to use. Clear to unset.',
        read: (s) => s.agentPreference.acp.selectedAgentId,
        toPatch: (v) => ({ agentPreference: { acp: { selectedAgentId: v as string | null } } }),
      },
    ],
  },
  {
    domain: 'appearance',
    label: 'Appearance',
    description: 'Visual look of the app window and built-in terminal — matches the Appearance settings page.',
    fields: [
      {
        key: 'liquidGlass',
        label: 'Liquid Glass',
        type: 'boolean',
        note: 'Translucent glass window material (opt-in).',
        read: (s) => s.liquidGlass,
        toPatch: (v) => ({ liquidGlass: v as boolean }),
      },
      {
        key: 'uiFontFamily',
        label: 'UI Font',
        type: 'string',
        clearTo: null,
        note: 'Font family for the app UI. Clear to use the default.',
        read: (s) => s.uiFontFamily,
        toPatch: (v) => ({ uiFontFamily: v as string | null }),
      },
      {
        key: 'crispText',
        label: 'Crisp Text',
        type: 'boolean',
        read: (s) => s.crispText,
        toPatch: (v) => ({ crispText: v as boolean }),
      },
      {
        key: 'autoExpandFileDiffs',
        label: 'Auto-expand File Diffs',
        type: 'boolean',
        note: 'When true, Edit/Write/FileChange tools expand to show the live diff while streaming. Default off: header with line counts only until expanded.',
        read: (s) => s.autoExpandFileDiffs,
        toPatch: (v) => ({ autoExpandFileDiffs: v as boolean }),
      },
      {
        key: 'detailChatMode',
        label: 'Detail Mode',
        type: 'boolean',
        note: 'When true, completed turns show the full process (tools, reasoning, intermediate narration). When false (default), process is collapsed under a disclosure. Streaming turns always render fully.',
        read: (s) => s.detailChatMode,
        toPatch: (v) => ({ detailChatMode: v as boolean }),
      },
      {
        key: 'terminalFontSize',
        label: 'Terminal Font Size',
        type: 'number',
        min: 12,
        max: 22,
        read: (s) => s.terminalFontSize,
        toPatch: (v) => ({ terminalFontSize: v as number }),
      },
      {
        key: 'terminalFontFamily',
        label: 'Terminal Font',
        type: 'string',
        clearTo: null,
        note: 'Monospace font family. Clear to use the default.',
        read: (s) => s.terminalFontFamily,
        toPatch: (v) => ({ terminalFontFamily: v as string | null }),
      },
      {
        key: 'terminalLightPalette',
        label: 'Terminal Light Palette',
        type: 'enum',
        enumValues: TERMINAL_LIGHT_PALETTE_VALUES,
        clearTo: null,
        note: 'Clear to use the default.',
        read: (s) => s.terminalLightPalette,
        toPatch: (v) => ({ terminalLightPalette: v as string | null }),
      },
      {
        key: 'terminalDarkPalette',
        label: 'Terminal Dark Palette',
        type: 'enum',
        enumValues: TERMINAL_DARK_PALETTE_VALUES,
        clearTo: null,
        note: 'Clear to use the default.',
        read: (s) => s.terminalDarkPalette,
        toPatch: (v) => ({ terminalDarkPalette: v as string | null }),
      },
    ],
  },
  {
    domain: 'computer-use',
    label: 'Computer Use',
    description: 'Desktop GUI automation (fallback tier). Opt-in; requires a signed helper and per-session app grants.',
    fields: [
      {
        key: 'computerUseEnabled',
        label: 'Enable Computer Use',
        type: 'boolean',
        read: (s) => s.computerUseEnabled,
        toPatch: (v) => ({ computerUseEnabled: v as boolean }),
      },
      {
        key: 'computerUseAllowAllApps',
        label: 'Allow all apps',
        type: 'boolean',
        read: (s) => s.computerUseAllowAllApps,
        toPatch: (v) => ({ computerUseAllowAllApps: v as boolean }),
      },
    ],
  },
  {
    domain: 'browser',
    label: 'Browser',
    description: 'Built-in browser Chrome DevTools Protocol (CDP) automation toggles.',
    fields: [
      {
        key: 'cdpEnabled',
        label: 'Enable CDP',
        type: 'boolean',
        read: (s) => s.cdpEnabled,
        toPatch: (v) => ({ cdpEnabled: v as boolean }),
      },
      {
        key: 'cdpCookiesEnabled',
        label: 'CDP Cookies Access',
        type: 'boolean',
        read: (s) => s.cdpCookiesEnabled,
        toPatch: (v) => ({ cdpCookiesEnabled: v as boolean }),
      },
      {
        key: 'cdpMockEnabled',
        label: 'CDP Network Mocking',
        type: 'boolean',
        read: (s) => s.cdpMockEnabled,
        toPatch: (v) => ({ cdpMockEnabled: v as boolean }),
      },
      {
        key: 'cdpEmulateEnabled',
        label: 'CDP Device Emulation',
        type: 'boolean',
        read: (s) => s.cdpEmulateEnabled,
        toPatch: (v) => ({ cdpEmulateEnabled: v as boolean }),
      },
    ],
  },
  {
    domain: 'agent-claude',
    label: 'Claude Defaults',
    description: 'Default settings for new Claude chat sessions.',
    fields: [
      {
        key: 'claudeDefaultModel',
        label: 'Default Model',
        type: 'string',
        clearTo: '',
        note: 'Model id, e.g. "claude-opus-4-8". Clear to use the app default.',
        read: (s) => s.agentPreference.claude.defaultModel,
        toPatch: (v) => ({ agentPreference: { claude: { defaultModel: (v ?? '') as string } } }),
      },
      {
        key: 'claudeDefaultEffort',
        label: 'Default Effort',
        type: 'enum',
        enumValues: EFFORT_VALUES,
        clearTo: '',
        read: (s) => s.agentPreference.claude.defaultEffort,
        toPatch: (v) => ({ agentPreference: { claude: { defaultEffort: (v ?? '') as AppSettings['agentPreference']['claude']['defaultEffort'] } } }),
      },
      {
        key: 'claudeDefaultPermissionMode',
        label: 'Default Permission Mode',
        type: 'enum',
        enumValues: PERMISSION_VALUES,
        clearTo: '',
        note: 'Controls how much the agent may execute without asking. "bypassPermissions" removes prompts.',
        read: (s) => s.agentPreference.claude.defaultPermissionMode,
        toPatch: (v) => ({ agentPreference: { claude: { defaultPermissionMode: (v ?? '') as AppSettings['agentPreference']['claude']['defaultPermissionMode'] } } }),
      },
      {
        key: 'claudeDefaultSandboxMode',
        label: 'Default Sandbox Mode',
        type: 'enum',
        enumValues: SANDBOX_VALUES,
        clearTo: '',
        read: (s) => s.agentPreference.claude.defaultSandboxMode,
        toPatch: (v) => ({ agentPreference: { claude: { defaultSandboxMode: (v ?? '') as AppSettings['agentPreference']['claude']['defaultSandboxMode'] } } }),
      },
      {
        key: 'claudeBrandHue',
        label: 'Brand Hue',
        type: 'number',
        min: 0,
        max: 360,
        clearTo: null,
        note: 'Light-mode accent hue (0-360). Clear to use the Claude default.',
        read: (s) => s.agentPreference.claude.brandHue,
        toPatch: (v) => ({ agentPreference: { claude: { brandHue: (v as number | null) } } }),
      },
      {
        key: 'claudeAskUserQuestionPreviewFormat',
        label: 'Ask-User-Question Preview Format',
        type: 'enum',
        enumValues: QUESTION_PREVIEW_FORMAT_VALUES,
        note: 'How AskUserQuestion option previews are rendered.',
        read: (s) => s.agentPreference.claude.askUserQuestionPreviewFormat,
        toPatch: (v) => ({ agentPreference: { claude: { askUserQuestionPreviewFormat: v as AppSettings['agentPreference']['claude']['askUserQuestionPreviewFormat'] } } }),
      },
    ],
  },
  {
    domain: 'agent-codex',
    label: 'Codex Defaults',
    description: 'Default settings for new Codex chat sessions.',
    fields: [
      {
        key: 'codexDefaultModel',
        label: 'Default Model',
        type: 'string',
        clearTo: '',
        read: (s) => s.agentPreference.codex.defaultModel,
        toPatch: (v) => ({ agentPreference: { codex: { defaultModel: (v ?? '') as string } } }),
      },
      {
        key: 'codexDefaultReasoningEffort',
        label: 'Default Reasoning Effort',
        type: 'enum',
        enumValues: CODEX_EFFORT_VALUES,
        clearTo: '',
        read: (s) => s.agentPreference.codex.defaultReasoningEffort,
        toPatch: (v) => ({ agentPreference: { codex: { defaultReasoningEffort: (v ?? '') as AppSettings['agentPreference']['codex']['defaultReasoningEffort'] } } }),
      },
      {
        key: 'codexDefaultPermissionPreset',
        label: 'Default Permission Mode',
        type: 'enum',
        enumValues: CODEX_PERMISSION_VALUES,
        clearTo: '',
        read: (s) => s.agentPreference.codex.defaultPermissionPreset,
        toPatch: (v) => ({ agentPreference: { codex: { defaultPermissionPreset: (v ?? '') as AppSettings['agentPreference']['codex']['defaultPermissionPreset'] } } }),
      },
      {
        key: 'codexBrandHue',
        label: 'Brand Hue',
        type: 'number',
        min: 0,
        max: 360,
        clearTo: null,
        note: 'Light-mode accent hue (0-360). Clear to use the Codex default.',
        read: (s) => s.agentPreference.codex.brandHue,
        toPatch: (v) => ({ agentPreference: { codex: { brandHue: (v as number | null) } } }),
      },
    ],
  },
]

export const SETTINGS_DOMAIN_IDS = SETTINGS_DOMAINS.map((d) => d.domain)

const FIELD_INDEX: Map<string, { field: SettingsFieldDef; domain: string }> = (() => {
  const index = new Map<string, { field: SettingsFieldDef; domain: string }>()
  for (const domain of SETTINGS_DOMAINS) {
    for (const field of domain.fields) index.set(field.key, { field, domain: domain.domain })
  }
  return index
})()

export function findField(key: string): { field: SettingsFieldDef; domain: string } | null {
  return FIELD_INDEX.get(key) ?? null
}

export type CoerceResult = { ok: true; value: ConfigValue } | { ok: false; reason: string }

export function coerceValue(field: SettingsFieldDef, raw: unknown): CoerceResult {
  const isEmpty = raw === null || raw === undefined || raw === ''
  if (isEmpty) {
    if (field.clearTo !== undefined) return { ok: true, value: field.clearTo }
    return { ok: false, reason: `${field.key} cannot be empty` }
  }
  switch (field.type) {
    case 'boolean':
      if (typeof raw !== 'boolean') return { ok: false, reason: `${field.key} must be a boolean` }
      return { ok: true, value: raw }
    case 'number': {
      const num = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(num)) return { ok: false, reason: `${field.key} must be a number` }
      const rounded = Math.round(num)
      if (field.min !== undefined && rounded < field.min) return { ok: false, reason: `${field.key} must be >= ${field.min}` }
      if (field.max !== undefined && rounded > field.max) return { ok: false, reason: `${field.key} must be <= ${field.max}` }
      return { ok: true, value: rounded }
    }
    case 'enum': {
      const str = String(raw)
      if (!field.enumValues?.includes(str)) return { ok: false, reason: `${field.key} must be one of: ${field.enumValues?.join(', ')}` }
      return { ok: true, value: str }
    }
    case 'string':
      if (typeof raw !== 'string') return { ok: false, reason: `${field.key} must be a string` }
      return { ok: true, value: raw }
  }
}

export interface DomainGuide {
  domain: string
  label: string
  description: string
  fields: Array<{
    key: string
    label: string
    type: SettingsFieldDef['type']
    currentValue: ConfigValue
    allowedValues?: readonly string[]
    min?: number
    max?: number
    clearable: boolean
    note?: string
  }>
}

export function buildDomainGuide(domainId: string, settings: AppSettings): DomainGuide | null {
  const domain = SETTINGS_DOMAINS.find((d) => d.domain === domainId)
  if (!domain) return null
  return {
    domain: domain.domain,
    label: domain.label,
    description: domain.description,
    fields: domain.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      currentValue: field.read(settings),
      ...(field.enumValues ? { allowedValues: field.enumValues } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
      clearable: field.clearTo !== undefined,
      ...(field.note ? { note: field.note } : {}),
    })),
  }
}

export function listDomainSummaries(): Array<{ domain: string; label: string; description: string; fieldCount: number }> {
  return SETTINGS_DOMAINS.map((d) => ({
    domain: d.domain,
    label: d.label,
    description: d.description,
    fieldCount: d.fields.length,
  }))
}

export interface ValidatedChange {
  field: SettingsFieldDef
  domain: string
  currentValue: ConfigValue
  proposedValue: ConfigValue
}

export interface ValidationResult {
  valid: ValidatedChange[]
  rejected: Array<{ key: string; reason: string }>
}

export function validateChanges(
  changes: Array<{ key: string; value: unknown }>,
  settings: AppSettings,
): ValidationResult {
  const valid: ValidatedChange[] = []
  const rejected: Array<{ key: string; reason: string }> = []
  for (const change of changes) {
    const entry = findField(change.key)
    if (!entry) {
      rejected.push({ key: change.key, reason: 'unknown settings key' })
      continue
    }
    const coerced = coerceValue(entry.field, change.value)
    if (!coerced.ok) {
      rejected.push({ key: change.key, reason: coerced.reason })
      continue
    }
    valid.push({
      field: entry.field,
      domain: entry.domain,
      currentValue: entry.field.read(settings),
      proposedValue: coerced.value,
    })
  }
  return { valid, rejected }
}

export function toConfirmFields(valid: ValidatedChange[]): ConfigConfirmField[] {
  return valid.map(({ field, domain, currentValue, proposedValue }) => ({
    key: field.key,
    domain,
    label: field.label,
    type: field.type,
    ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    clearable: field.clearTo !== undefined,
    ...(field.note ? { note: field.note } : {}),
    currentValue,
    proposedValue,
  }))
}

function mergePatches(patches: AppSettingsPatch[]): AppSettingsPatch {
  const merged: AppSettingsPatch = {}
  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'agentPreference' && value && typeof value === 'object') {
        const prev = merged.agentPreference ?? {}
        const next = value as NonNullable<AppSettingsPatch['agentPreference']>
        merged.agentPreference = {
          ...prev,
          claude: { ...prev.claude, ...next.claude },
          codex: { ...prev.codex, ...next.codex },
          acp: { ...prev.acp, ...next.acp },
        }
      } else {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

export interface BuildPatchResult {
  patch: AppSettingsPatch
  applied: Array<{ key: string; label: string; oldValue: ConfigValue; newValue: ConfigValue }>
  rejected: Array<{ key: string; reason: string }>
}

/**
 * Re-validate the user's final (possibly edited) values through the registry and
 * build a single merged patch. Re-validation is intentional: the confirm dialog
 * lets the user edit, so trusting the raw form values blindly would bypass range
 * and enum guards.
 */
export function buildPatchFromValues(values: Record<string, unknown>, settings: AppSettings): BuildPatchResult {
  const changes = Object.entries(values).map(([key, value]) => ({ key, value }))
  const { valid, rejected } = validateChanges(changes, settings)
  const patch = mergePatches(valid.map(({ field, proposedValue }) => field.toPatch(proposedValue)))
  const applied = valid.map(({ field, currentValue, proposedValue }) => ({ key: field.key, label: field.label, oldValue: currentValue, newValue: proposedValue }))
  return { patch, applied, rejected }
}
