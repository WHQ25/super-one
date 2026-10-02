import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import {
  createMcpMentionPreviewCache, formatMcpResourceReminder, mcpResourceTargets, parseMcpMentionValue, type McpMentionReadResource, type McpMentionSearchResult,
} from '@superone/shared/mcp-app-mentions'
import { randomId } from './ids'
import { mentionIconPngPayload } from './mentions'

export type MentionSearchResult = {
  items?: unknown[]
  agentTargets?: unknown
  capabilityIds?: unknown
  /** The directory the host actually searched — a worktree, not the project. */
  cwd?: string
  /**
   * Which of the requested options the host honoured. Absent on hosts that
   * predate them, which is exactly what makes it a capability probe: a scoped
   * request answered project-wide looks identical otherwise, and its top-20 may
   * have ranked every in-scope file out.
   */
  appliedOptions?: { scopeDir?: boolean; additionalDirs?: boolean; iconsById?: boolean }
  /** Whether `@git` can be entered for the searched cwd; absent on older hosts. */
  gitMention?: unknown
  error?: string
}

export interface MentionSearchOptions {
  /** Confine the search to this directory, relative to the session's cwd. */
  scopeDir?: string
}

/**
 * Ask for icons by content id rather than by value.
 *
 * Every keystroke re-runs this search, and app icons are most of what comes
 * back. The device caches the bytes and fetches only the ids it has never seen;
 * a host too old to understand this keeps inlining them, which still works.
 */
const ICONS_BY_ID = true

/** Works before session creation as well as inside an active chat. */
export function requestMentionSearch(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  query: string,
  options: MentionSearchOptions = {},
): Promise<MentionSearchResult> {
  return client.request({
    type: 'search_mentions',
    requestId: randomId(),
    projectPath,
    query,
    iconsById: ICONS_BY_ID,
    ...(options.scopeDir !== undefined ? { scopeDir: options.scopeDir } : {}),
  }) as Promise<MentionSearchResult>
}

/** Fetch icon bytes for ids the device has never seen. */
export async function requestMentionIcons(
  client: Pick<RelayClient, 'request'>,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const reply = await client.request({
    type: 'get_mention_icons', requestId: randomId(), ids: [...ids],
  } as RemoteCommand) as { icons?: unknown } | null
  const raw = reply?.icons
  if (!raw || typeof raw !== 'object') return {}
  const icons: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const png = mentionIconPngPayload(value)
    if (png) icons[id] = png
  }
  return icons
}

/** The host gives servers 15 s; a little more covers the relay. */
const MCP_MENTION_SEARCH_TIMEOUT_MS = 20_000

/**
 * Items the session's MCP servers offer for `@` (`mentions/search`). A server may
 * start its harness to answer, so this waits as long as the host does.
 */
export async function requestMcpMentionSearch(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  sessionId: string,
  query: string,
): Promise<McpMentionSearchResult> {
  const reply = await client.request({
    type: 'search_mcp_mentions', requestId: randomId(), projectPath, sessionId, query,
  }, MCP_MENTION_SEARCH_TIMEOUT_MS) as (McpMentionSearchResult & { error?: string }) | null
  if (!reply || reply.error || !Array.isArray(reply.sources)) throw new Error(reply?.error ?? 'MCP mention search failed')
  return reply
}

/** The text of mentioned MCP resources, read through the session's servers as the desktop composer reads them. */
export async function requestMcpMentionRead(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  sessionId: string,
  targets: Array<{ server: string; uri: string }>,
): Promise<McpMentionReadResource[]> {
  const reply = await client.request({
    type: 'read_mcp_mentions', requestId: randomId(), projectPath, sessionId, targets,
  }, MCP_MENTION_SEARCH_TIMEOUT_MS) as { resources?: McpMentionReadResource[]; error?: string } | null
  if (!reply || reply.error || !Array.isArray(reply.resources)) throw new Error(reply?.error ?? 'MCP mention read failed')
  return reply.resources
}

/**
 * The agent-only block a send appends for the MCP resources `text` mentions, so the
 * model needs no tool round-trip and the bubble keeps what was sent for each chip.
 * Empty when nothing is mentioned or the read fails: the tags still name the resources.
 */
export async function mcpMentionContentForModel(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  sessionId: string,
  text: string,
): Promise<string> {
  const targets = mcpResourceTargets(text)
  if (!targets.length) return ''
  try {
    return formatMcpResourceReminder(await requestMcpMentionRead(client, projectPath, sessionId, targets))
  } catch {
    return ''
  }
}

const previews = createMcpMentionPreviewCache()

/** What sending would inline for one composer chip, read now as a send will. `null`: no answer. */
export function previewMcpMention(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  sessionId: string,
  value: string,
): Promise<McpMentionReadResource | null> {
  const target = parseMcpMentionValue(value)
  if (!target) return Promise.resolve(null)
  return previews(JSON.stringify([projectPath, sessionId, value]), () =>
    requestMcpMentionRead(client, projectPath, sessionId, [target]).then((resources) => resources[0] ?? null))
}
