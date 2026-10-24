import type { McpResourceLink } from '@superone/shared/agent-types'

/**
 * The `resource_link` blocks the CLI collected from an MCP tool's raw result:
 * `tool_use_result.resourceLinks`, or `task_notification.resource_links` for a
 * call that moved to the background. The CLI caps the list; malformed entries
 * are dropped. Undefined when nothing usable remains.
 */
export function mcpResourceLinks(raw: unknown): McpResourceLink[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const links: McpResourceLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { uri, name, title, description, mimeType, size } = item as Record<string, unknown>
    if (typeof uri !== 'string' || !uri || typeof name !== 'string') continue
    links.push({
      uri,
      name,
      ...(typeof title === 'string' && title ? { title } : {}),
      ...(typeof description === 'string' && description ? { description } : {}),
      ...(typeof mimeType === 'string' && mimeType ? { mimeType } : {}),
      ...(typeof size === 'number' && Number.isFinite(size) && size >= 0 ? { size } : {}),
    })
  }
  return links.length ? links : undefined
}

/** `tool_use_result.resourceLinks` of an MCP tool result. */
export function toolResultResourceLinks(toolUseResult: unknown): McpResourceLink[] | undefined {
  if (!toolUseResult || typeof toolUseResult !== 'object' || Array.isArray(toolUseResult)) return undefined
  return mcpResourceLinks((toolUseResult as Record<string, unknown>).resourceLinks)
}
