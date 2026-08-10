import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type {
  AppSettings,
  AppSettingsPatch,
  BrowserBookmark,
  BrowserBookmarkGroup,
  CodexPermissionPreset,
  ComputerUseAlwaysAllowApp,
  EffortLevel,
  HarnessId,
  Locale,
  PermissionMode,
  QuestionPreviewFormat,
  SandboxMode,
  SuggestionHarnessPreference,
  ThemeMode,
  UpdateChannel,
} from '@superone/shared/agent-types'
import { sanitizeOverrides } from '@superone/shared/harness-brand'

export type { AppSettings, AppSettingsPatch }

type ClaudePref = AppSettings['agentPreference']['claude']
type CodexPref = AppSettings['agentPreference']['codex']
type AcpPref = AppSettings['agentPreference']['acp']

function readEnabledExperimentalAgents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

const defaults: AppSettings = {
  analyticsEnabled: true,
  experimentalAgentsEnabled: false,
  enabledExperimentalAgents: [],
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
  cdpCookiesEnabled: false,
  cdpMockEnabled: false,
  cdpEmulateEnabled: false,
  computerUseEnabled: false,
  computerUseAllowAllApps: false,
  computerUseAlwaysAllowApps: [],
  miniAppOrder: {},
  customAppIconPath: null,
  browserBookmarks: [],
  browserBookmarkGroups: [],
  defaultClonePaths: {},
  suggestionHarness: null,
  secondaryHarness: null,
  suggestionMenuHarness: null,
  agentPreference: {
    claude: {
      defaultModel: '',
      defaultEffort: '',
      defaultPermissionMode: '',
      defaultSandboxMode: '',
      brandHue: null,
      tokenOverrides: {},
      disabledSkills: [],
      askUserQuestionPreviewFormat: 'markdown',
    },
    codex: {
      defaultModel: '',
      defaultReasoningEffort: '',
      defaultPermissionPreset: '',
      brandHue: null,
      tokenOverrides: {},
    },
    acp: {
      enabled: false,
      brandHue: null,
      tokenOverrides: {},
      selectedAgentId: null,
    },
  },
}

const HARNESS_IDS = new Set<HarnessId>(['claude', 'codex', 'acp', 'opencode'])

function readSuggestionHarness(value: unknown): SuggestionHarnessPreference | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  if (!HARNESS_IDS.has(provider as HarnessId)) return null
  const acpAgentId = typeof raw.acpAgentId === 'string' && raw.acpAgentId.trim()
    ? raw.acpAgentId.trim()
    : null
  if (provider === 'acp' && !acpAgentId) return null
  return {
    provider: provider as HarnessId,
    acpAgentId: provider === 'acp' ? acpAgentId : null,
  }
}

/** Serialize a harness preference for config tools / UI keys (`claude`, `acp:grok-build`). */
export function serializeSuggestionHarness(pref: SuggestionHarnessPreference | null): string | null {
  if (!pref) return null
  if (pref.provider === 'acp') {
    const agent = pref.acpAgentId?.trim()
    return agent ? `acp:${agent}` : null
  }
  return pref.provider
}

/**
 * Parse a harness key from settings UI / config tools.
 * Accepts object form, `"auto"`/`null`/empty for Auto, or `claude`/`codex`/`opencode`/`acp:<id>`.
 */
export function parseSuggestionHarnessKey(value: unknown): SuggestionHarnessPreference | null {
  if (value == null || value === '' || value === 'auto') return null
  if (typeof value === 'object') return readSuggestionHarness(value)
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key || key === 'auto') return null
  if (key === 'claude' || key === 'codex' || key === 'opencode') {
    return { provider: key, acpAgentId: null }
  }
  if (key.startsWith('acp:')) {
    const agent = key.slice(4).trim()
    return agent ? { provider: 'acp', acpAgentId: agent } : null
  }
  return null
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

function isQuestionPreviewFormat(value: unknown): value is QuestionPreviewFormat {
  return value === 'markdown' || value === 'html'
}

function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === 'alpha' || value === 'beta' || value === 'stable'
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readTerminalFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaults.terminalFontSize
  return Math.min(22, Math.max(12, Math.round(value)))
}

function readMiniAppOrder(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(list)) out[key] = list.filter((x): x is string => typeof x === 'string')
  }
  return out
}

function readDefaultClonePaths(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, path] of Object.entries(value as Record<string, unknown>)) {
    if (!key || typeof path !== 'string') continue
    const trimmed = path.trim()
    if (trimmed) out[key] = trimmed
  }
  return out
}

/** Merge patch into current; empty-string values remove that connection's entry. */
function mergeDefaultClonePaths(
  current: Record<string, string>,
  patch: Record<string, string> | undefined,
): Record<string, string> {
  if (!patch) return current
  const next = { ...current }
  for (const [key, path] of Object.entries(patch)) {
    if (!key) continue
    const trimmed = typeof path === 'string' ? path.trim() : ''
    if (!trimmed) delete next[key]
    else next[key] = trimmed
  }
  return next
}

function readComputerUseAlwaysAllowApps(value: unknown): ComputerUseAlwaysAllowApp[] {
  if (!Array.isArray(value)) return []
  const out: ComputerUseAlwaysAllowApp[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    if (typeof a.bundleId !== 'string' || !a.bundleId.trim()) continue
    const bundleId = a.bundleId.trim()
    if (seen.has(bundleId)) continue
    seen.add(bundleId)
    out.push({
      app: typeof a.app === 'string' && a.app.trim() ? a.app.trim() : bundleId,
      bundleId,
    })
  }
  return out
}

function readBookmarks(value: unknown): BrowserBookmark[] {
  if (!Array.isArray(value)) return []
  const out: BrowserBookmark[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, unknown>
    if (typeof b.id !== 'string' || typeof b.url !== 'string') continue
    out.push({
      id: b.id,
      title: typeof b.title === 'string' ? b.title : '',
      url: b.url,
      favicon: typeof b.favicon === 'string' ? b.favicon : null,
      groupId: typeof b.groupId === 'string' ? b.groupId : null,
      createdAt: typeof b.createdAt === 'number' && Number.isFinite(b.createdAt) ? b.createdAt : 0,
    })
  }
  return out
}

function readBookmarkGroups(value: unknown): BrowserBookmarkGroup[] {
  if (!Array.isArray(value)) return []
  const out: BrowserBookmarkGroup[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const g = item as Record<string, unknown>
    if (typeof g.id !== 'string' || typeof g.name !== 'string') continue
    out.push({
      id: g.id,
      name: g.name,
      createdAt: typeof g.createdAt === 'number' && Number.isFinite(g.createdAt) ? g.createdAt : 0,
    })
  }
  return out
}

function isCodexReasoningEffort(value: unknown): value is CodexPref['defaultReasoningEffort'] {
  return value === '' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

function isCodexPermissionPreset(value: unknown): value is CodexPermissionPreset {
  return value === 'read-only' || value === 'default' || value === 'full-access'
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
    askUserQuestionPreviewFormat: isQuestionPreviewFormat(claudePreference?.askUserQuestionPreviewFormat)
      ? claudePreference.askUserQuestionPreviewFormat
      : defaults.agentPreference.claude.askUserQuestionPreviewFormat,
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
    defaultPermissionPreset: codexPreference?.defaultPermissionPreset === '' || isCodexPermissionPreset(codexPreference?.defaultPermissionPreset)
      ? (codexPreference.defaultPermissionPreset as CodexPermissionPreset | '')
      : defaults.agentPreference.codex.defaultPermissionPreset,
    brandHue: readBrandHue(codexPreference?.brandHue),
    tokenOverrides: sanitizeOverrides(codexPreference?.tokenOverrides),
  }
}

function readAcpPreference(data: Record<string, unknown>): AcpPref {
  const agentPreference = data.agentPreference && typeof data.agentPreference === 'object'
    ? data.agentPreference as Record<string, unknown>
    : undefined
  const acpPreference = agentPreference?.acp && typeof agentPreference.acp === 'object'
    ? agentPreference.acp as Record<string, unknown>
    : undefined

  return {
    enabled: typeof acpPreference?.enabled === 'boolean'
      ? acpPreference.enabled
      : defaults.agentPreference.acp.enabled,
    brandHue: readBrandHue(acpPreference?.brandHue),
    tokenOverrides: sanitizeOverrides(acpPreference?.tokenOverrides),
    selectedAgentId: typeof acpPreference?.selectedAgentId === 'string'
      ? acpPreference.selectedAgentId
      : defaults.agentPreference.acp.selectedAgentId,
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
      experimentalAgentsEnabled: typeof data.experimentalAgentsEnabled === 'boolean'
        ? data.experimentalAgentsEnabled
        : readAcpPreference(data).enabled,
      enabledExperimentalAgents: readEnabledExperimentalAgents(data.enabledExperimentalAgents),
      experimentalClaudeOpenAiChatEnabled: typeof data.experimentalClaudeOpenAiChatEnabled === 'boolean'
        ? data.experimentalClaudeOpenAiChatEnabled
        : defaults.experimentalClaudeOpenAiChatEnabled,
      experimentalRemoteNodesEnabled: typeof data.experimentalRemoteNodesEnabled === 'boolean'
        ? data.experimentalRemoteNodesEnabled
        : defaults.experimentalRemoteNodesEnabled,
      crispText: typeof data.crispText === 'boolean' ? data.crispText : defaults.crispText,
      autoExpandFileDiffs: typeof data.autoExpandFileDiffs === 'boolean' ? data.autoExpandFileDiffs : defaults.autoExpandFileDiffs,
      detailChatMode: typeof data.detailChatMode === 'boolean'
        ? data.detailChatMode
        // Migrate inverted legacy key (compactChatMode true meant collapsed process).
        : typeof data.compactChatMode === 'boolean'
          ? !data.compactChatMode
          : defaults.detailChatMode,
      locale: data.locale === '' || isLocale(data.locale) ? data.locale : defaults.locale,
      updateChannel: data.updateChannel === null || isUpdateChannel(data.updateChannel) ? data.updateChannel : defaults.updateChannel,
      themeMode: isThemeMode(data.themeMode) ? data.themeMode : defaults.themeMode,
      terminalLightPalette: typeof data.terminalLightPalette === 'string' ? data.terminalLightPalette : defaults.terminalLightPalette,
      terminalDarkPalette: typeof data.terminalDarkPalette === 'string' ? data.terminalDarkPalette : defaults.terminalDarkPalette,
      terminalFontSize: readTerminalFontSize(data.terminalFontSize),
      terminalFontFamily: typeof data.terminalFontFamily === 'string' ? data.terminalFontFamily : defaults.terminalFontFamily,
      mermaidLightTheme: typeof data.mermaidLightTheme === 'string' ? data.mermaidLightTheme : defaults.mermaidLightTheme,
      mermaidDarkTheme: typeof data.mermaidDarkTheme === 'string' ? data.mermaidDarkTheme : defaults.mermaidDarkTheme,
      uiFontFamily: typeof data.uiFontFamily === 'string' ? data.uiFontFamily : defaults.uiFontFamily,
      liquidGlass: typeof data.liquidGlass === 'boolean' ? data.liquidGlass : defaults.liquidGlass,
      cdpEnabled: typeof data.cdpEnabled === 'boolean' ? data.cdpEnabled : defaults.cdpEnabled,
      cdpCookiesEnabled: typeof data.cdpCookiesEnabled === 'boolean' ? data.cdpCookiesEnabled : defaults.cdpCookiesEnabled,
      cdpMockEnabled: typeof data.cdpMockEnabled === 'boolean' ? data.cdpMockEnabled : defaults.cdpMockEnabled,
      cdpEmulateEnabled: typeof data.cdpEmulateEnabled === 'boolean' ? data.cdpEmulateEnabled : defaults.cdpEmulateEnabled,
      computerUseEnabled: typeof data.computerUseEnabled === 'boolean' ? data.computerUseEnabled : defaults.computerUseEnabled,
      computerUseAllowAllApps: typeof data.computerUseAllowAllApps === 'boolean' ? data.computerUseAllowAllApps : defaults.computerUseAllowAllApps,
      computerUseAlwaysAllowApps: readComputerUseAlwaysAllowApps(data.computerUseAlwaysAllowApps),
      miniAppOrder: readMiniAppOrder(data.miniAppOrder),
      customAppIconPath: typeof data.customAppIconPath === 'string' ? data.customAppIconPath : defaults.customAppIconPath,
      browserBookmarks: readBookmarks(data.browserBookmarks),
      browserBookmarkGroups: readBookmarkGroups(data.browserBookmarkGroups),
      defaultClonePaths: readDefaultClonePaths(data.defaultClonePaths),
      // `defaultHarness` is accepted as a legacy/alias key for config-tool clarity.
      suggestionHarness: readSuggestionHarness(data.suggestionHarness ?? data.defaultHarness)
        ?? parseSuggestionHarnessKey(data.suggestionHarness ?? data.defaultHarness),
      secondaryHarness: readSuggestionHarness(data.secondaryHarness)
        ?? parseSuggestionHarnessKey(data.secondaryHarness),
      suggestionMenuHarness: readSuggestionHarness(data.suggestionMenuHarness),
      agentPreference: {
        claude: readClaudePreference(data),
        codex: readCodexPreference(data),
        acp: readAcpPreference(data),
      },
    }
  } catch {
    return {
      analyticsEnabled: defaults.analyticsEnabled,
      experimentalAgentsEnabled: defaults.experimentalAgentsEnabled,
      enabledExperimentalAgents: [],
      experimentalClaudeOpenAiChatEnabled: defaults.experimentalClaudeOpenAiChatEnabled,
      experimentalRemoteNodesEnabled: defaults.experimentalRemoteNodesEnabled,
      crispText: defaults.crispText,
      autoExpandFileDiffs: defaults.autoExpandFileDiffs,
      detailChatMode: defaults.detailChatMode,
      locale: defaults.locale,
      updateChannel: defaults.updateChannel,
      themeMode: defaults.themeMode,
      terminalLightPalette: defaults.terminalLightPalette,
      terminalDarkPalette: defaults.terminalDarkPalette,
      terminalFontSize: defaults.terminalFontSize,
      terminalFontFamily: defaults.terminalFontFamily,
      mermaidLightTheme: defaults.mermaidLightTheme,
      mermaidDarkTheme: defaults.mermaidDarkTheme,
      uiFontFamily: defaults.uiFontFamily,
      liquidGlass: defaults.liquidGlass,
      cdpEnabled: defaults.cdpEnabled,
      cdpCookiesEnabled: defaults.cdpCookiesEnabled,
      cdpMockEnabled: defaults.cdpMockEnabled,
      cdpEmulateEnabled: defaults.cdpEmulateEnabled,
      computerUseEnabled: defaults.computerUseEnabled,
      computerUseAllowAllApps: defaults.computerUseAllowAllApps,
      computerUseAlwaysAllowApps: [],
      miniAppOrder: {},
      customAppIconPath: defaults.customAppIconPath,
      browserBookmarks: [],
      browserBookmarkGroups: [],
      defaultClonePaths: {},
      suggestionHarness: null,
      secondaryHarness: null,
      suggestionMenuHarness: null,
      agentPreference: {
        claude: { ...defaults.agentPreference.claude },
        codex: { ...defaults.agentPreference.codex },
        acp: { ...defaults.agentPreference.acp },
      },
    }
  }
}

export function saveAppSettings(patch: AppSettingsPatch): AppSettings {
  const current = readAppSettings()
  const merged: AppSettings = {
    analyticsEnabled: patch.analyticsEnabled ?? current.analyticsEnabled,
    experimentalAgentsEnabled: patch.experimentalAgentsEnabled
      ?? patch.agentPreference?.acp?.enabled
      ?? current.experimentalAgentsEnabled,
    enabledExperimentalAgents: patch.enabledExperimentalAgents !== undefined
      ? readEnabledExperimentalAgents(patch.enabledExperimentalAgents)
      : current.enabledExperimentalAgents,
    experimentalClaudeOpenAiChatEnabled: patch.experimentalClaudeOpenAiChatEnabled
      ?? current.experimentalClaudeOpenAiChatEnabled,
    experimentalRemoteNodesEnabled: patch.experimentalRemoteNodesEnabled
      ?? current.experimentalRemoteNodesEnabled,
    crispText: patch.crispText ?? current.crispText,
    autoExpandFileDiffs: patch.autoExpandFileDiffs ?? current.autoExpandFileDiffs,
    detailChatMode: patch.detailChatMode ?? current.detailChatMode,
    locale: patch.locale ?? current.locale,
    updateChannel: patch.updateChannel === undefined ? current.updateChannel : patch.updateChannel,
    themeMode: patch.themeMode === undefined ? current.themeMode : patch.themeMode,
    terminalLightPalette: patch.terminalLightPalette === undefined ? current.terminalLightPalette : patch.terminalLightPalette,
    terminalDarkPalette: patch.terminalDarkPalette === undefined ? current.terminalDarkPalette : patch.terminalDarkPalette,
    terminalFontSize: patch.terminalFontSize === undefined ? current.terminalFontSize : readTerminalFontSize(patch.terminalFontSize),
    terminalFontFamily: patch.terminalFontFamily === undefined ? current.terminalFontFamily : patch.terminalFontFamily,
    mermaidLightTheme: patch.mermaidLightTheme === undefined ? current.mermaidLightTheme : patch.mermaidLightTheme,
    mermaidDarkTheme: patch.mermaidDarkTheme === undefined ? current.mermaidDarkTheme : patch.mermaidDarkTheme,
    uiFontFamily: patch.uiFontFamily === undefined ? current.uiFontFamily : patch.uiFontFamily,
    liquidGlass: patch.liquidGlass === undefined ? current.liquidGlass : patch.liquidGlass,
    cdpEnabled: patch.cdpEnabled === undefined ? current.cdpEnabled : patch.cdpEnabled,
    cdpCookiesEnabled: patch.cdpCookiesEnabled === undefined ? current.cdpCookiesEnabled : patch.cdpCookiesEnabled,
    cdpMockEnabled: patch.cdpMockEnabled === undefined ? current.cdpMockEnabled : patch.cdpMockEnabled,
    cdpEmulateEnabled: patch.cdpEmulateEnabled === undefined ? current.cdpEmulateEnabled : patch.cdpEmulateEnabled,
    computerUseEnabled: patch.computerUseEnabled === undefined ? current.computerUseEnabled : patch.computerUseEnabled,
    computerUseAllowAllApps: patch.computerUseAllowAllApps === undefined ? current.computerUseAllowAllApps : patch.computerUseAllowAllApps,
    computerUseAlwaysAllowApps: patch.computerUseAlwaysAllowApps === undefined
      ? current.computerUseAlwaysAllowApps
      : readComputerUseAlwaysAllowApps(patch.computerUseAlwaysAllowApps),
    miniAppOrder: patch.miniAppOrder
      ? { ...current.miniAppOrder, ...patch.miniAppOrder }
      : current.miniAppOrder,
    customAppIconPath: patch.customAppIconPath === undefined ? current.customAppIconPath : patch.customAppIconPath,
    browserBookmarks: patch.browserBookmarks === undefined ? current.browserBookmarks : readBookmarks(patch.browserBookmarks),
    browserBookmarkGroups: patch.browserBookmarkGroups === undefined ? current.browserBookmarkGroups : readBookmarkGroups(patch.browserBookmarkGroups),
    defaultClonePaths: mergeDefaultClonePaths(current.defaultClonePaths, patch.defaultClonePaths),
    suggestionHarness: patch.suggestionHarness === undefined
      ? current.suggestionHarness
      : (readSuggestionHarness(patch.suggestionHarness) ?? parseSuggestionHarnessKey(patch.suggestionHarness)),
    secondaryHarness: patch.secondaryHarness === undefined
      ? current.secondaryHarness
      : (readSuggestionHarness(patch.secondaryHarness) ?? parseSuggestionHarnessKey(patch.secondaryHarness)),
    suggestionMenuHarness: patch.suggestionMenuHarness === undefined
      ? current.suggestionMenuHarness
      : readSuggestionHarness(patch.suggestionMenuHarness),
    agentPreference: {
      claude: {
        ...current.agentPreference.claude,
        ...patch.agentPreference?.claude,
      },
      codex: {
        ...current.agentPreference.codex,
        ...patch.agentPreference?.codex,
      },
      acp: {
        ...current.agentPreference.acp,
        ...patch.agentPreference?.acp,
      },
    },
  }
  // Default and secondary must be distinct. Prefer keeping default; drop secondary.
  if (
    merged.suggestionHarness
    && merged.secondaryHarness
    && merged.suggestionHarness.provider === merged.secondaryHarness.provider
    && (
      merged.suggestionHarness.provider !== 'acp'
      || (merged.suggestionHarness.acpAgentId ?? null) === (merged.secondaryHarness.acpAgentId ?? null)
    )
  ) {
    merged.secondaryHarness = null
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
