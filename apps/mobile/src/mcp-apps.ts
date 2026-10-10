import { McpAppResourceCache, mcpAppResourceReadKey, type McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import { McpAppsError, type McpAppHostResult, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { MobileRpcClient } from './runtime-session-rpc'
import type { McpAppDeviceRequest } from '@superone/shared/agent-types'
import type { McpAppsErrorCode } from '@superone/shared/mcp-apps'
import { runtimeSessionRef } from './runtime-session-rpc'
import { MCP_APP_CONTROL_OPERATIONS } from '@superone/shared/environment/mcp-apps-rpc'
import { isMcpAppHttpDownload, type McpAppLocalDownload } from '@superone/shared/mcp-app-download'

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
  client: Pick<MobileRpcClient, 'rpc' | 'controlledRpc' | 'environmentId'>,
  session: { projectPath: string; sessionId: string; environmentId?: string | null },
  request: McpAppDeviceRequest,
): Promise<unknown> {
  const call = request.operation === 'callTool'
  try {
    const resource = runtimeSessionRef(client, session.sessionId, session.environmentId ?? null)
    const options = { timeoutMs: call ? CALL_TIMEOUT_MS : REQUEST_TIMEOUT_MS }
    return await (MCP_APP_CONTROL_OPERATIONS.has(request.operation)
      ? client.controlledRpc(resource, 'mcpApps.request', { request }, options)
      : client.rpc('mcpApps.request', { sessionId: session.sessionId, request }, { ...options, environmentId: resource.environmentId }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'not connected' || message === 'No authenticated session') return failure('not_connected', message)
    // An explicit server refusal has a known outcome; lost receipts do not.
    const code = (error as { code?: string }).code
    if (code && code !== 'unavailable') return failure(code === 'invalid_argument' ? 'invalid' : 'denied', message)
    return failure(call ? 'unknown_outcome' : 'timeout', message)
  }
}


const resourceCaches = new WeakMap<object, McpAppResourceCache>()

/** Two-phase trusted shell load: metadata is small, HTML crosses the relay once per cached hash. */
export async function requestMcpApp(
  client: Pick<MobileRpcClient, 'rpc' | 'controlledRpc' | 'environmentId'>,
  session: { projectPath: string; sessionId: string; environmentId?: string | null },
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

/**
 * `mcpAppDownload`'s payload: items the chat document already resolved. Each carries
 * exactly one of the View's text, its base64 bytes, or an http(s) URL the phone fetches.
 */
export function parseMcpAppDownloads(payload: unknown): McpAppLocalDownload[] {
  const items = (payload as Record<string, unknown> | undefined)?.items
  if (!Array.isArray(items) || !items.length) throw new Error('invalid mcpAppDownload payload')
  return items.map((value) => {
    const item = value as Record<string, unknown> | null
    if (!item || typeof item.name !== 'string' || !item.name || typeof item.mimeType !== 'string') throw new Error('invalid mcpAppDownload item')
    const base = { name: item.name, mimeType: item.mimeType || 'application/octet-stream' }
    const sources = ['text', 'base64', 'url'].filter((key) => typeof item[key] === 'string')
    if (sources.length !== 1) throw new Error('invalid mcpAppDownload item')
    if (typeof item.text === 'string') return { ...base, text: item.text }
    if (typeof item.base64 === 'string') return { ...base, base64: item.base64 }
    if (!isMcpAppHttpDownload(item.url as string)) throw new Error('unsupported mcpAppDownload link')
    return { ...base, url: item.url as string }
  })
}
