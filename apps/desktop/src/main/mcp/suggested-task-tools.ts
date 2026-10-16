/**
 * SuperOne MCP tool session_suggest_task.
 *
 * Suggesting only names a card; nothing runs until the user launches it, so the
 * call needs no confirmation. The card's later state lives on the call's row
 * (see `@superone/shared/suggested-task`), never in this result.
 */
import { suggestedTaskToolResult } from '@superone/runtime/collaboration/suggested-task'
import { SUGGEST_TASK_TOOL_NAME } from '@superone/shared/suggested-task'
import { denyMainThreadOnlyIfSubagent } from './main-thread-session-guard'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export { SUGGESTED_TASK_TITLE_MAX } from '@superone/runtime/collaboration/suggested-task'

export interface SessionSuggestTaskArgs {
  title: string
  tldr: string
  prompt: string
  cwd?: string
}


function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

export async function sessionSuggestTaskHandler(args: SessionSuggestTaskArgs, deps: BuiltInSuperoneToolDeps) {
  const denied = await denyMainThreadOnlyIfSubagent(deps.sessionId, SUGGEST_TASK_TOOL_NAME)
  if (denied) return toolResult(denied, true)
  try { return toolResult(suggestedTaskToolResult(args)) }
  catch (error) { return toolResult(`[Error] ${error instanceof Error ? error.message : String(error)}`, true) }
}
