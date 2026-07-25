import { decryptSecret, encryptSecret } from '../crypto/secret-store'

export interface CursorCloudRepoConfig {
  url: string
  startingRef?: string
  prUrl?: string
}

export interface CursorConfig {
  apiKey?: string
  model?: string
  mode?: 'agent' | 'plan'
  runtime?: 'local' | 'cloud'
  settingSources?: Array<'project' | 'user' | 'team' | 'mdm' | 'plugins' | 'all'>
  sandboxEnabled?: boolean
  autoReview?: boolean
  enableAgentRetries?: boolean
  useHttp1ForAgent?: boolean
  storeKind?: 'better-sqlite3' | 'jsonl'
  // cloud
  cloudEnvType?: 'cloud' | 'pool' | 'machine'
  cloudEnvName?: string
  repos?: CursorCloudRepoConfig[]
  workOnCurrentBranch?: boolean
  autoCreatePR?: boolean
  skipReviewerRequest?: boolean
  cloudEnvVars?: Record<string, string>
}

/** Resolve Cursor User API Key: config (possibly encrypted) → env. */
export function resolveCursorApiKey(config: unknown): string | undefined {
  const fromConfig = readCursorConfig(config).apiKey
  if (fromConfig?.trim()) {
    const plain = decryptSecret(fromConfig.trim())
    if (plain) return plain
  }
  const env = process.env.CURSOR_API_KEY?.trim()
  return env || undefined
}

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

export function encryptCursorApiKey(plain: string): string {
  return encryptSecret(plain)
}

/** Map SuperOne permission modes to Cursor local options we can honor (D7). */
export function mapPermissionToCursorLocal(mode: string): {
  mode: 'agent' | 'plan'
  sandboxEnabled: boolean
  autoReview: boolean
} {
  if (mode === 'plan') {
    return { mode: 'plan', sandboxEnabled: true, autoReview: false }
  }
  if (mode === 'auto' || mode === 'acceptEdits') {
    return { mode: 'agent', sandboxEnabled: true, autoReview: true }
  }
  return { mode: 'agent', sandboxEnabled: true, autoReview: false }
}

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
