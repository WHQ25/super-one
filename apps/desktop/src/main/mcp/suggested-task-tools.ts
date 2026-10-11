/**
 * SuperOne MCP tool session_suggest_task.
 *
 * Suggesting only names a card; nothing runs until the user launches it, so the
 * call needs no confirmation. The card's later state lives on the call's row
 * (see `@superone/shared/suggested-task`), never in this result.
 */
import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { isAbsolute } from 'path'
import { SUGGEST_TASK_TOOL_NAME } from '@superone/shared/suggested-task'
import { denyMainThreadOnlyIfSubagent } from './main-thread-session-guard'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export const SUGGESTED_TASK_TITLE_MAX = 60

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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function sessionSuggestTaskHandler(args: SessionSuggestTaskArgs, deps: BuiltInSuperoneToolDeps) {
  const denied = await denyMainThreadOnlyIfSubagent(deps.sessionId, SUGGEST_TASK_TOOL_NAME)
  if (denied) return toolResult(denied, true)
  const title = text(args.title)
  if (!title || !text(args.tldr) || !text(args.prompt)) {
    return toolResult('[Error] title, tldr and prompt are all required.', true)
  }
  if (title.length > SUGGESTED_TASK_TITLE_MAX) {
    return toolResult(`[Error] title must be at most ${SUGGESTED_TASK_TITLE_MAX} characters.`, true)
  }
  const cwd = text(args.cwd)
  if (cwd && (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory())) {
    return toolResult(`[Error] cwd must be an existing absolute directory: ${cwd}. Omit it for the current project.`, true)
  }
  return toolResult({ taskId: randomUUID(), status: 'pending' })
}
