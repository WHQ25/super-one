import { McpAppResourceCache, mcpAppResourceReadKey, type McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import { McpAppsError, type McpAppHostResult, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { RelayClient } from '@superone/relay-client'
import type { McpAppDeviceRequest, RemoteCommand } from '@superone/shared/agent-types'
import type { McpAppsErrorCode } from '@superone/shared/mcp-apps'
import { randomId } from './ids'

/** What a phone View may ask the host for. Links open on the phone and never cross. */
const OPERATIONS: ReadonlySet<string> = new Set<McpAppDeviceRequest['operation']>(['load', 'activate', 'callTool', 'readResource', 'sendMessage', 'updateModelContext', 'removeModelContext'])

/**
 * The chat document gives up after 120 s on a tool call and 30 s otherwise. The relay
 * waits a little longer, so the document's own timeout is the one that classifies.
 */
const CALL_TIMEOUT_MS = 125_000
const REQUEST_TIMEOUT_MS = 35_000

export function parseMcpAppRequest(payload: unknown): McpAppDeviceRequest {
  const request = payload as Record<string, unknown> | undefined
  const named = (key: string) => typeof request?.[key] === 'string' && request[key] !== ''
  if (!request || !named('messageId') || !named('appInstanceId') || !OPERATIONS.has(String(request.operation))) {
    throw new Error('invalid mcpApp payload')
  }
  return request as McpAppDeviceRequest
}

function failure(code: McpAppsErrorCode, message: string) {
  return { ok: false, error: { code, message } }
}

/**
 * Carry one View operation to the host, which resolves binding and server and gates it.
 * The host's own answer passes through untouched; only transport failures are mapped,
 * by whether the command could have reached the host.
 */
async function invokeMcpApp(
  client: Pick<RelayClient, 'request'>,
  session: { projectPath: string; sessionId: string },
  request: McpAppDeviceRequest,
): Promise<unknown> {
  const call = request.operation === 'callTool'
  let reply: { response?: unknown; error?: string } | null
  try {
    reply = await client.request(
      { type: 'mcp_app_request', requestId: randomId(), ...session, request } as RemoteCommand,
      call ? CALL_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    ) as { response?: unknown; error?: string } | null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Refused before anything left the phone.
    if (message === 'not connected') return failure('not_connected', message)
    // Sent and then lost: a tool call may have run, so it must never be resent.
    return failure(call ? 'unknown_outcome' : 'timeout', message)
  }
  // The host refused the command itself, e.g. a session this device may not reach.
  if (reply?.error) return failure('denied', reply.error)
  return reply?.response
}


const resourceCaches = new WeakMap<object, McpAppResourceCache>()

/** Two-phase trusted shell load: metadata is small, HTML crosses the relay once per cached hash. */
export async function requestMcpApp(
  client: Pick<RelayClient, 'request'>,
  session: { projectPath: string; sessionId: string },
  request: McpAppDeviceRequest,
  app?: ToolAppAttachment,
): Promise<unknown> {
  if (request.operation !== 'load' || !app || app.appInstanceId !== request.appInstanceId) return invokeMcpApp(client, session, request)
  const cache = resourceCaches.get(client) ?? new McpAppResourceCache()
  resourceCaches.set(client, cache)
  let reference = app.resource
  if (!reference) {
    const result = await invokeMcpApp(client, session, { ...request, referenceOnly: true }) as McpAppHostResult<McpAppResourceSnapshot>
    if (!result?.ok) return result ?? failure('invalid', 'Missing MCP App resource response')
    reference = result.value
  }
  const key = JSON.stringify([session.projectPath, session.sessionId, mcpAppResourceReadKey(app), reference.hash])
  if (reference.html !== undefined) {
    cache.put(key, reference as McpAppResourceSnapshot)
    return { ok: true, value: reference }
  }
  try {
    const value = await cache.load(key, async () => {
      const result = await invokeMcpApp(client, session, { ...request, referenceOnly: undefined }) as McpAppHostResult<McpAppResourceSnapshot>
      if (!result?.ok) throw result ?? new McpAppsError('invalid', 'Missing MCP App resource response')
      if (result.value.hash !== reference.hash || typeof result.value.html !== 'string') throw new McpAppsError('invalid', 'Saved MCP App resource changed')
      return result.value
    })
    return { ok: true, value: { ...reference, html: value.html } }
  } catch (error) {
    if (error && typeof error === 'object' && 'ok' in error) return error
    return failure(error instanceof McpAppsError ? error.code : 'invalid', error instanceof Error ? error.message : String(error))
  }
}
