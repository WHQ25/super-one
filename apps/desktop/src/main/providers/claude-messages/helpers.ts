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

export function canonicalizeToolArguments(value: unknown): string {
  if (typeof value === 'string') {
    if (!value.trim()) return '{}'
    try {
      return JSON.stringify(JSON.parse(value))
    } catch {
      return value
    }
  }
  if (value === undefined || value === null) return '{}'
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

export function isOpenAiOSeries(model: string): boolean {
  return model.length > 1 && model.startsWith('o') && /[0-9]/.test(model.charAt(1))
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
    if (typeof details === 'string') return details || undefined
    const arr = asArray(details)
    if (arr) {
      const joined = arr
        .map((part) => asString(get(part, 'text')) ?? asString(get(part, 'content')) ?? asString(part))
        .filter((t): t is string => !!t)
        .join('\n\n')
      return joined || undefined
    }
    const obj = asObject(details)
    if (obj) {
      const text = asString(get(obj, 'text')) ?? asString(get(obj, 'content')) ?? asString(get(obj, 'summary'))
      if (text) return text
    }
  }
  return undefined
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
