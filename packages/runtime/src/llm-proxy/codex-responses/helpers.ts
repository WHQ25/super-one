export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function get(value: unknown, key: string): unknown {
  return asObject(value)?.[key]
}

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys)
  const obj = asObject(value)
  if (!obj) return value
  const out: Record<string, JsonValue> = {}
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key] as JsonValue)
  return out
}

export function canonicalJsonString(value: JsonValue): string {
  return JSON.stringify(sortKeys(value))
}

export function canonicalizeJsonStringIfParseable(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return value
  try {
    return canonicalJsonString(JSON.parse(trimmed) as JsonValue)
  } catch {
    return value
  }
}

export function canonicalizeToolArguments(value: unknown): string {
  if (typeof value === 'string') {
    if (!value.trim()) return '{}'
    return canonicalizeJsonStringIfParseable(value)
  }
  if (value === undefined || value === null) return '{}'
  return canonicalJsonString(value as JsonValue)
}

export function isOpenAiOSeries(model: string): boolean {
  return model.length > 1 && model.startsWith('o') && /[0-9]/.test(model.charAt(1))
}

export function supportsReasoningEffort(model: string): boolean {
  if (isOpenAiOSeries(model)) return true
  const rest = model.toLowerCase().startsWith('gpt-') ? model.slice(4) : ''
  const first = rest.charAt(0)
  return first >= '5' && first <= '9'
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export function splitLeadingThinkBlock(text: string): { reasoning: string; answer: string } | undefined {
  const afterWs = text.trimStart()
  if (!afterWs.startsWith(THINK_OPEN)) return undefined
  const body = afterWs.slice(THINK_OPEN.length)
  const closeIdx = body.indexOf(THINK_CLOSE)
  if (closeIdx < 0) return undefined
  return {
    reasoning: body.slice(0, closeIdx).trim(),
    answer: body.slice(closeIdx + THINK_CLOSE.length).replace(/^[\r\n\t ]+/, ''),
  }
}

export function stripLeadingThinkOpenTag(text: string): string | undefined {
  const afterWs = text.trimStart()
  if (!afterWs.startsWith(THINK_OPEN)) return undefined
  return afterWs.slice(THINK_OPEN.length).trim()
}

function detailPartText(value: unknown): string | undefined {
  for (const key of ['text', 'content', 'summary']) {
    const text = asString(get(value, key))
    if (text) return text
  }
  const parts = asArray(get(value, 'parts'))
  if (parts) {
    const joined = parts.map(detailPartText).filter((t): t is string => !!t).join('\n\n')
    if (joined) return joined
  }
  return undefined
}

function detailsText(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  const arr = asArray(value)
  if (arr) {
    const joined = arr.map(detailPartText).filter((t): t is string => !!t).join('\n\n')
    return joined || undefined
  }
  if (asObject(value)) return detailPartText(value)
  return undefined
}

export function extractReasoningFieldText(value: unknown): string | undefined {
  for (const key of ['reasoning_content', 'reasoning']) {
    const text = asString(get(value, key))
    if (text) return text
  }
  const reasoning = get(value, 'reasoning')
  if (reasoning) {
    for (const key of ['content', 'text', 'summary']) {
      const text = asString(get(reasoning, key))
      if (text) return text
    }
  }
  const details = get(value, 'reasoning_details')
  if (details) {
    const text = detailsText(details)
    if (text) return text
  }
  return undefined
}

export function extractReasoningSummaryText(value: unknown): string | undefined {
  for (const key of ['reasoning_content', 'content', 'text']) {
    const text = asString(get(value, key))
    if (text) return text
  }
  const summary = get(value, 'summary')
  if (summary === undefined) return undefined
  const asStr = asString(summary)
  if (asStr !== undefined) return asStr || undefined
  const parts = asArray(summary)
  if (!parts) return undefined
  const joined = parts
    .map((part) => asString(get(part, 'text')) ?? asString(get(part, 'content')) ?? asString(part))
    .filter((t): t is string => !!t)
    .join('\n\n')
  return joined || undefined
}

export function appendReasoningContent(message: Record<string, unknown>, reasoning: string): boolean {
  const trimmed = reasoning.trim()
  if (!trimmed) return false
  const existing = asString(message.reasoning_content)
  if (existing) {
    message.reasoning_content = `${existing}\n\n${trimmed}`
  } else {
    message.reasoning_content = trimmed
  }
  return true
}
