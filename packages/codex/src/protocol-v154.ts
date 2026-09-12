function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Tool discovery failed with no catalog. Independent of runtime connection status. */
export function readCodexMcpToolsError(value: unknown): string | undefined {
  return readString(value) ?? undefined
}

/** Auth challenge on a failed MCP tool result (`_meta["mcp/www_authenticate"]`). */
export function readCodexMcpWwwAuthenticate(meta: unknown): unknown {
  const rec = asRecord(meta)
  if (!rec) return undefined
  if (rec['mcp/www_authenticate'] !== undefined) return rec['mcp/www_authenticate']
  return rec.mcpWwwAuthenticate
}

export function codexMcpResultHasAuthChallenge(
  result: { meta?: Record<string, unknown> } | undefined,
): boolean {
  return readCodexMcpWwwAuthenticate(result?.meta) !== undefined
}
