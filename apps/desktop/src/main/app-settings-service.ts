import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AppSettings, AppSettingsPatch, EffortLevel, Locale, PermissionMode, SandboxMode, UpdateChannel } from '@superone/shared/agent-types'
import { sanitizeOverrides } from '@superone/shared/harness-brand'

export type { AppSettings, AppSettingsPatch }

type ClaudePref = AppSettings['agentPreference']['claude']
type CodexPref = AppSettings['agentPreference']['codex']

const defaults: AppSettings = {
  analyticsEnabled: true,
  crispText: true,
  locale: '',
  updateChannel: null,
  miniAppOrder: {},
  agentPreference: {
    claude: {
      defaultModel: '',
      defaultEffort: '',
      defaultPermissionMode: '',
      defaultSandboxMode: '',
      brandHue: null,
      tokenOverrides: {},
      disabledSkills: [],
    },
    codex: {
      defaultModel: '',
      defaultReasoningEffort: '',
      brandHue: null,
      tokenOverrides: {},
    },
  },
}

function readBrandHue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const wrapped = ((value % 360) + 360) % 360
  return Math.round(wrapped)
}

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh'
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'default' || value === 'acceptEdits' || value === 'bypassPermissions' || value === 'plan' || value === 'dontAsk' || value === 'auto'
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return value === 'off' || value === 'on' || value === 'auto'
}

function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === 'alpha' || value === 'beta' || value === 'stable'
}

function readMiniAppOrder(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(list)) out[key] = list.filter((x): x is string => typeof x === 'string')
  }
  return out
}

function isCodexReasoningEffort(value: unknown): value is CodexPref['defaultReasoningEffort'] {
  return value === '' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

function readClaudePreference(data: Record<string, unknown>): ClaudePref {
  const agentPreference = data.agentPreference && typeof data.agentPreference === 'object'
    ? data.agentPreference as Record<string, unknown>
    : undefined
  const claudePreference = agentPreference?.claude && typeof agentPreference.claude === 'object'
    ? agentPreference.claude as Record<string, unknown>
    : undefined

  return {
    defaultModel: typeof claudePreference?.defaultModel === 'string'
      ? claudePreference.defaultModel
      : defaults.agentPreference.claude.defaultModel,
    defaultEffort: claudePreference?.defaultEffort === '' || isEffortLevel(claudePreference?.defaultEffort)
      ? (claudePreference.defaultEffort as EffortLevel | '')
      : defaults.agentPreference.claude.defaultEffort,
    defaultPermissionMode: claudePreference?.defaultPermissionMode === '' || isPermissionMode(claudePreference?.defaultPermissionMode)
      ? (claudePreference.defaultPermissionMode as PermissionMode | '')
      : defaults.agentPreference.claude.defaultPermissionMode,
    defaultSandboxMode: claudePreference?.defaultSandboxMode === '' || isSandboxMode(claudePreference?.defaultSandboxMode)
      ? (claudePreference.defaultSandboxMode as SandboxMode | '')
      : defaults.agentPreference.claude.defaultSandboxMode,
    brandHue: readBrandHue(claudePreference?.brandHue),
    tokenOverrides: sanitizeOverrides(claudePreference?.tokenOverrides),
    disabledSkills: Array.isArray(claudePreference?.disabledSkills)
      ? claudePreference.disabledSkills.filter((x): x is string => typeof x === 'string')
      : defaults.agentPreference.claude.disabledSkills,
  }
}

function readCodexPreference(data: Record<string, unknown>): CodexPref {
  const agentPreference = data.agentPreference && typeof data.agentPreference === 'object'
    ? data.agentPreference as Record<string, unknown>
    : undefined
  const codexPreference = agentPreference?.codex && typeof agentPreference.codex === 'object'
    ? agentPreference.codex as Record<string, unknown>
    : undefined

  const legacyDefaultModel = typeof data.codexDefaultModel === 'string' ? data.codexDefaultModel : undefined
  const legacyDefaultReasoningEffort = isCodexReasoningEffort(data.codexDefaultReasoningEffort)
    ? data.codexDefaultReasoningEffort
    : undefined

  return {
    defaultModel: typeof codexPreference?.defaultModel === 'string'
      ? codexPreference.defaultModel
      : (legacyDefaultModel ?? defaults.agentPreference.codex.defaultModel),
    defaultReasoningEffort: isCodexReasoningEffort(codexPreference?.defaultReasoningEffort)
      ? codexPreference.defaultReasoningEffort
      : (legacyDefaultReasoningEffort ?? defaults.agentPreference.codex.defaultReasoningEffort),
    brandHue: readBrandHue(codexPreference?.brandHue),
    tokenOverrides: sanitizeOverrides(codexPreference?.tokenOverrides),
  }
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

export function readAppSettings(): AppSettings {
  try {
    const data = JSON.parse(readFileSync(getSettingsPath(), 'utf-8'))
    return {
      analyticsEnabled: typeof data.analyticsEnabled === 'boolean' ? data.analyticsEnabled : defaults.analyticsEnabled,
      crispText: typeof data.crispText === 'boolean' ? data.crispText : defaults.crispText,
      locale: data.locale === '' || isLocale(data.locale) ? data.locale : defaults.locale,
      updateChannel: data.updateChannel === null || isUpdateChannel(data.updateChannel) ? data.updateChannel : defaults.updateChannel,
      miniAppOrder: readMiniAppOrder(data.miniAppOrder),
      agentPreference: {
        claude: readClaudePreference(data),
        codex: readCodexPreference(data),
      },
    }
  } catch {
    return {
      analyticsEnabled: defaults.analyticsEnabled,
      crispText: defaults.crispText,
      locale: defaults.locale,
      updateChannel: defaults.updateChannel,
      miniAppOrder: {},
      agentPreference: {
        claude: { ...defaults.agentPreference.claude },
        codex: { ...defaults.agentPreference.codex },
      },
    }
  }
}

export function saveAppSettings(patch: AppSettingsPatch): AppSettings {
  const current = readAppSettings()
  const merged: AppSettings = {
    analyticsEnabled: patch.analyticsEnabled ?? current.analyticsEnabled,
    crispText: patch.crispText ?? current.crispText,
    locale: patch.locale ?? current.locale,
    updateChannel: patch.updateChannel === undefined ? current.updateChannel : patch.updateChannel,
    miniAppOrder: patch.miniAppOrder
      ? { ...current.miniAppOrder, ...patch.miniAppOrder }
      : current.miniAppOrder,
    agentPreference: {
      claude: {
        ...current.agentPreference.claude,
        ...patch.agentPreference?.claude,
      },
      codex: {
        ...current.agentPreference.codex,
        ...patch.agentPreference?.codex,
      },
    },
  }
  writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2))
  return merged
}

export function dropMiniAppOrderBucket(projectId: string): void {
  const current = readAppSettings()
  if (!(projectId in current.miniAppOrder)) return
  const next = { ...current.miniAppOrder }
  delete next[projectId]
  writeFileSync(getSettingsPath(), JSON.stringify({ ...current, miniAppOrder: next }, null, 2))
}
