export type McpResourceAction = 'list' | 'read'

export interface ListedMcpResource {
  uri: string
  name: string
  mimeType?: string
  description?: string
}

export interface McpResourceInfo {
  action: McpResourceAction
  server: string
  uri: string
  resources: ListedMcpResource[]
  emptyList: boolean
  contentText?: string
  mimeType?: string
  offloadedPath?: string
  mediaSummary?: string
  skippedBinary: boolean
  errorMessage?: string
  extraText?: string
  hasPlaceholderResult: boolean
  raw: string
}

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const STEP_ERROR_PREFIX_RE = /^Encountered error in step execution:\s*/i
const NO_RESOURCES_RE = /^No resources(?: found)?\.?$/i
const RESOURCE_HEADER_RE = /^Resource\s*\(([^)]+)\):\r?\n([\s\S]*)$/
const MEDIA_CONTENT_RE = /^Media content:\s*([^\r\n]+)(?:\r?\n([\s\S]*))?$/i
const OFFLOADED_RE = /\[Resource offloaded to\s+([^\]]+)\]/i
const SKIPPED_BINARY_RE = /skipped[_\s-]non[_\s-]image[_\s-]binary|binary content omitted/i

const LIST_TOOL_NAMES = new Set(['ListMcpResources', 'list_resources', 'list_mcp_resources'])
const READ_TOOL_NAMES = new Set(['ReadMcpResource', 'read_resource', 'read_mcp_resource'])

export function isMcpResourceToolName(toolName: string | undefined | null): boolean {
  return Boolean(toolName && (LIST_TOOL_NAMES.has(toolName) || READ_TOOL_NAMES.has(toolName)))
}

export function resolveMcpResourceAction(toolName: string): McpResourceAction {
  return READ_TOOL_NAMES.has(toolName) ? 'read' : 'list'
}

function unwrapStr(val: unknown): string {
  if (typeof val !== 'string') return ''
  const trimmed = val.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed.trim()
    } catch {
      void 0
    }
  }
  return trimmed
}

function parseResourceObject(item: unknown): ListedMcpResource | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const obj = item as Record<string, unknown>
  const uri = typeof obj.uri === 'string' ? obj.uri.trim() : ''
  const rawName =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim()
      : typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim()
        : ''
  if (!uri && !rawName) return null
  const mimeType =
    typeof obj.mimeType === 'string' && obj.mimeType.trim()
      ? obj.mimeType.trim()
      : typeof obj.mime_type === 'string' && obj.mime_type.trim()
        ? obj.mime_type.trim()
        : undefined
  const description =
    typeof obj.description === 'string' && obj.description.trim()
      ? obj.description.trim()
      : undefined
  return {
    uri: uri || rawName,
    name: rawName || uri,
    ...(mimeType ? { mimeType } : {}),
    ...(description ? { description } : {}),
  }
}

function parseResourcesFromText(text: string): { resources: ListedMcpResource[]; matched: boolean } {
  const trimmed = text.trim()
  if (!trimmed) return { resources: [], matched: false }
  if (NO_RESOURCES_RE.test(trimmed)) return { resources: [], matched: true }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).resources)
          ? ((parsed as Record<string, unknown>).resources as unknown[])
          : null
      if (arr) {
        const out: ListedMcpResource[] = []
        for (const entry of arr) {
          const item = parseResourceObject(entry)
          if (item) out.push(item)
        }
        return { resources: out, matched: true }
      }
    } catch {
      void 0
    }
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const bulletItems: ListedMcpResource[] = []
  for (const line of lines) {
    if (/^(?:Available\s+)?resources(?:\s+from\s+\S+)?:/i.test(line)) continue
    const mdLink = /^[-*]\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*[-:–]\s*(.+))?$/.exec(line)
    if (mdLink) {
      bulletItems.push({
        name: mdLink[1]!.trim(),
        uri: mdLink[2]!.trim(),
        ...(mdLink[3]?.trim() ? { description: mdLink[3].trim() } : {}),
      })
      continue
    }
    const parenMatch = /^[-*]\s*([^\r\n(]+?)\s*\(([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^)]+)\)(?:\s*[-:–]\s*(.+))?$/.exec(line)
    if (parenMatch) {
      bulletItems.push({
        name: parenMatch[1]!.trim(),
        uri: parenMatch[2]!.trim(),
        ...(parenMatch[3]?.trim() ? { description: parenMatch[3].trim() } : {}),
      })
      continue
    }
    const uriBullet = /^[-*]\s*([a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+)(?:\s*[-:–]\s*(.+))?$/.exec(line)
    if (uriBullet) {
      bulletItems.push({
        uri: uriBullet[1]!.trim(),
        name: uriBullet[1]!.trim(),
        ...(uriBullet[2]?.trim() ? { description: uriBullet[2].trim() } : {}),
      })
    }
  }

  if (bulletItems.length > 0) {
    return { resources: bulletItems, matched: true }
  }

  return { resources: [], matched: false }
}

function parseReadResourceBody(
  text: string,
  fallbackUri: string,
): {
  uri: string
  contentText?: string
  mimeType?: string
  offloadedPath?: string
  mediaSummary?: string
  skippedBinary: boolean
} {
  let uri = fallbackUri
  let body = text
  let mimeType: string | undefined

  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const parsed = JSON.parse(body)
      const contents = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).contents)
          ? ((parsed as Record<string, unknown>).contents as unknown[])
          : null
      if (contents && contents.length > 0) {
        const first = contents[0] as Record<string, unknown>
        if (!uri && typeof first.uri === 'string' && first.uri.trim()) uri = first.uri.trim()
        if (typeof first.mimeType === 'string' && first.mimeType.trim()) mimeType = first.mimeType.trim()
        const texts = contents
          .map((entry) => (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).text === 'string'
            ? ((entry as Record<string, unknown>).text as string)
            : ''))
          .filter(Boolean)
        if (texts.length > 0) body = texts.join('\n\n')
      }
    } catch {
      void 0
    }
  }

  const headerMatch = RESOURCE_HEADER_RE.exec(body)
  if (headerMatch) {
    if (!uri && headerMatch[1]?.trim()) uri = headerMatch[1].trim()
    body = headerMatch[2]?.trim() ?? ''
  }

  const offloadedMatch = OFFLOADED_RE.exec(body)
  const offloadedPath = offloadedMatch?.[1]?.trim() || undefined
  if (offloadedMatch) {
    body = body.replace(OFFLOADED_RE, '').trim()
  }

  const mediaMatch = MEDIA_CONTENT_RE.exec(body)
  const mediaSummary = mediaMatch?.[1]?.trim() || undefined
  if (mediaMatch) {
    body = mediaMatch[2]?.trim() ?? ''
  }

  const skippedBinary = SKIPPED_BINARY_RE.test(text)

  return {
    uri,
    ...(body ? { contentText: body } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(offloadedPath ? { offloadedPath } : {}),
    ...(mediaSummary ? { mediaSummary } : {}),
    skippedBinary,
  }
}

export function parseMcpResourceBlock(
  toolName: string,
  params: Record<string, unknown>,
  result?: string | null,
  isError?: boolean,
): McpResourceInfo {
  const action = resolveMcpResourceAction(toolName)
  const server = unwrapStr(params.server ?? params.ServerName ?? params.server_name ?? params.serverName)
  let uri = unwrapStr(params.uri ?? params.Uri ?? params.url ?? params.Url)

  const strippedResult = typeof result === 'string'
    ? result.replace(STEP_TIMESTAMP_HEADER_RE, '').trim()
    : ''
  const hasPlaceholderResult = strippedResult === 'done' || strippedResult === 'failed'
  const text = hasPlaceholderResult ? '' : strippedResult
  const cleanedError = isError && text ? text.replace(STEP_ERROR_PREFIX_RE, '').trim() : undefined

  if (action === 'list') {
    const parsed = !isError && text ? parseResourcesFromText(text) : { resources: [], matched: false }
    const emptyList = !isError && parsed.matched && parsed.resources.length === 0
    const extraText = !isError && !parsed.matched && text ? text : undefined
    return {
      action,
      server,
      uri,
      resources: parsed.resources,
      emptyList,
      skippedBinary: false,
      ...(cleanedError ? { errorMessage: cleanedError } : {}),
      ...(extraText ? { extraText } : {}),
      hasPlaceholderResult,
      raw: text,
    }
  }

  const readParsed = !isError && text
    ? parseReadResourceBody(text, uri)
    : { uri, skippedBinary: false }
  uri = readParsed.uri

  return {
    action,
    server,
    uri,
    resources: [],
    emptyList: false,
    ...(readParsed.contentText ? { contentText: readParsed.contentText } : {}),
    ...(readParsed.mimeType ? { mimeType: readParsed.mimeType } : {}),
    ...(readParsed.offloadedPath ? { offloadedPath: readParsed.offloadedPath } : {}),
    ...(readParsed.mediaSummary ? { mediaSummary: readParsed.mediaSummary } : {}),
    skippedBinary: readParsed.skippedBinary,
    ...(cleanedError ? { errorMessage: cleanedError } : {}),
    hasPlaceholderResult,
    raw: text,
  }
}

export function mcpResourceSummaryText(toolName: string, params: Record<string, unknown>): string {
  const info = parseMcpResourceBlock(toolName, params)
  if (info.action === 'read') {
    return [info.server, info.uri].filter(Boolean).join(' · ')
  }
  return info.server
}
