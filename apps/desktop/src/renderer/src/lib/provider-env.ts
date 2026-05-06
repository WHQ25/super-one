export const RESERVED_ENV_KEYS: Set<string> = new Set([
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
])

export function parseEnvString(text: string): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = []
  const seen = new Set<string>()
  const lines = text.split('\n')
  for (const line of lines) {
    let trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim()
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !seen.has(key)) {
      seen.add(key)
      result.push({ key, value })
    }
  }
  return result
}
