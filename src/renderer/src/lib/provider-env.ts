export const MODEL_ENV_KEYS = [
  { key: 'ANTHROPIC_MODEL', label: 'Default Model' },
  { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', label: 'Sonnet' },
  { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', label: 'Opus' },
  { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', label: 'Haiku' },
  { key: 'CLAUDE_CODE_SUBAGENT_MODEL', label: 'Subagent' },
] as const

export const MODEL_ENV_KEY_SET: Set<string> = new Set(MODEL_ENV_KEYS.map((m) => m.key))
export const INTERNAL_ENV_KEYS: Set<string> = new Set(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'])

export function splitEnv(envJson: string): { modelEnv: Record<string, string>; internalEnv: Record<string, string>; restEnv: string } {
  try {
    const obj = JSON.parse(envJson)
    const modelEnv: Record<string, string> = {}
    const internalEnv: Record<string, string> = {}
    const rest: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (MODEL_ENV_KEY_SET.has(k)) modelEnv[k] = String(v)
      else if (INTERNAL_ENV_KEYS.has(k)) internalEnv[k] = String(v)
      else rest[k] = String(v)
    }
    return { modelEnv, internalEnv, restEnv: JSON.stringify(rest) }
  } catch {
    return { modelEnv: {}, internalEnv: {}, restEnv: envJson }
  }
}

export function mergeEnv(restEnv: string, modelEnv: Record<string, string>, internalEnv: Record<string, string>): string {
  try {
    const obj = JSON.parse(restEnv)
    for (const { key } of MODEL_ENV_KEYS) {
      if (modelEnv[key]) obj[key] = modelEnv[key]
      else delete obj[key]
    }
    Object.assign(obj, internalEnv)
    return JSON.stringify(obj)
  } catch {
    return restEnv
  }
}
