/**
 * The title of the page a Claude `Artifact` call published or read, from the
 * structured `tool_use_result`. The model-facing text names only the path and
 * URL — the title comes from the page's own `<title>` — so the host stores it
 * beside that text for the row's link instead of rewriting what the model saw.
 */
export function artifactResultTitle(toolName: string | undefined, toolUseResult: unknown): string | undefined {
  if (toolName !== 'Artifact' || !toolUseResult || typeof toolUseResult !== 'object') return undefined
  const result = toolUseResult as Record<string, unknown>
  const read = result.read && typeof result.read === 'object' ? result.read as Record<string, unknown> : null
  return nonEmpty(result.title) ?? nonEmpty(read?.title)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
