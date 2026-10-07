import { encode } from '@toon-format/toon'
import { hasAllScopes, OPERATION_SCOPES } from '@superone/shared/environment'
import { sessionMessageBlocksToChatMessages } from '@superone/shared/node-message-catalog'
import { normalizeSessionTagList } from '@superone/shared/session-tags'
import type { ChatMessage } from '@superone/shared/agent-types'
import { isSessionArchiveReadTool, type ArchiveToolResult, type SessionArchiveRequest } from '@superone/shared/session-archive'
import { countTools, extractToolIndex, findToolDetail, formatTextMessages, formatToolIndex, messageSearchText, pageItems } from '@superone/shared/session-transcript-view'
import type { SessionLinkMetadataResult } from '@superone/shared/session-link'
import type { RpcContext, RpcResult } from './handlers'
import type { NodeSessionRecord } from '../session/session-runtime'

const result = (value: unknown, isError = false): ArchiveToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })
const table = (value: unknown) => result(encode(value))
const limit = (value: unknown, fallback = 20) => typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(50, Math.floor(value))) : fallback
const date = (value: number) => new Date(value).toISOString()
const lastActive = (session: Readonly<NodeSessionRecord>) => session.transcript.findLast(block => block.role === 'user')?.createdAt ?? session.createdAt

function branding(session: Readonly<NodeSessionRecord>, ctx: RpcContext) {
  const config = ctx.sessionProviders?.get(session.providerId)?.config as { agentId?: string } | undefined
  return { harness: session.harnessId, acpAgentId: session.harnessId === 'acp' ? config?.agentId ?? null : null }
}
function entry(session: Readonly<NodeSessionRecord>, ctx: RpcContext, source?: string) {
  return { sessionId: session.sessionId, title: session.title ?? 'Untitled', ...branding(session, ctx), projectId: session.projectId, createdAt: date(session.createdAt), lastActiveAt: date(lastActive(session)), messageCount: session.transcript.length, tags: session.tags ?? [], pinned: session.isPinned, hidden: session.isHidden, isSelf: session.sessionId === source }
}
export function dispatchSessionArchiveRpc(method: string, payload: unknown, ctx: RpcContext): RpcResult | null {
  if (method !== 'session.archive' && method !== 'session.linkMetadata' && method !== 'session.linkBootstrap') return null
  if (!hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.readSession)) return { error: { code: 'forbidden', message: 'Session read access is required' } }
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  if (method === 'session.linkBootstrap') {
    const sessionId = String(input.sessionId ?? '')
    const snapshot = ctx.sessions.get(sessionId)
    if (!snapshot || snapshot.isHidden) return { error: { code: 'not_found', message: 'Session unavailable' } }
    // No await between snapshot, catalog and high-water: one consistent baseline.
    return { result: { snapshot: { ...snapshot, acpAgentId: branding(snapshot, ctx).acpAgentId }, page: ctx.sessions.listMessages({ sessionId, limit: 8 }), sequence: ctx.sessions.snapshotSequence() } }
  }
  if (method === 'session.linkMetadata') {
    if (!Array.isArray(input.sessionIds) || input.sessionIds.length > 50 || input.sessionIds.some(id => typeof id !== 'string')) return { error: { code: 'invalid_argument', message: 'At most 50 session IDs are allowed' } }
    const wanted = new Set(input.sessionIds as string[])
    const rows = new Map([...ctx.sessions.archiveEntries()].filter(row => wanted.has(row.sessionId) && !row.isHidden).map(row => [row.sessionId, row]))
    const results: SessionLinkMetadataResult[] = (input.sessionIds as string[]).map(sessionId => {
      const ref = { environmentId: ctx.identity.environmentId, sessionId }
      const row = rows.get(sessionId)
      return row ? { status: 'ok', metadata: { ref, ...branding(row, ctx) } } : { status: 'unavailable', ref }
    })
    return { result: results }
  }
  if (!isSessionArchiveReadTool(String(input.tool))) return { error: { code: 'invalid_argument', message: 'Unsupported archive read tool' } }
  return { result: readArchive(input as unknown as SessionArchiveRequest, ctx) }
}

function readArchive(request: SessionArchiveRequest, ctx: RpcContext): ArchiveToolResult {
  const args = request.args ?? {}
  if (args.environmentId != null && args.environmentId !== 'localhost' && args.environmentId !== ctx.identity.environmentId) return result({ status: 'error', message: 'Environment mismatch' }, true)
  const all = [...ctx.sessions.archiveEntries()]
  const source = all.find(row => row.sessionId === request.sourceSessionId)
  const environmentId = typeof args.environmentId === 'string' ? args.environmentId : ctx.identity.environmentId
  if (request.tool === 'session_read') {
    const session = all.find(row => row.sessionId === args.sessionId && !row.isHidden)
    if (!session) return result({ status: 'error', message: 'Session not found' }, true)
    const header = { status: 'ok', environmentId, ...entry(session, ctx, request.sourceSessionId) }
    const view = String(args.view ?? 'text')
    if (!['meta', 'text', 'user', 'assistant', 'tools', 'tool_detail'].includes(view)) return result({ status: 'error', message: 'Invalid transcript view' }, true)
    if (view === 'meta') return result({ ...header, view })
    let cursor: number | null = null
    const catalog: ChatMessage[] = []
    do {
      const page = ctx.sessions.listMessages({ sessionId: session.sessionId, cursor, limit: 100 })
      catalog.unshift(...sessionMessageBlocksToChatMessages(page.messages, session.providerId))
      cursor = page.hasMore ? Number(page.cursor) : null
    } while (cursor != null)
    const messages = catalog
    if (view === 'tools' || view === 'tool_detail') {
      if (view === 'tool_detail') {
        const tool = findToolDetail(catalog, String(args.toolUseId ?? ''))
        return tool ? result({ status: 'ok', environmentId, view, sessionId: session.sessionId, tool }) : result({ status: 'error', message: 'Tool use not found' }, true)
      }
      const page = pageItems(catalog.filter(message => countTools(message) > 0), { limit: limit(args.limit), cursor: args.cursor as number | null, messageId: args.messageId as string, around: args.around as number })
      return result(`# Session ${session.sessionId} — tools\nenvironmentId: ${environmentId}\ntitle: ${header.title} · harness: ${header.harness}\ncursor: ${page.cursor} · hasMore: ${page.hasMore}\n\n${formatToolIndex(page.items.flatMap(extractToolIndex))}`)
    }
    const filtered = view === 'user' || view === 'assistant' ? messages.filter(message => message.role === view) : messages
    const page = pageItems(args.messageId ? messages : filtered, { limit: limit(args.limit), cursor: args.cursor as number | null, messageId: args.messageId as string, around: args.around as number })
    const body = args.messageId && (view === 'user' || view === 'assistant') ? page.items.filter(message => message.role === view) : page.items
    return result(`# Session ${session.sessionId} — ${view}\nenvironmentId: ${environmentId}\ntitle: ${header.title} · harness: ${header.harness} · messages: ${messages.length}\npage: ${body.length} · cursor: ${page.cursor} · hasMore: ${page.hasMore} · totalInView: ${filtered.length}\n\n${formatTextMessages(body, { includeThinking: args.includeThinking === true, withToolCount: true })}`)
  }
  if (request.tool === 'project_list') {
    const query = String(args.query ?? '').toLowerCase()
    const rows = ctx.projects.list().filter(project => !query || `${project.path} ${project.name}`.toLowerCase().includes(query))
    const offset = Math.max(0, Number(args.offset) || 0)
    const projects = rows.slice(offset, offset + limit(args.limit, 50)).map(row => ({ id: row.projectId, name: row.name, path: row.path, ...(row.projectId === source?.projectId ? { isCurrent: true } : {}) }))
    return table({ environmentId, offset, count: projects.length, total: rows.length, projects })
  }
  if (args.projectId && args.allProjects) return result({ status: 'error', message: 'Pass either projectId or allProjects, not both' }, true)
  const projectId = typeof args.projectId === 'string' ? args.projectId : args.allProjects === true ? null : source?.projectId
  if (!projectId && args.allProjects !== true) return result({ status: 'error', message: 'Pass projectId or allProjects: true for this environment' }, true)
  if (projectId && !ctx.projects.get(projectId)) return result({ status: 'error', message: 'Project not found in this environment' }, true)
  const parsedTags = normalizeSessionTagList(args.tags ?? [])
  if ('error' in parsedTags) return result({ status: 'error', message: parsedTags.error }, true)
  const tags = parsedTags.tags
  if (args.tagMatch != null && args.tagMatch !== 'any' && args.tagMatch !== 'all') return result({ status: 'error', message: 'tagMatch must be any or all' }, true)
  const rows = all.filter(row => (!projectId || row.projectId === projectId) && (!row.isHidden || (request.tool === 'session_list' && args.includeHidden === true)) && (!args.harness || row.harnessId === args.harness) && (!tags.length || (args.tagMatch === 'all' ? tags.every(tag => row.tags?.includes(tag)) : tags.some(tag => row.tags?.includes(tag)))))
  const scope = { environmentId, allProjects: !projectId, ...(projectId ? { projectId } : {}) }
  if (request.tool === 'session_list') {
    const query = String(args.query ?? '').toLowerCase()
    const selected = rows.filter(row => (!args.parentOnly || !ctx.collaboration.isSpawnChild(row.sessionId)) && (!query || (row.title ?? '').toLowerCase().includes(query)) && (!args.includePinnedOnly || row.isPinned) && (!args.olderThan || date(lastActive(row)) < String(args.olderThan)) && (!args.newerThan || date(lastActive(row)) > String(args.newerThan)))
    const order = String(args.order ?? 'last_active_desc')
    const values: Record<string, (row: Readonly<NodeSessionRecord>) => number> = { last_active: lastActive, created: row => row.createdAt, message_count: row => row.transcript.length, size: row => JSON.stringify(row.transcript).length }
    const field = order.replace(/_(asc|desc)$/, '')
    if (!/_(asc|desc)$/.test(order) || !values[field]) return result({ status: 'error', message: 'Invalid list order' }, true)
    const sortValue = new Map(selected.map(row => [row.sessionId, values[field](row)]))
    selected.sort((a, b) => (sortValue.get(a.sessionId)! - sortValue.get(b.sessionId)!) * (order.endsWith('_asc') ? 1 : -1) || a.sessionId.localeCompare(b.sessionId))
    const offset = Math.max(0, Number(args.offset) || 0)
    const sessions = selected.slice(offset, offset + limit(args.limit)).map(row => (({ sessionId, ...metadata }) => ({ id: sessionId, ...metadata, ...(field === 'size' ? { sizeBytes: sortValue.get(row.sessionId) } : {}) }))(entry(row, ctx, request.sourceSessionId)))
    return table({ ...scope, offset, count: sessions.length, sessions })
  }
  const query = String(args.query ?? '').trim()
  if (!query) return result({ status: 'error', message: 'query is required' }, true)
  const terms = query.toLowerCase().split(/\s+/)
  const scanLimit = projectId ? 500 : 2000
  const prefilter: Array<{ session: Readonly<NodeSessionRecord>; message: ChatMessage }> = []
  // Keep only the newest candidate window, rather than materializing every transcript.
  for (const session of rows) {
    if (Array.isArray(args.sessionIds) && !args.sessionIds.includes(session.sessionId)) continue
    for (const block of session.transcript) {
      if (block.role === 'system' || !`${session.title ?? ''}\n${block.text}`.toLowerCase().includes(terms[0])) continue
      const message: ChatMessage = { id: block.id, role: block.role, status: 'complete', content: block.userMessageContent ?? [{ type: 'text', text: block.text }], createdAt: date(block.createdAt), providerId: session.providerId }
      let low = 0, high = prefilter.length
      while (low < high) { const mid = (low + high) >>> 1; if (prefilter[mid].message.createdAt > message.createdAt) low = mid + 1; else high = mid }
      if (low < scanLimit) { prefilter.splice(low, 0, { session, message }); if (prefilter.length > scanLimit) prefilter.pop() }
    }
  }
  const hits = prefilter.filter(({ session, message }) => (args.role == null || args.role === 'any' || message.role === args.role) && terms.every(term => `${session.title ?? ''}\n${messageSearchText(message)}`.toLowerCase().includes(term))).slice(0, limit(args.limit)).map(({ session, message }) => {
    const text = messageSearchText(message) || session.title || ''
    const start = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 60)
    return { sessionId: session.sessionId, title: session.title ?? 'Untitled', ...branding(session, ctx), projectId: session.projectId, messageId: message.id, role: message.role, createdAt: message.createdAt, snippet: text.slice(start, start + 200).replace(/\s+/g, ' '), tags: session.tags ?? [] }
  })
  return table({ ...scope, query, count: hits.length, ...(prefilter.length >= (projectId ? 500 : 2000) && hits.length < limit(args.limit) ? { truncated: true } : {}), hits })
}
