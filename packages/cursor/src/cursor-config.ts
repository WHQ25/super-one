/**
 * Electron-free Cursor config helpers (API key plaintext / env only).
 * Desktop wraps these with OS secret-store decrypt/encrypt.
 *
 * Safe for renderer imports — no `node:*` / native resolves here.
 * SDK availability lives in `./cursor-sdk-available`.
 */

export interface CursorCloudRepoConfig {
  url: string
  startingRef?: string
  prUrl?: string
}

/** Global per-model SDK params (model id → param id → catalog value). */
export type CursorModelParamsByModel = Record<string, Record<string, string>>

export interface CursorConfig {
  apiKey?: string
  model?: string
  mode?: 'agent' | 'plan'
  runtime?: 'local' | 'cloud'
  /**
   * On-disk Cursor settings layers for local agents.
   * Default in runtime: `['project', 'user']` when omitted.
   */
  settingSources?: Array<'project' | 'user' | 'team' | 'mdm' | 'plugins' | 'all'>
  sandboxEnabled?: boolean
  autoReview?: boolean
  enableAgentRetries?: boolean
  useHttp1ForAgent?: boolean
  storeKind?: 'better-sqlite3' | 'jsonl'
  /**
   * Harness-scoped remembered model.params selections.
   * Survives across sessions; not app-settings.
   */
  modelParamsByModel?: CursorModelParamsByModel
  /**
   * Model ids hidden from the Cursor model picker.
   * Empty / omitted = all catalog models enabled.
   */
  disabledModelIds?: string[]
  /**
   * Local-only built-in tool allowlist (`AgentOptions.tools`, SDK ≥1.0.25).
   * `undefined` = full default toolset; `[]` = no built-in tools (text only).
   */
  tools?: string[]
  /**
   * Local-only built-in tool denylist (`AgentOptions.disallowedTools`).
   * Deny wins when both tools and disallowedTools are set.
   */
  disallowedTools?: string[]
  /**
   * Convenience preset that expands to tools/disallowedTools when those are omitted.
   * `custom` means use tools/disallowedTools as stored.
   */
  toolPreset?: 'default' | 'readonly' | 'no-shell' | 'custom'
  // cloud
  cloudEnvType?: 'cloud' | 'pool' | 'machine'
  cloudEnvName?: string
  repos?: CursorCloudRepoConfig[]
  workOnCurrentBranch?: boolean
  autoCreatePR?: boolean
  skipReviewerRequest?: boolean
  cloudEnvVars?: Record<string, string>
}

/** Read-only local tool allowlist (no shell / edit / write). */
export const CURSOR_READONLY_TOOLS = [
  'read',
  'grep',
  'glob',
  'ls',
  'semSearch',
  'webSearch',
  'webFetch',
  'readLints',
  'readTodos',
] as const

/**
 * Expand toolPreset + explicit lists into AgentOptions tools fields.
 * Returns undefined fields when using the full default toolset.
 */
export function resolveCursorToolRestrictions(config: Pick<CursorConfig, 'tools' | 'disallowedTools' | 'toolPreset'>): {
  tools?: string[]
  disallowedTools?: string[]
} {
  const preset = config.toolPreset ?? 'default'
  if (config.tools != null || config.disallowedTools != null || preset === 'custom') {
    return {
      ...(config.tools != null ? { tools: config.tools } : {}),
      ...(config.disallowedTools != null ? { disallowedTools: config.disallowedTools } : {}),
    }
  }
  if (preset === 'readonly') {
    return { tools: [...CURSOR_READONLY_TOOLS] }
  }
  if (preset === 'no-shell') {
    return { disallowedTools: ['shell'] }
  }
  return {}
}

const ENC_PREFIX = 'enc:v1:'

/**
 * Parse a loose `modelParamsByModel` map into string→string param rows.
 */
export function readCursorModelParamsByModel(value: unknown): CursorModelParamsByModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: CursorModelParamsByModel = {}
  for (const [modelId, rawParams] of Object.entries(value as Record<string, unknown>)) {
    if (!modelId.trim() || !rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) continue
    const row: Record<string, string> = {}
    for (const [paramId, paramValue] of Object.entries(rawParams as Record<string, unknown>)) {
      if (typeof paramValue === 'string') row[paramId] = paramValue
    }
    if (Object.keys(row).length > 0) out[modelId] = row
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Parse a string id list (drops empties / non-strings).
 */
export function readStringIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = [...new Set(
    value
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean),
  )]
  return ids.length > 0 ? ids : undefined
}

/** @deprecated Prefer {@link readStringIdList}. */
export const readCursorDisabledModelIds = readStringIdList

/**
 * Drop models the user disabled in Cursor harness settings.
 * Empty / missing `disabledModelIds` keeps the full catalog.
 */
export function filterEnabledCursorModels<T extends { id: string }>(
  models: T[],
  config: Pick<CursorConfig, 'disabledModelIds'> | null | undefined,
): T[] {
  const disabled = new Set(config?.disabledModelIds ?? [])
  if (disabled.size === 0) return models
  return models.filter((model) => !disabled.has(model.id))
}

/**
 * Resolve Cursor User API Key from plaintext config or `CURSOR_API_KEY`.
 * Does not decrypt Electron secret-store blobs (`enc:v1:…`).
 */
export function resolveCursorApiKeyPlain(config: unknown): string | undefined {
  const fromConfig = readCursorConfig(config).apiKey?.trim()
  if (fromConfig && !fromConfig.startsWith(ENC_PREFIX)) return fromConfig
  const env = process.env.CURSOR_API_KEY?.trim()
  return env || undefined
}

/** Parse a loose config object into a typed {@link CursorConfig}. */
export function readCursorConfig(value: unknown): CursorConfig {
  if (!value || typeof value !== 'object') return {}
  const config = value as Record<string, unknown>
  const repos = Array.isArray(config.repos)
    ? config.repos.flatMap((r): CursorCloudRepoConfig[] => {
        if (!r || typeof r !== 'object') return []
        const row = r as Record<string, unknown>
        if (typeof row.url !== 'string' || !row.url) return []
        return [{
          url: row.url,
          startingRef: typeof row.startingRef === 'string' ? row.startingRef : undefined,
          prUrl: typeof row.prUrl === 'string' ? row.prUrl : undefined,
        }]
      })
    : undefined
  const cloudEnvVars = config.cloudEnvVars && typeof config.cloudEnvVars === 'object'
    ? config.cloudEnvVars as Record<string, string>
    : undefined
  return {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : undefined,
    model: typeof config.model === 'string' ? config.model : undefined,
    mode: config.mode === 'plan' || config.mode === 'agent' ? config.mode : undefined,
    runtime: config.runtime === 'cloud' || config.runtime === 'local' ? config.runtime : undefined,
    settingSources: Array.isArray(config.settingSources)
      ? config.settingSources.filter((s): s is NonNullable<CursorConfig['settingSources']>[number] =>
        typeof s === 'string')
      : undefined,
    sandboxEnabled: typeof config.sandboxEnabled === 'boolean' ? config.sandboxEnabled : undefined,
    autoReview: typeof config.autoReview === 'boolean' ? config.autoReview : undefined,
    enableAgentRetries: typeof config.enableAgentRetries === 'boolean' ? config.enableAgentRetries : undefined,
    useHttp1ForAgent: typeof config.useHttp1ForAgent === 'boolean' ? config.useHttp1ForAgent : undefined,
    storeKind: config.storeKind === 'jsonl' || config.storeKind === 'better-sqlite3' ? config.storeKind : undefined,
    modelParamsByModel: readCursorModelParamsByModel(config.modelParamsByModel),
    disabledModelIds: readStringIdList(config.disabledModelIds),
    tools: readStringIdList(config.tools),
    disallowedTools: readStringIdList(config.disallowedTools),
    toolPreset: config.toolPreset === 'readonly'
      || config.toolPreset === 'no-shell'
      || config.toolPreset === 'custom'
      || config.toolPreset === 'default'
      ? config.toolPreset
      : undefined,
    cloudEnvType: config.cloudEnvType === 'pool' || config.cloudEnvType === 'machine' || config.cloudEnvType === 'cloud'
      ? config.cloudEnvType
      : undefined,
    cloudEnvName: typeof config.cloudEnvName === 'string' ? config.cloudEnvName : undefined,
    repos,
    workOnCurrentBranch: typeof config.workOnCurrentBranch === 'boolean' ? config.workOnCurrentBranch : undefined,
    autoCreatePR: typeof config.autoCreatePR === 'boolean' ? config.autoCreatePR : undefined,
    skipReviewerRequest: typeof config.skipReviewerRequest === 'boolean' ? config.skipReviewerRequest : undefined,
    cloudEnvVars,
  }
}

/**
 * Map SuperOne permission modes to Cursor local options we can honor.
 * Sandbox is orthogonal (`sandboxOptions.enabled` / session sandbox toggle) — not folded in here.
 *
 * Product ladder (Cursor UI): Auto → Plan → Full Access.
 * - `auto` / legacy `default` / `acceptEdits` → Auto-review classifier
 * - `plan` → plan mode
 * - `bypassPermissions` (and other high-automation ids) → unrestricted agent
 */
export function mapPermissionToCursorLocal(mode: string): {
  mode: 'agent' | 'plan'
  autoReview: boolean
} {
  if (mode === 'plan') {
    return { mode: 'plan', autoReview: false }
  }
  if (mode === 'auto' || mode === 'acceptEdits' || mode === 'default') {
    return { mode: 'agent', autoReview: true }
  }
  return { mode: 'agent', autoReview: false }
}

/** Build Cursor SDK cloud options from SuperOne config. */
export function buildCloudOptions(config: CursorConfig): import('@cursor/sdk').CloudAgentOptions {
  const envType = config.cloudEnvType ?? 'cloud'
  return {
    env: config.cloudEnvName
      ? { type: envType, name: config.cloudEnvName }
      : { type: envType },
    ...(config.repos?.length ? { repos: config.repos } : {}),
    ...(config.workOnCurrentBranch != null ? { workOnCurrentBranch: config.workOnCurrentBranch } : {}),
    ...(config.autoCreatePR != null ? { autoCreatePR: config.autoCreatePR } : {}),
    ...(config.skipReviewerRequest != null ? { skipReviewerRequest: config.skipReviewerRequest } : {}),
    ...(config.cloudEnvVars ? { envVars: config.cloudEnvVars } : {}),
  }
}
