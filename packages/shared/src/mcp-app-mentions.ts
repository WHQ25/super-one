/**
 * Composer @-mentions served by MCP servers (OpenAI `mentions/search` extension).
 *
 * The composer writes a picked item as a self-describing tag, so the model gets
 * the server and URI without a reminder block and can read the resource itself:
 *
 *   <superone-mcp-resource><server>bits</server><name>Hex bolt</name><uri>cad://parts/hex-bolt</uri></superone-mcp-resource>
 */

import type { McpToolDescriptor } from './mcp-apps'
import { mcpAppIcon } from './mcp-apps-metadata'

/** Longest query sent to a server; the composer never needs more for a typeahead. */
export const MCP_MENTION_QUERY_MAX_CHARS = 200
/** Items kept per server, whatever the server returns. */
export const MCP_MENTION_ITEMS_MAX = 50
const TEXT_MAX_CHARS = 300

export interface McpMentionItem {
  uri: string
  /** `title`, then `name`. */
  label: string
  /** Secondary line: description / subtitle, or the name when the label is a title. */
  detail?: string
  icon?: string
}

/** One server's `mentions/search` tool and what it answered. */
export interface McpMentionSource {
  server: string
  tool: string
  /** Server title, else the configured server name. */
  title: string
  icon?: string
  items: McpMentionItem[]
  /** The call failed or returned an error result. */
  failed?: true
}

/**
 * `unavailable: 'remote'` — remote projects are not searched yet.
 * `incomplete` — some server did not answer in time (still starting, down, signed out).
 */
export interface McpMentionSearchResult { sources: McpMentionSource[]; unavailable?: 'remote'; incomplete?: true }

/** What a composer's `@` popup shows for the session's servers while the user types. */
export interface McpMentionSearchState {
  /** One section per server tool. While a query is in flight they keep the previous items. */
  sources: McpMentionSource[]
  loading: boolean
  /** Some server did not answer; more may appear on a later keystroke. */
  incomplete: boolean
  /** The lookup itself failed (no per-server answer): an older host, the relay, a closed session. */
  failed: boolean
}

export const MCP_MENTION_SEARCH_IDLE: McpMentionSearchState = { sources: [], loading: false, incomplete: false, failed: false }

/** Something the popup must stay open for even with no selectable rows. */
export function mcpMentionHasStatus(state: McpMentionSearchState): boolean {
  return state.failed || state.incomplete || state.sources.some(source => source.failed || (state.loading && !source.items.length))
}

const withoutItems = (sources: McpMentionSource[]) => sources.map(source => ({ ...source, items: [] }))

/**
 * Sections the last complete answer for a session (`key`) had, without items, so a
 * new popup shows them as searching at once rather than popping them in later.
 */
const knownSources = new Map<string, McpMentionSource[]>()

/** A query went out: keep what is on screen, else the sections this session had last time. */
export function mcpMentionSearchStarted(key: string, previous: McpMentionSearchState): McpMentionSearchState {
  return { sources: previous.sources.length ? previous.sources : withoutItems(knownSources.get(key) ?? []), loading: true, incomplete: false, failed: false }
}

export function mcpMentionSearchAnswered(key: string, { sources, incomplete }: McpMentionSearchResult): McpMentionSearchState {
  // Only a complete answer says which servers search; an incomplete one may be missing some.
  if (!incomplete) knownSources.set(key, withoutItems(sources))
  return { sources, loading: false, incomplete: !!incomplete, failed: false }
}

export function mcpMentionSearchFailed(previous: McpMentionSearchState): McpMentionSearchState {
  return { sources: withoutItems(previous.sources), loading: false, incomplete: false, failed: true }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, TEXT_MAX_CHARS) : undefined
}

/** The spec requires `app` visibility; the call is host-originated, so model visibility does not matter. */
export function isMcpMentionSearchTool(tool: McpToolDescriptor): boolean {
  const extensions = record(tool._meta?.['openai/extensions'])
  return !!extensions && 'mentions/search' in extensions && (tool._meta?.ui?.visibility?.includes('app') ?? false)
}

/**
 * Items from a `mentions/search` result: MCP resource links, and OpenAI's
 * `{ type: 'resource', resourceUri, title, subtitle? }`. Anything else is dropped.
 */
export function mcpMentionItems(structuredContent: unknown): McpMentionItem[] {
  const items = record(structuredContent)?.items
  if (!Array.isArray(items)) return []
  const output: McpMentionItem[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const item = record(raw)
    if (!item) continue
    const link = item.type === 'resource_link'
    const uri = text(link ? item.uri : item.type === 'resource' ? item.resourceUri : undefined)
    if (!uri || seen.has(uri)) continue
    const title = text(item.title)
    const name = link ? text(item.name) : undefined
    const label = title ?? name
    if (!label) continue
    seen.add(uri)
    const detail = text(link ? item.description : item.subtitle) ?? (title && name !== title ? name : undefined)
    const icon = mcpAppIcon(Array.isArray(item.icons) ? item.icons : undefined)
    output.push({ uri, label, ...(detail ? { detail } : {}), ...(icon ? { icon } : {}) })
    if (output.length >= MCP_MENTION_ITEMS_MAX) break
  }
  return output
}

/** One popup section per server tool: `mcp:<server>/<tool>`. */
export const mcpMentionGroupKey = (source: Pick<McpMentionSource, 'server' | 'tool'>): `mcp:${string}` => `mcp:${source.server}/${source.tool}`

/**
 * Where the query occurs in an item's label or detail, for highlighting. The server already
 * matched however it likes, so a miss only means nothing is highlighted.
 */
export function mcpMentionMatchIndices(text: string, query: string): number[] {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  return at < 0 ? [] : Array.from({ length: query.length }, (_, index) => at + index)
}

/** Chip value: `<server>:<uri>`, the server percent-encoded so the first `:` splits. */
export function encodeMcpMentionValue(server: string, uri: string): string {
  return `${encodeURIComponent(server)}:${uri}`
}

export function parseMcpMentionValue(value: string): { server: string; uri: string } | null {
  const split = value.indexOf(':')
  if (split <= 0 || split === value.length - 1) return null
  try {
    return { server: decodeURIComponent(value.slice(0, split)), uri: value.slice(split + 1) }
  } catch {
    return null
  }
}

const escapeTagText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescapeTagText = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Groups are server, name, uri (escaped). */
export const MCP_RESOURCE_TAG_REGEX =
  /<superone-mcp-resource>\s*<server>([\s\S]*?)<\/server>\s*<name>([\s\S]*?)<\/name>\s*<uri>([\s\S]*?)<\/uri>\s*<\/superone-mcp-resource>/g

/** `value` is the chip value; a malformed one is written as text, never as a tag. */
export function wrapMcpResourceMention(value: string, displayName: string): string {
  const parsed = parseMcpMentionValue(value)
  const name = displayName.trim()
  if (!parsed) return `@${name || value}`
  return `<superone-mcp-resource><server>${escapeTagText(parsed.server)}</server><name>${escapeTagText(name || parsed.uri)}</name><uri>${escapeTagText(parsed.uri)}</uri></superone-mcp-resource>`
}

/** Chip value and label recovered from a tag match. */
export function mcpResourceTagMention(server: string, name: string, uri: string): { value: string; displayName: string } {
  return { value: encodeMcpMentionValue(unescapeTagText(server).trim(), unescapeTagText(uri).trim()), displayName: unescapeTagText(name).trim() }
}

/** Mentions read per message; the rest keep their tag, which still names the resource. */
export const MCP_MENTION_READ_MAX = 20

/** What a message's MCP resource tags name, in order, at most `MCP_MENTION_READ_MAX`. */
export function mcpResourceTargets(text: string): Array<{ server: string; uri: string }> {
  return [...text.matchAll(MCP_RESOURCE_TAG_REGEX)].flatMap(([, server, name, uri]) => {
    const target = parseMcpMentionValue(mcpResourceTagMention(server, name, uri).value)
    return target ? [target] : []
  }).slice(0, MCP_MENTION_READ_MAX)
}

/** Text of one mentioned resource inlined for the model; larger text is cut and says so. */
export const MCP_MENTION_INLINE_MAX_CHARS = 20_000
/** All mentioned resources of one message together. */
export const MCP_MENTION_INLINE_TOTAL_MAX_CHARS = 60_000

/**
 * A mentioned resource as read at send time. `skipped` resources are not inlined
 * (binary, unreadable, over the total budget); the model still has their link.
 */
export interface McpMentionReadResource {
  server: string
  uri: string
  mimeType?: string
  text?: string
  truncated?: true
  skipped?: 'binary' | 'failed' | 'budget'
}

export const MCP_RESOURCE_REMINDER_REGEX = /\n*<superone-mcp-resource-content>[\s\S]*?<\/superone-mcp-resource-content>\n*/g

const quoteAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
/** Server text must not close the wrapper early: the bubble strips it by its closing tag. */
const neutralize = (text: string) => text.replace(/<\/(superone-mcp-resource-content|resource)\b/gi, '<\\/$1')

/** Agent-only block with the mentioned resources' text; empty when nothing was read. */
export function formatMcpResourceReminder(resources: McpMentionReadResource[]): string {
  const read = resources.filter(resource => resource.text !== undefined)
  if (!read.length) return ''
  const blocks = read.map(resource => {
    const attrs = `server="${quoteAttr(resource.server)}" uri="${quoteAttr(resource.uri)}"${resource.mimeType ? ` mimeType="${quoteAttr(resource.mimeType)}"` : ''}`
    const note = resource.truncated ? `\n[Truncated at ${MCP_MENTION_INLINE_MAX_CHARS} characters; read the resource for the rest.]` : ''
    return `<resource ${attrs}>\n${neutralize(resource.text!)}${note}\n</resource>`
  })
  return `\n\n<superone-mcp-resource-content>\nThe user @-mentioned these MCP resources. SuperOne already read them for you; do not read them again unless you need content marked as truncated.\n${blocks.join('\n')}\n</superone-mcp-resource-content>`
}

const RESOURCE_ENTRY_REGEX = /<resource server="([^"]*)" uri="([^"]*)"(?: mimeType="([^"]*)")?>\n([\s\S]*?)\n<\/resource>/g
const TRUNCATION_NOTE = /\n\[Truncated at \d+ characters; read the resource for the rest\.\]$/
const unquoteAttr = (value: string) => value.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** Opening a chip again within this window reuses the read; sending always reads afresh. */
const MCP_MENTION_PREVIEW_TTL_MS = 30_000

/**
 * A composer chip's preview reads, kept briefly per `key` (scope and chip value). A read
 * that found nothing is dropped at once: the next look may find the server up.
 */
export function createMcpMentionPreviewCache(now: () => number = Date.now) {
  const previews = new Map<string, { at: number; read: Promise<McpMentionReadResource | null> }>()
  return (key: string, read: () => Promise<McpMentionReadResource | null>): Promise<McpMentionReadResource | null> => {
    const cached = previews.get(key)
    if (cached && now() - cached.at < MCP_MENTION_PREVIEW_TTL_MS) return cached.read
    const next = read()
    previews.set(key, { at: now(), read: next })
    void next.then((resource) => { if (!resource || resource.skipped === 'failed') previews.delete(key) }, () => previews.delete(key))
    return next
  }
}

/** A chip card's read: `loading`/`failed` only while a composer chip previews. */
export type McpMentionCardState = { status: 'loading' } | { status: 'failed' } | { status: 'read'; resource?: McpMentionReadResource }

/** A preview read as a card state: no answer, or a read the server refused, is a failure. */
export function mcpMentionPreviewState(resource: McpMentionReadResource | null): McpMentionCardState {
  return resource && resource.skipped !== 'failed' ? { status: 'read', resource } : { status: 'failed' }
}

/**
 * The line a chip card shows: what a sent chip carried, or what sending will inline.
 * `count` is the characters inlined (the cap when truncated).
 */
export function mcpMentionCardStatus(state: McpMentionCardState): { line: 'loading' | 'failed' | 'content' | 'truncated' | 'linkOnly'; count: number } {
  if (state.status !== 'read') return { line: state.status, count: 0 }
  const text = state.resource?.text
  if (text === undefined) return { line: 'linkOnly', count: 0 }
  return state.resource?.truncated ? { line: 'truncated', count: MCP_MENTION_INLINE_MAX_CHARS } : { line: 'content', count: text.length }
}

/**
 * What a message's content block gave the model, keyed by `encodeMcpMentionValue`,
 * so a chip can show exactly what was sent for it. Inverse of `formatMcpResourceReminder`.
 */
export function parseMcpResourceReminder(text: string): Map<string, McpMentionReadResource> {
  const output = new Map<string, McpMentionReadResource>()
  for (const [block] of text.matchAll(MCP_RESOURCE_REMINDER_REGEX)) {
    for (const [, server, uri, mimeType, body] of block.matchAll(RESOURCE_ENTRY_REGEX)) {
      const truncated = TRUNCATION_NOTE.test(body)
      const content = body.replace(TRUNCATION_NOTE, '').replace(/<\\\/(superone-mcp-resource-content|resource)\b/gi, '</$1')
      const resource = { server: unquoteAttr(server), uri: unquoteAttr(uri) }
      output.set(encodeMcpMentionValue(resource.server, resource.uri), {
        ...resource, ...(mimeType ? { mimeType: unquoteAttr(mimeType) } : {}), text: content, ...(truncated ? { truncated: true as const } : {}),
      })
    }
  }
  return output
}

/** User-visible collapse: `@Hex bolt`. */
export function replaceMcpResourceTagsWithMention(text: string): string {
  return text.replace(MCP_RESOURCE_REMINDER_REGEX, '').replace(MCP_RESOURCE_TAG_REGEX, (_full, _server, name) => `@${unescapeTagText(String(name)).trim()}`)
}
