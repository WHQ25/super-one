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
export async function requestMcpApp(
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
