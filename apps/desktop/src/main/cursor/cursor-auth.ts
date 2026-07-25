import { decryptSecret, encryptSecret } from '../crypto/secret-store'

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
  // default / dontAsk / bypassPermissions: honest sandboxed agent (not guaranteed bypass)
  return { mode: 'agent', sandboxEnabled: true, autoReview: false }
}
