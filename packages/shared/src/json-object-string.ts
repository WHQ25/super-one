/**
 * Untyped MCP proxies (`call_mcp_tool`) stringify nested JSON. A value is left
 * unchanged unless it is a JSON-encoded object, so booleans, arrays, and broken
 * JSON still fail object validation.
 */
export function coerceJsonObjectString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return value
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Not a JSON object. Leave the original string for schema validation.
  }
  return value
}

/** A string|array or string|object union must parse the JSON text before the string variant accepts it. */
export function coerceJsonContainerString(value: unknown): unknown {
  return coerceJsonObjectString(coerceJsonArrayString(value))
}

/** Same proxy case for array parameters (`actions`, `tags`, `launches`). */
export function coerceJsonArrayString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('[')) return value
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Not a JSON array. Leave the original string for schema validation.
  }
  return value
}

/** A plain object, or a string whose JSON value is one. */
export function jsonObjectRecord(value: unknown): Record<string, unknown> | undefined {
  const coerced = coerceJsonObjectString(value)
  if (!coerced || typeof coerced !== 'object' || Array.isArray(coerced)) return undefined
  return coerced as Record<string, unknown>
}
