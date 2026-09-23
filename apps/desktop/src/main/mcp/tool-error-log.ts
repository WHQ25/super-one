/**
 * A failed SuperOne tool call used to reach only the calling agent, so a user
 * reporting one had nothing in the main log to go on (#65). Every dispatcher
 * records failures through here: the tool name and error text, never the
 * arguments, which can carry user content.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import log from '../logger'
import { wrapToolsCallHandler } from './local-call-scope'

const MAX_LOGGED_ERROR_LENGTH = 500

interface ToolResultLike {
  isError?: boolean
  content?: Array<{ type?: string; text?: string }>
}

function errorText(result: ToolResultLike): string {
  const text = (result.content ?? [])
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join(' ')
  return text.length > MAX_LOGGED_ERROR_LENGTH ? `${text.slice(0, MAX_LOGGED_ERROR_LENGTH)}…` : text
}

/** Run one tool call and log it when it returns `isError` or throws. The outcome is unchanged. */
export async function logToolFailure<T>(sessionId: string, toolName: string, run: () => T | Promise<T>): Promise<T> {
  let result: T
  try {
    result = await run()
  } catch (error) {
    // A cancelled call is the caller's choice, not a failure worth a log line.
    if (!(error instanceof Error && error.name === 'AbortError')) {
      log.warn('[superone-mcp] tool %s threw sid=%s: %s', toolName, sessionId,
        error instanceof Error ? error.message : String(error))
    }
    throw error
  }
  if ((result as ToolResultLike | null)?.isError === true) {
    log.warn('[superone-mcp] tool %s failed sid=%s: %s', toolName, sessionId, errorText(result as ToolResultLike))
  }
  return result
}

/**
 * Log failures of every call reaching this instance's `tools/call` handler
 * (Claude SDK, HTTP). The SDK turns a throwing callback into an `isError`
 * result there, so both kinds are seen. Call before registering tools.
 */
export function bindToolErrorLog(server: McpServer, sessionId: string): void {
  wrapToolsCallHandler(server, (handler) => (request, extra) => logToolFailure(
    sessionId,
    String((request as { params?: { name?: unknown } }).params?.name ?? ''),
    () => handler(request, extra),
  ))
}
