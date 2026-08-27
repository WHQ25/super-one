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
  PowerMode,
  QuestionPreviewFormat,
  SandboxMode,
  SuggestionHarnessPreference,
  ThemeMode,
  UpdateChannel,
  WebmcpTrustedOrigin,
} from '@superone/shared/agent-types'
import { sanitizeOverrides } from '@superone/shared/harness-brand'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'

export type { AppSettings, AppSettingsPatch }

type ClaudePref = AppSettings['agentPreference']['claude']
type CodexPref = AppSettings['agentPreference']['codex']
type AcpPref = AppSettings['agentPreference']['acp']
type BrandOnlyPref = AppSettings['agentPreference']['dsh']

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

function normalizeComputerUseDisplayId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const displayId = value.trim()
  return displayId || null
}

function readPowerMode(data: Record<string, unknown>): PowerMode {
  if (data.powerMode === 'system'
    || data.powerMode === 'prevent-idle-sleep'
    || data.powerMode === 'lid-closed-on-ac') {
    return data.powerMode
  }
  // Compatibility with builds that briefly exposed the closed-lid boolean.
  if (data.keepRunningWithLidClosedOnAc === true) return 'lid-closed-on-ac'
  return 'system'
}

const defaults: AppSettings = {
  analyticsEnabled: true,
  powerMode: 'system',
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
  webmcpEnabled: false,
  webmcpTrustedOrigins: [],
  cdpCookiesEnabled: false,
  cdpMockEnabled: false,
  cdpEmulateEnabled: false,
  browserToolSurface: 'legacy',
  computerUseEnabled: false,
  computerUsePictureInPicture: true,
  computerUseDedicatedDisplayId: null,
  computerUseAllowAllApps: false,
  computerUseAlwaysAllowApps: [],
  miniAppOrder: {},
  customAppIconPath: null,
  browserBookmarks: [],
  browserBookmarkGroups: [],
  defaultClonePaths: {},
  harnessOrder: [],
  suggestionHarness: null,
  secondaryHarness: null,
  suggestionMenuHarness: null,
  onboardingCompletedAt: null,
  onboardingEpoch: 0,
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
      defaultPermissionPreset: 'auto-review',
      brandHue: null,
      tokenOverrides: {},
    },
    acp: {
      enabled: false,
      brandHue: null,
      tokenOverrides: {},
      selectedAgentId: null,
    },
    cursor: { brandHue: null, tokenOverrides: {} },
    dsh: { brandHue: null, tokenOverrides: {} },
    opencode: { brandHue: null, tokenOverrides: {} },
  },
}

const HARNESS_IDS = new Set(Object.keys(HARNESS_CAPABILITIES) as HarnessId[])

function isHarnessId(value: string): value is HarnessId {
  return HARNESS_IDS.has(value as HarnessId)
}

function readSuggestionHarness(value: unknown): SuggestionHarnessPreference | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  if (!isHarnessId(provider)) return null
  const acpAgentId = typeof raw.acpAgentId === 'string' && raw.acpAgentId.trim()
    ? raw.acpAgentId.trim()
    : null
  if (provider === 'acp' && !acpAgentId) return null
  return {
    provider,
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
 * Accepts object form, `"auto"`/`null`/empty for Auto, a non-ACP harness id, or `acp:<id>`.
 */
export function parseSuggestionHarnessKey(value: unknown): SuggestionHarnessPreference | null {
  if (value == null || value === '' || value === 'auto') return null
  if (typeof value === 'object') return readSuggestionHarness(value)
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key || key === 'auto') return null
  if (key !== 'acp' && isHarnessId(key)) {
    return { provider: key, acpAgentId: null }
  }
  if (key.startsWith('acp:')) {
    const agent = key.slice(4).trim()
    return agent ? { provider: 'acp', acpAgentId: agent } : null
  }
  return null
}

/** Valid order keys: a non-ACP harness id or `acp:<agentId>`. */
export function isHarnessOrderKey(key: string): boolean {
  return parseSuggestionHarnessKey(key) != null
}

export function readHarnessOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const key = item.trim()
    if (!key || seen.has(key) || !isHarnessOrderKey(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** Move `key` to `index` (clamped), creating the list if needed. */
export function moveHarnessOrderKey(order: string[], key: string, index: number): string[] {
  if (!isHarnessOrderKey(key)) return order
  const without = order.filter((k) => k !== key)
  const next = [...without]
  const at = Math.max(0, Math.min(index, next.length))
  next.splice(at, 0, key)
  return next
}

function preferenceFromOrderKey(key: string | undefined): SuggestionHarnessPreference | null {
  if (!key) return null
  return parseSuggestionHarnessKey(key)
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

function readWebmcpTrustedOrigins(value: unknown): WebmcpTrustedOrigin[] {
  if (!Array.isArray(value)) return []
  const out: WebmcpTrustedOrigin[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.origin !== 'string') continue
    const origin = entry.origin.trim()
    if (!origin || seen.has(origin)) continue
    seen.add(origin)
    const tools: Record<string, string> = {}
    if (entry.tools && typeof entry.tools === 'object' && !Array.isArray(entry.tools)) {
      for (const [name, fingerprint] of Object.entries(entry.tools as Record<string, unknown>)) {
        if (typeof fingerprint === 'string' && fingerprint) tools[name] = fingerprint
      }
    }
    out.push({ origin, tools })
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
  return value === '' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max' || value === 'ultra'
}

function isCodexPermissionPreset(value: unknown): value is CodexPermissionPreset {
  return value === 'read-only' || value === 'default' || value === 'auto-review' || value === 'full-access'
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

/** Harnesses that store nothing but brand theming (`cursor`, `dsh`, `opencode`). */
function readBrandOnlyPreference(data: Record<string, unknown>, key: 'cursor' | 'dsh' | 'opencode'): BrandOnlyPref {
  const agentPreference = data.agentPreference && typeof data.agentPreference === 'object'
    ? data.agentPreference as Record<string, unknown>
    : undefined
  const pref = agentPreference?.[key] && typeof agentPreference[key] === 'object'
    ? agentPreference[key] as Record<string, unknown>
    : undefined
  return {
    brandHue: readBrandHue(pref?.brandHue),
    tokenOverrides: sanitizeOverrides(pref?.tokenOverrides),
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
      powerMode: readPowerMode(data),
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
      webmcpEnabled: typeof data.webmcpEnabled === 'boolean' ? data.webmcpEnabled : defaults.webmcpEnabled,
      webmcpTrustedOrigins: readWebmcpTrustedOrigins(data.webmcpTrustedOrigins),
      cdpCookiesEnabled: typeof data.cdpCookiesEnabled === 'boolean' ? data.cdpCookiesEnabled : defaults.cdpCookiesEnabled,
      cdpMockEnabled: typeof data.cdpMockEnabled === 'boolean' ? data.cdpMockEnabled : defaults.cdpMockEnabled,
      cdpEmulateEnabled: typeof data.cdpEmulateEnabled === 'boolean' ? data.cdpEmulateEnabled : defaults.cdpEmulateEnabled,
      browserToolSurface: data.browserToolSurface === 'legacy' || data.browserToolSurface === 'compact'
        ? data.browserToolSurface
        : defaults.browserToolSurface,
      computerUseEnabled: typeof data.computerUseEnabled === 'boolean' ? data.computerUseEnabled : defaults.computerUseEnabled,
      computerUsePictureInPicture: typeof data.computerUsePictureInPicture === 'boolean'
        ? data.computerUsePictureInPicture
        : defaults.computerUsePictureInPicture,
      computerUseDedicatedDisplayId: normalizeComputerUseDisplayId(
        data.computerUseDedicatedDisplayId,
      ),
      computerUseAllowAllApps: typeof data.computerUseAllowAllApps === 'boolean' ? data.computerUseAllowAllApps : defaults.computerUseAllowAllApps,
      computerUseAlwaysAllowApps: readComputerUseAlwaysAllowApps(data.computerUseAlwaysAllowApps),
      miniAppOrder: readMiniAppOrder(data.miniAppOrder),
      customAppIconPath: typeof data.customAppIconPath === 'string' ? data.customAppIconPath : defaults.customAppIconPath,
      browserBookmarks: readBookmarks(data.browserBookmarks),
      browserBookmarkGroups: readBookmarkGroups(data.browserBookmarkGroups),
      defaultClonePaths: readDefaultClonePaths(data.defaultClonePaths),
      ...(() => {
        const harnessOrder = readHarnessOrder(data.harnessOrder)
        // `defaultHarness` is accepted as a legacy/alias key for config-tool clarity.
        let suggestionHarness = readSuggestionHarness(data.suggestionHarness ?? data.defaultHarness)
          ?? parseSuggestionHarnessKey(data.suggestionHarness ?? data.defaultHarness)
        let secondaryHarness = readSuggestionHarness(data.secondaryHarness)
          ?? parseSuggestionHarnessKey(data.secondaryHarness)
        // Full manual order owns pins (index 0 / 1).
        if (harnessOrder.length > 0) {
          suggestionHarness = preferenceFromOrderKey(harnessOrder[0])
          secondaryHarness = preferenceFromOrderKey(harnessOrder[1])
        }
        return { harnessOrder, suggestionHarness, secondaryHarness }
      })(),
      suggestionMenuHarness: readSuggestionHarness(data.suggestionMenuHarness),
      onboardingCompletedAt:
        typeof data.onboardingCompletedAt === 'number'
          ? data.onboardingCompletedAt
          : data.onboardingCompletedAt === null
            ? null
            : null,
      // 0 = never completed current onboarding epoch (force Welcome → Discover).
      onboardingEpoch:
        typeof data.onboardingEpoch === 'number' && Number.isFinite(data.onboardingEpoch)
          ? Math.max(0, Math.floor(data.onboardingEpoch))
          : 0,
      agentPreference: {
        claude: readClaudePreference(data),
        codex: readCodexPreference(data),
        acp: readAcpPreference(data),
        cursor: readBrandOnlyPreference(data, 'cursor'),
        dsh: readBrandOnlyPreference(data, 'dsh'),
        opencode: readBrandOnlyPreference(data, 'opencode'),
      },
    }
  } catch {
    return {
      analyticsEnabled: defaults.analyticsEnabled,
      powerMode: defaults.powerMode,
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
      webmcpEnabled: defaults.webmcpEnabled,
      webmcpTrustedOrigins: [],
      cdpCookiesEnabled: defaults.cdpCookiesEnabled,
      cdpMockEnabled: defaults.cdpMockEnabled,
      cdpEmulateEnabled: defaults.cdpEmulateEnabled,
      browserToolSurface: defaults.browserToolSurface,
      computerUseEnabled: defaults.computerUseEnabled,
      computerUsePictureInPicture: defaults.computerUsePictureInPicture,
      computerUseDedicatedDisplayId: defaults.computerUseDedicatedDisplayId,
      computerUseAllowAllApps: defaults.computerUseAllowAllApps,
      computerUseAlwaysAllowApps: [],
      miniAppOrder: {},
      customAppIconPath: defaults.customAppIconPath,
      browserBookmarks: [],
      browserBookmarkGroups: [],
      defaultClonePaths: {},
      harnessOrder: [],
      suggestionHarness: null,
      secondaryHarness: null,
      suggestionMenuHarness: null,
      onboardingCompletedAt: null,
      onboardingEpoch: 0,
      agentPreference: {
        claude: { ...defaults.agentPreference.claude },
        codex: { ...defaults.agentPreference.codex },
        acp: { ...defaults.agentPreference.acp },
        cursor: { ...defaults.agentPreference.cursor },
        dsh: { ...defaults.agentPreference.dsh },
        opencode: { ...defaults.agentPreference.opencode },
      },
    }
  }
}

export function saveAppSettings(patch: AppSettingsPatch): AppSettings {
  const current = readAppSettings()

  let suggestionHarness = patch.suggestionHarness === undefined
    ? current.suggestionHarness
    : (readSuggestionHarness(patch.suggestionHarness) ?? parseSuggestionHarnessKey(patch.suggestionHarness))
  let secondaryHarness = patch.secondaryHarness === undefined
    ? current.secondaryHarness
    : (readSuggestionHarness(patch.secondaryHarness) ?? parseSuggestionHarnessKey(patch.secondaryHarness))

  let harnessOrder = patch.harnessOrder !== undefined
    ? readHarnessOrder(patch.harnessOrder)
    : current.harnessOrder

  // Explicit full order owns default/secondary pins (index 0 / 1).
  if (patch.harnessOrder !== undefined) {
    suggestionHarness = preferenceFromOrderKey(harnessOrder[0])
    secondaryHarness = preferenceFromOrderKey(harnessOrder[1])
  } else if (harnessOrder.length > 0) {
    // Pin writes (ChatSuggestions / config tools) keep the ordered list in sync.
    if (patch.suggestionHarness !== undefined) {
      const key = serializeSuggestionHarness(suggestionHarness)
      if (key) harnessOrder = moveHarnessOrderKey(harnessOrder, key, 0)
    }
    if (patch.secondaryHarness !== undefined) {
      const key = serializeSuggestionHarness(secondaryHarness)
      if (key) {
        // Prefer #2; if key is already #1 and default was not also patched, leave at #1.
        const at = harnessOrder.indexOf(key)
        if (at !== 0 || patch.suggestionHarness !== undefined) {
          harnessOrder = moveHarnessOrderKey(harnessOrder, key, 1)
        }
      }
    }
    // Re-derive pins from the resulting order so UI/MCP stay consistent.
    suggestionHarness = preferenceFromOrderKey(harnessOrder[0]) ?? suggestionHarness
    secondaryHarness = preferenceFromOrderKey(harnessOrder[1])
  }

  // Default and secondary must be distinct. Prefer keeping default; drop secondary.
  if (
    suggestionHarness
    && secondaryHarness
    && suggestionHarness.provider === secondaryHarness.provider
    && (
      suggestionHarness.provider !== 'acp'
      || (suggestionHarness.acpAgentId ?? null) === (secondaryHarness.acpAgentId ?? null)
    )
  ) {
    secondaryHarness = null
    if (harnessOrder.length > 1) {
      const dupKey = serializeSuggestionHarness(suggestionHarness)
      if (dupKey && harnessOrder[1] === dupKey) {
        harnessOrder = [harnessOrder[0], ...harnessOrder.slice(2)]
      }
    }
  }

  const merged: AppSettings = {
    analyticsEnabled: patch.analyticsEnabled ?? current.analyticsEnabled,
    powerMode: patch.powerMode ?? current.powerMode,
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
    webmcpEnabled: patch.webmcpEnabled === undefined ? current.webmcpEnabled : patch.webmcpEnabled,
    webmcpTrustedOrigins: patch.webmcpTrustedOrigins === undefined
      ? current.webmcpTrustedOrigins
      : readWebmcpTrustedOrigins(patch.webmcpTrustedOrigins),
    cdpCookiesEnabled: patch.cdpCookiesEnabled === undefined ? current.cdpCookiesEnabled : patch.cdpCookiesEnabled,
    cdpMockEnabled: patch.cdpMockEnabled === undefined ? current.cdpMockEnabled : patch.cdpMockEnabled,
    cdpEmulateEnabled: patch.cdpEmulateEnabled === undefined ? current.cdpEmulateEnabled : patch.cdpEmulateEnabled,
    browserToolSurface: patch.browserToolSurface === undefined ? current.browserToolSurface : patch.browserToolSurface,
    computerUseEnabled: patch.computerUseEnabled === undefined ? current.computerUseEnabled : patch.computerUseEnabled,
    computerUsePictureInPicture: patch.computerUsePictureInPicture === undefined
      ? current.computerUsePictureInPicture
      : patch.computerUsePictureInPicture,
    computerUseDedicatedDisplayId: patch.computerUseDedicatedDisplayId === undefined
      ? current.computerUseDedicatedDisplayId
      : normalizeComputerUseDisplayId(patch.computerUseDedicatedDisplayId),
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
    harnessOrder,
    suggestionHarness,
    secondaryHarness,
    suggestionMenuHarness: patch.suggestionMenuHarness === undefined
      ? current.suggestionMenuHarness
      : readSuggestionHarness(patch.suggestionMenuHarness),
    onboardingCompletedAt: patch.onboardingCompletedAt === undefined
      ? current.onboardingCompletedAt
      : patch.onboardingCompletedAt,
    onboardingEpoch: patch.onboardingEpoch === undefined
      ? current.onboardingEpoch
      : (typeof patch.onboardingEpoch === 'number' && Number.isFinite(patch.onboardingEpoch)
          ? Math.max(0, Math.floor(patch.onboardingEpoch))
          : current.onboardingEpoch),
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
      cursor: {
        ...current.agentPreference.cursor,
        ...patch.agentPreference?.cursor,
      },
      dsh: {
        ...current.agentPreference.dsh,
        ...patch.agentPreference?.dsh,
      },
      opencode: {
        ...current.agentPreference.opencode,
        ...patch.agentPreference?.opencode,
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
