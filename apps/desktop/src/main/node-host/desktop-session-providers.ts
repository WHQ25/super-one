import type { SessionProviderRecord, SessionProviderStore } from '@superone/runtime/session'

/** What a node client sees in place of a profile secret; writing it back keeps this desktop's stored value. */
export const REDACTED_PROFILE_SECRET = '[REDACTED]'

/** Profile config fields that hold a secret (`session/harness-registry.ts` schemas). */
const SECRET_FIELDS = ['apiKey', 'serverPassword'] as const
/** Profile config fields whose values are environment variables, any of which may be a secret. */
const SECRET_ENV_FIELDS = ['env', 'extraEnv', 'cloudEnvVars'] as const

type ConfigRecord = Record<string, unknown>

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redactConfig(config: unknown): unknown {
  if (!isRecord(config)) return config
  const out: ConfigRecord = { ...config }
  for (const key of SECRET_FIELDS) {
    if (typeof out[key] === 'string' && out[key]) out[key] = REDACTED_PROFILE_SECRET
  }
  for (const key of SECRET_ENV_FIELDS) {
    const env = out[key]
    if (isRecord(env)) out[key] = Object.fromEntries(Object.keys(env).map((name) => [name, REDACTED_PROFILE_SECRET]))
  }
  return out
}

/** Put back the stored secret for every redacted value a client wrote; drop the ones with nothing stored. */
function restoreSecrets(config: unknown, stored: unknown): unknown {
  if (!isRecord(config)) return config
  const prior = isRecord(stored) ? stored : {}
  const out: ConfigRecord = { ...config }
  for (const key of SECRET_FIELDS) {
    if (out[key] !== REDACTED_PROFILE_SECRET) continue
    if (key in prior) out[key] = prior[key]
    else delete out[key]
  }
  for (const key of SECRET_ENV_FIELDS) {
    const env = out[key]
    if (!isRecord(env)) continue
    const priorEnv = isRecord(prior[key]) ? prior[key] : {}
    out[key] = Object.fromEntries(Object.entries(env).flatMap(([name, value]) =>
      value !== REDACTED_PROFILE_SECRET ? [[name, value]] : name in priorEnv ? [[name, priorEnv[name]]] : []))
  }
  return out
}

function redact<T extends SessionProviderRecord | null>(provider: T): T {
  return (provider && { ...provider, config: redactConfig(provider.config) }) as T
}

/**
 * This desktop's session provider profiles as node clients see them: secrets
 * (API keys, server passwords, environment values) never leave this desktop,
 * as `provider.*` masks credentials. A client that writes a redacted value
 * back keeps the stored one, so editing a profile's other fields is lossless.
 */
export function redactedSessionProviderStore(store: SessionProviderStore): SessionProviderStore {
  return {
    list: () => store.list().map(redact),
    listByHarness: (harnessId) => store.listByHarness(harnessId).map(redact),
    get: (id) => redact(store.get(id)),
    getBase: (harnessId) => redact(store.getBase(harnessId)),
    create: (input) => redact(store.create({ ...input, config: restoreSecrets(input.config, undefined) })),
    update: (id, patch) => redact(store.update(id, patch.config === undefined
      ? patch
      : { ...patch, config: restoreSecrets(patch.config, store.get(id)?.config) })),
    delete: (id) => store.delete(id),
  }
}
