import type { ElicitationRequest } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest } from '@superone/shared/schema-form'

/**
 * One SDK elicitation as the shared permission card, for desktop and node alike.
 * Undefined for a URL request without a URL, which the caller declines.
 *
 * `title` / `description` / `displayName` are the server's own consent copy
 * (`_meta['anthropic/permissionDisplay']`); `message` is the fallback header.
 * A URL request always shows the URL itself, so the user sees where it leads
 * before consenting.
 */
export function claudeElicitationRequest(requestId: string, request: ElicitationRequest): PermissionRequest | undefined {
  const isUrl = request.mode === 'url'
  if (isUrl && !request.url) return undefined
  const subtitle = isUrl ? request.url : request.description ?? (request.title ? request.message : undefined)
  return {
    requestId,
    toolName: request.serverName,
    toolUseId: requestId,
    input: {},
    allowAlwaysAllow: false,
    requestKind: 'mcp_elicitation',
    serverName: request.serverName,
    ...(request.displayName ? { serverLabel: request.displayName } : {}),
    message: request.title ?? request.message,
    ...(subtitle ? { subtitle } : {}),
    // MCP URL mode: `accept` is the user's consent to open the link, not the flow's end.
    ...(isUrl ? { elicitationUrl: request.url, elicitationAcceptOnOpen: true } : elicitationFormRequest(request.requestedSchema)),
    ...(request.elicitationId ? { elicitationId: request.elicitationId } : {}),
  }
}
