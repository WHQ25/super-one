import type { McpServerInfo } from '@superone/shared/agent-types'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Normalize App Server MCP snapshots for the renderer IPC boundary. */
export function mapCodexMcpStatusForIpc(raw: unknown): McpServerInfo | null {
  const rec = asRecord(raw)
  const name = readString(rec?.name)
  if (!name) return null
  const authStatus = readString(rec?.authStatus)
  const serverInfo = asRecord(rec?.serverInfo)
  const status: McpServerInfo['status'] = authStatus === 'notLoggedIn'
    ? 'needs-auth'
    : serverInfo ? 'connected' : 'failed'
  const toolsRecord = asRecord(rec?.tools)
  const tools = toolsRecord
    ? Object.values(toolsRecord).map((tool) => {
        const item = asRecord(tool)
        const toolName = readString(item?.name)
        return toolName ? { name: toolName, ...(readString(item?.description) ? { description: readString(item?.description)! } : {}) } : null
      }).filter((tool): tool is { name: string; description?: string } => tool !== null)
    : []
  const resourcesValue = rec?.resources
  const resourcesRecord = Array.isArray(resourcesValue) ? resourcesValue : asRecord(resourcesValue)
  const resources = resourcesRecord
    ? (Array.isArray(resourcesRecord) ? resourcesRecord : Object.values(resourcesRecord)).map((resource) => {
        const item = asRecord(resource)
        const uri = readString(item?.uri)
        return uri ? { uri, ...(readString(item?.name) ? { name: readString(item?.name)! } : {}), ...(readString(item?.description) ? { description: readString(item?.description)! } : {}), ...(readString(item?.mimeType) ? { mimeType: readString(item?.mimeType)! } : {}) } : null
      }).filter((resource): resource is { uri: string; name?: string; description?: string; mimeType?: string } => resource !== null)
    : []
  return {
    name,
    status,
    toolCount: tools.length,
    tools,
    ...(resources.length ? { resources } : {}),
    authStatus: authStatus === 'notLoggedIn' ? 'needs-auth' : authStatus === 'bearerToken' || authStatus === 'oAuth' ? 'authenticated' : 'unknown',
    fetchedAt: Date.now(),
  }
}
