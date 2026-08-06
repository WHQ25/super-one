export type ReasoningEffort = 'low' | 'medium' | 'high'

export function supportsReasoningEffort(model: string): boolean {
  if (isOpenAiOSeries(model)) return true
  const rest = model.toLowerCase().startsWith('gpt-') ? model.slice(4) : ''
  const first = rest.charAt(0)
  return first >= '5' && first <= '9'
}

function isOpenAiOSeries(model: string): boolean {
  return model.length > 1 && model.startsWith('o') && /[0-9]/.test(model.charAt(1))
}

export function mapThinkingToEffort(
  thinking: unknown,
  maxTokens: number | undefined,
): ReasoningEffort | null {
  const t = asObject(thinking)
  if (!t) return null

  const type = asString(t.type)
  if (type === 'disabled') return null
  if (type === 'adaptive') return 'medium'

  if (type === 'enabled') {
    const budget = typeof t.budget_tokens === 'number' ? t.budget_tokens : 0
    if (maxTokens && maxTokens > 0) {
      const ratio = budget / maxTokens
      if (ratio >= 0.5) return 'high'
      if (ratio >= 0.25) return 'medium'
      return 'low'
    }
    if (budget >= 1024) return 'high'
    if (budget >= 512) return 'medium'
    return 'low'
  }

  return null
}

export function stripModelPrefix(model: string, providerName: string): string {
  if (model.startsWith(`${providerName},`)) {
    return model.slice(providerName.length + 1)
  }
  return model
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
