import { formatMcpResourceReminder, parseMcpMentionValue, type McpMentionReadResource } from '@superone/shared/mcp-app-mentions'
import type { McpAppRoute } from './desktop-executor'
import type { Mention } from '@/stores/chat-store/types'

/**
 * The agent-only block carrying the text of the MCP resources a message mentions,
 * read by the host at send so the model needs no tool round-trip. Empty when there
 * is nothing to inline or the read fails: the mention tag still names the resource.
 */
export async function mcpMentionContentForModel(projectPath: string, sessionId: string, mentions: Mention[]): Promise<string> {
  const targets = mentions.flatMap((mention) => {
    const parsed = mention.kind === 'mcp-resource' ? parseMcpMentionValue(mention.value) : null
    return parsed ? [parsed] : []
  })
  if (!targets.length) return ''
  try {
    const result = await window.environment.mcpAppMentionRead(projectPath, sessionId, targets)
    return result.ok ? formatMcpResourceReminder(result.value) : ''
  } catch (error) {
    console.warn('[mcp-mentions] reading mentioned resources failed', error)
    return ''
  }
}

/** Hovering again within this window reuses the read; sending always reads afresh. */
const PREVIEW_TTL_MS = 30_000
const previews = new Map<string, { at: number; read: Promise<McpMentionReadResource | null> }>()

/** What sending would inline for one composer chip, read now through the same path. `null`: no answer. */
export function previewMcpMention(route: McpAppRoute, value: string): Promise<McpMentionReadResource | null> {
  const target = parseMcpMentionValue(value)
  if (!target) return Promise.resolve(null)
  const key = JSON.stringify([route.projectPath, route.sessionId, value])
  const cached = previews.get(key)
  if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.read
  const read = window.environment.mcpAppMentionRead(route.projectPath, route.sessionId, [target])
    .then((result) => (result.ok ? result.value[0] ?? null : null))
  previews.set(key, { at: Date.now(), read })
  // A failed read is not worth keeping: the next hover may find the server up.
  void read.then((resource) => { if (!resource || resource.skipped === 'failed') previews.delete(key) }, () => previews.delete(key))
  return read
}
