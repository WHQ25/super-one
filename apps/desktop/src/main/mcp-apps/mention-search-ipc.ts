import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { McpAppsError } from '@superone/shared/mcp-apps'
import {
  MCP_MENTION_INLINE_MAX_CHARS, MCP_MENTION_INLINE_TOTAL_MAX_CHARS, MCP_MENTION_QUERY_MAX_CHARS, MCP_MENTION_READ_MAX, isMcpMentionSearchTool, mcpMentionItems,
  type McpMentionReadResource, type McpMentionSearchResult, type McpMentionSource,
} from '@superone/shared/mcp-app-mentions'
import { mcpAppIcon, mcpAppPresentation, mcpAppPresentationIcon } from '@superone/shared/mcp-apps-metadata'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'
import { assertHostRenderer, findHostTools, hostProvider, hostRpcFailure, hostSessionResolver, untilAborted, type HostToolCandidate } from './host-tools'

async function searchSource(session: Session, { binding, origin, tool }: HostToolCandidate, query: string, signal: AbortSignal): Promise<McpMentionSource> {
  const presentation = mcpAppPresentation(tool)
  const icon = mcpAppIcon(tool.serverInfo?.icons) ?? mcpAppPresentationIcon(presentation)
  const source: McpMentionSource = { server: binding.server, tool: tool.name, title: presentation.serverTitle ?? binding.server, ...(icon ? { icon } : {}), items: [] }
  try {
    const provider = await hostProvider(session, binding, origin, signal)
    try {
      const { result } = await untilAborted(provider.callTool({ tool: tool.name, args: { query }, origin }, signal), signal)
      return result.isError ? { ...source, failed: true } : { ...source, items: mcpMentionItems(result.structuredContent) }
    } finally { provider.dispose() }
  } catch {
    return { ...source, failed: true }
  }
}

/** Text contents of one resource, cut to the per-resource cap; binary-only resources are not inlined. */
async function readMention(session: Session, bindings: Array<Omit<HostToolCandidate, 'tool'>>, target: { server: string; uri: string }, signal: AbortSignal): Promise<McpMentionReadResource> {
  const base = { server: target.server, uri: target.uri }
  const bound = bindings.find(({ binding }) => binding.server === target.server)
  if (!bound) return { ...base, skipped: 'failed' }
  try {
    const provider = await hostProvider(session, bound.binding, bound.origin, signal)
    try {
      // `transient`: any resource of the server, not only `ui://` documents; never persisted as App state.
      const { contents } = await untilAborted(provider.readResource({ uri: target.uri, origin: bound.origin, transient: true }, signal), signal)
      const texts = contents.filter(content => typeof content.text === 'string')
      if (!texts.length) return { ...base, skipped: contents.length ? 'binary' : 'failed' }
      const text = texts.map(content => content.text!).join('\n\n')
      const mimeType = texts[0].mimeType
      return { ...base, ...(mimeType ? { mimeType } : {}), text: text.slice(0, MCP_MENTION_INLINE_MAX_CHARS), ...(text.length > MCP_MENTION_INLINE_MAX_CHARS ? { truncated: true as const } : {}) }
    } finally { provider.dispose() }
  } catch {
    return { ...base, skipped: 'failed' }
  }
}

/**
 * Composer @-mention search: every server tool that declares `mentions/search`, asked in parallel.
 * The desktop composer and paired devices both search through here.
 */
export async function searchMcpMentions(session: Session | null, projectPath: string, query: string): Promise<McpMentionSearchResult> {
  if (parseRemoteProjectKey(projectPath)) return { sources: [], unavailable: 'remote' }
  if (!session || !(await session.getMcpAppsHostBindings?.({ start: true }))?.length) return { sources: [] }
  const signal = AbortSignal.timeout(15_000)
  const { candidates, incomplete } = await findHostTools(session, isMcpMentionSearchTool, signal)
  const text = typeof query === 'string' ? query.slice(0, MCP_MENTION_QUERY_MAX_CHARS) : ''
  const sources = await Promise.all(candidates.map(candidate => searchSource(session, candidate, text, signal)))
  return { sources, ...(incomplete ? { incomplete: true as const } : {}) }
}

/**
 * At send: the mentioned resources' text, so the model needs no tool round-trip to read them;
 * and a chip's preview of it. `targets` comes from the renderer or a paired device, so it is checked here.
 */
export async function readMcpMentions(session: Session | null, projectPath: string, targets: Array<{ server: string; uri: string }>): Promise<McpMentionReadResource[]> {
  if (!Array.isArray(targets) || targets.length > MCP_MENTION_READ_MAX || targets.some(target => typeof target?.server !== 'string' || typeof target.uri !== 'string')) throw new McpAppsError('invalid', 'Invalid mention read request')
  const unique = targets.filter((target, index) => targets.findIndex(other => other.server === target.server && other.uri === target.uri) === index)
  const bindings = parseRemoteProjectKey(projectPath) ? [] : (await session?.getMcpAppsHostBindings?.({ start: true })) ?? []
  if (!session || !bindings.length) return unique.map(target => ({ ...target, skipped: 'failed' as const }))
  const signal = AbortSignal.timeout(15_000)
  const read = await Promise.all(unique.map(target => readMention(session, bindings, target, signal)))
  // Message order decides who gets the shared budget.
  let budget = MCP_MENTION_INLINE_TOTAL_MAX_CHARS
  return read.map(resource => {
    if (resource.text === undefined) return resource
    if (resource.text.length > budget) return { server: resource.server, uri: resource.uri, skipped: 'budget' as const }
    budget -= resource.text.length
    return resource
  })
}

/** Typing `@` is a user action, so it may load the session and start its harness. */
export function registerMcpAppMentionIpc(getSession: (id: string) => Session | null, resumeSession: (id: string) => Session): void {
  const sessionFor = hostSessionResolver(getSession, resumeSession)

  ipcMain.handle(AgentIpcChannels.MCP_APP_MENTION_SEARCH, async (event, projectPath: string, sessionId: string, query: string): Promise<McpAppsRpcResult<McpMentionSearchResult>> => {
    try {
      assertHostRenderer(event)
      return { ok: true, value: await searchMcpMentions(parseRemoteProjectKey(projectPath) ? null : sessionFor(sessionId, false), projectPath, query) }
    } catch (error) { return hostRpcFailure(error) }
  })

  ipcMain.handle(AgentIpcChannels.MCP_APP_MENTION_READ, async (event, projectPath: string, sessionId: string, targets: Array<{ server: string; uri: string }>): Promise<McpAppsRpcResult<McpMentionReadResource[]>> => {
    try {
      assertHostRenderer(event)
      return { ok: true, value: await readMcpMentions(parseRemoteProjectKey(projectPath) ? null : sessionFor(sessionId, false), projectPath, targets) }
    } catch (error) { return hostRpcFailure(error) }
  })
}
