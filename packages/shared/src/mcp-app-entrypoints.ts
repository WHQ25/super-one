import { mcpAppResourceUri, type McpAppIcon, type McpAppPresentation, type McpToolDescriptor } from './mcp-apps'
import { compactMcpAppPresentation, mcpAppPresentationIcon } from './mcp-apps-metadata'

export type McpAppEntrypointKind = 'global' | 'thread'
export type McpAppEntrypointHarness = 'claude' | 'codex'

export interface McpAppEntrypointDescriptor {
  key: string
  server: string
  tool: string
  title: string
  serverTitle?: string
  description?: string
  icon?: string
  icons?: McpAppPresentation['icons']
  resourceUri: string
  harness?: McpAppEntrypointHarness
  kinds?: McpAppEntrypointKind[]
}

export interface McpAppGlobalEntrypointsQuery {
  harness?: McpAppEntrypointHarness
  discover?: boolean
  forceRefresh?: boolean
}

export interface McpAppThreadEntrypointsResult {
  entrypoints: McpAppEntrypointDescriptor[]
  unavailable?: 'remote' | 'no-session'
  incomplete?: true
}

export interface McpAppGlobalEntrypointsResult {
  entrypoints: McpAppEntrypointDescriptor[]
  unavailable?: 'remote' | 'no-project'
  incomplete?: true
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

function rawEntrypoints(tool: McpToolDescriptor): Record<string, unknown>[] {
  if (!isRecord(tool._meta)) return []
  const list: Record<string, unknown>[] = []
  for (const ns of ['openai/ui', 'ui'] as const) {
    const ui = isRecord(tool._meta[ns]) ? tool._meta[ns] : undefined
    if (ui && Array.isArray(ui.entrypoints)) {
      for (const item of ui.entrypoints) if (isRecord(item)) list.push(item)
    }
  }
  return list
}

function parseEntrypointIcons(value: unknown): McpAppIcon[] | undefined {
  if (!Array.isArray(value)) return undefined
  const icons: McpAppIcon[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.src !== 'string' || !item.src.trim()) continue
    const theme = item.theme === 'light' || item.theme === 'dark' ? item.theme : undefined
    icons.push({ src: item.src, ...(theme ? { theme } : {}) })
  }
  return icons.length ? icons : undefined
}

function entrypointQuickActionFallback(tool: McpToolDescriptor): { title?: string; icons?: McpAppIcon[] } {
  for (const item of rawEntrypoints(tool)) {
    if (item.type !== 'global' && item.type !== 'thread') continue
    const quick = isRecord(item.quickAction) ? item.quickAction : undefined
    const candidateTitle = typeof quick?.title === 'string' && quick.title.trim()
      ? quick.title.trim()
      : (typeof item.title === 'string' && item.title.trim() ? item.title.trim() : undefined)
    const candidateIcons = parseEntrypointIcons(quick?.icons) ?? parseEntrypointIcons(item.icons)
    if (candidateTitle || candidateIcons) return { title: candidateTitle, icons: candidateIcons }
  }
  return {}
}

export function resolveMcpAppEntrypointHarness(provider: string | null | undefined): McpAppEntrypointHarness | null {
  return provider === 'claude' || provider === 'codex' ? provider : null
}

export function mcpAppEntrypointKinds(tool: McpToolDescriptor): McpAppEntrypointKind[] {
  if (!mcpAppResourceUri(tool)) return []
  const kinds = new Set<McpAppEntrypointKind>()
  for (const item of rawEntrypoints(tool)) {
    if (item.type === 'global' || item.type === 'thread') kinds.add(item.type)
  }
  return [...kinds]
}

export function hasMcpAppEntrypoint(tool: McpToolDescriptor, kind: McpAppEntrypointKind): boolean {
  return mcpAppEntrypointKinds(tool).includes(kind)
}

export function mcpAppEntrypointKey(harness: McpAppEntrypointHarness, server: string, tool: string): string {
  return JSON.stringify([harness, server, tool])
}

export function parseMcpAppEntrypointKey(key: string): { harness: McpAppEntrypointHarness; server: string; tool: string } | null {
  try {
    const parsed = JSON.parse(key)
    if (!Array.isArray(parsed) || parsed.length !== 3) return null
    const [harness, server, tool] = parsed
    if ((harness !== 'claude' && harness !== 'codex') || typeof server !== 'string' || !server || typeof tool !== 'string' || !tool) return null
    return { harness, server, tool }
  } catch {
    return null
  }
}

export function mcpAppThreadEntrypointKey(sessionId: string, server: string, tool: string): string {
  return JSON.stringify([sessionId, server, tool])
}

export function normalizeMcpAppEntrypointKinds(kinds?: readonly unknown[]): McpAppEntrypointKind[] {
  if (!Array.isArray(kinds) || kinds.length === 0) return ['global']
  const set = new Set<McpAppEntrypointKind>()
  for (const kind of kinds) {
    if (kind === 'global' || kind === 'thread') set.add(kind)
  }
  return set.size > 0 ? [...set] : ['global']
}

export function toMcpAppEntrypointDescriptor(input: {
  server: string
  tool: McpToolDescriptor
  harness?: McpAppEntrypointHarness
}): McpAppEntrypointDescriptor | null {
  const resourceUri = mcpAppResourceUri(input.tool)
  if (!resourceUri) return null
  const kinds = mcpAppEntrypointKinds(input.tool)
  const fallback = entrypointQuickActionFallback(input.tool)
  const rawTitle = (typeof input.tool.title === 'string' && input.tool.title.trim())
    || (typeof input.tool.annotations?.title === 'string' && input.tool.annotations.title.trim())
    || fallback.title
    || input.tool.name
  const presentation = compactMcpAppPresentation({
    toolTitle: rawTitle,
    toolIcons: input.tool.icons?.length ? input.tool.icons : fallback.icons,
    serverTitle: input.tool.serverInfo?.title,
    serverIcons: input.tool.serverInfo?.icons,
  })
  const icon = mcpAppPresentationIcon(presentation)
  const key = input.harness
    ? mcpAppEntrypointKey(input.harness, input.server, input.tool.name)
    : JSON.stringify([input.server, input.tool.name])
  const description = typeof input.tool.description === 'string' && input.tool.description.trim()
    ? input.tool.description.trim().split(/\r?\n/, 1)[0]!.slice(0, 160)
    : undefined
  return {
    key,
    server: input.server,
    tool: input.tool.name,
    title: presentation.toolTitle,
    ...(presentation.serverTitle ? { serverTitle: presentation.serverTitle } : {}),
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(presentation.icons?.length ? { icons: presentation.icons } : {}),
    resourceUri,
    ...(input.harness ? { harness: input.harness } : {}),
    ...(kinds.length ? { kinds } : {}),
  }
}

function mergeDescriptors(
  existing: McpAppEntrypointDescriptor,
  incoming: McpAppEntrypointDescriptor,
): McpAppEntrypointDescriptor {
  const unionKinds = normalizeMcpAppEntrypointKinds([
    ...normalizeMcpAppEntrypointKinds(existing.kinds),
    ...normalizeMcpAppEntrypointKinds(incoming.kinds),
  ])
  return {
    ...incoming,
    ...existing,
    harness: existing.harness ?? incoming.harness,
    kinds: unionKinds,
  }
}

export const MCP_APP_GLOBAL_SESSION_PREFIX = 'mcp-global:'

export function mcpAppStandaloneSessionId(
  harness: McpAppEntrypointHarness,
  projectPath: string,
): string {
  return `${MCP_APP_GLOBAL_SESSION_PREFIX}${harness}:${encodeURIComponent(projectPath || '')}`
}

export function parseMcpAppStandaloneSessionId(
  sessionId: string,
): { harness: McpAppEntrypointHarness; projectPath: string } | null {
  if (!sessionId.startsWith(MCP_APP_GLOBAL_SESSION_PREFIX)) return null
  const rest = sessionId.slice(MCP_APP_GLOBAL_SESSION_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon < 0) return null
  const harness = rest.slice(0, colon)
  if (harness !== 'claude' && harness !== 'codex') return null
  try {
    return { harness, projectPath: decodeURIComponent(rest.slice(colon + 1)) }
  } catch {
    return null
  }
}

function collapseSharedResourceEntrypoints(
  entrypoints: readonly McpAppEntrypointDescriptor[],
  preferredKind: McpAppEntrypointKind,
  scopeByHarness: boolean,
): McpAppEntrypointDescriptor[] {
  const byView = new Map<string, McpAppEntrypointDescriptor>()
  for (const item of entrypoints) {
    const viewKey = JSON.stringify([scopeByHarness ? (item.harness ?? '') : '', item.server, item.resourceUri, item.title])
    const prev = byView.get(viewKey)
    if (!prev) {
      byView.set(viewKey, item)
      continue
    }
    const prevPreferred = normalizeMcpAppEntrypointKinds(prev.kinds).includes(preferredKind)
    const nextPreferred = normalizeMcpAppEntrypointKinds(item.kinds).includes(preferredKind)
    if (!prevPreferred && nextPreferred) {
      byView.set(viewKey, item)
    }
  }
  return [...byView.values()]
}

export function sortMcpAppEntrypoints(
  entrypoints: readonly McpAppEntrypointDescriptor[],
): McpAppEntrypointDescriptor[] {
  return [...entrypoints].sort((a, b) => a.title.localeCompare(b.title))
}

export function filterMcpAppEntrypointsForContext(
  entrypoints: readonly McpAppEntrypointDescriptor[],
  context: {
    hasSession: boolean
    provider?: string | null
    isEmptyDraft?: boolean
  },
): McpAppEntrypointDescriptor[] {
  const byTool = new Map<string, McpAppEntrypointDescriptor>()
  const preferredKind: McpAppEntrypointKind = context.hasSession && !context.isEmptyDraft ? 'thread' : 'global'

  if (context.hasSession) {
    const harness = resolveMcpAppEntrypointHarness(context.provider)
    if (!harness) return []
    for (const item of entrypoints) {
      if (item.harness && item.harness !== harness) continue
      const kinds = normalizeMcpAppEntrypointKinds(item.kinds)
      if (!kinds.includes('global') && !kinds.includes('thread')) continue
      const normalized: McpAppEntrypointDescriptor = {
        ...item,
        harness,
        key: mcpAppEntrypointKey(harness, item.server, item.tool),
        kinds,
      }
      const dedupKey = JSON.stringify([item.server, item.tool])
      const prev = byTool.get(dedupKey)
      byTool.set(dedupKey, prev ? mergeDescriptors(prev, normalized) : normalized)
    }
    return sortMcpAppEntrypoints(collapseSharedResourceEntrypoints([...byTool.values()], preferredKind, true))
  }

  const targetHarness = context.provider ? resolveMcpAppEntrypointHarness(context.provider) : null
  if (context.provider && !targetHarness) return []
  for (const item of entrypoints) {
    if (targetHarness && item.harness && item.harness !== targetHarness) continue
    const kinds = normalizeMcpAppEntrypointKinds(item.kinds)
    if (!kinds.includes('global')) continue
    const normalized: McpAppEntrypointDescriptor = { ...item, kinds }
    const dedupKey = JSON.stringify([item.harness ?? '', item.server, item.tool])
    const prev = byTool.get(dedupKey)
    byTool.set(dedupKey, prev ? mergeDescriptors(prev, normalized) : normalized)
  }
  return sortMcpAppEntrypoints(collapseSharedResourceEntrypoints([...byTool.values()], preferredKind, Boolean(targetHarness)))
}
