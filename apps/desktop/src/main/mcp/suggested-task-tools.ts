/**
 * SuperOne MCP suggested-task tools: session_suggest_task / session_dismiss_task.
 *
 * Suggesting only names a card; nothing runs until the user launches it, so the
 * call needs no confirmation. The card's later state lives on the call's row
 * (see `@superone/shared/suggested-task`), never in this result.
 */
import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { isAbsolute } from 'path'
import { DISMISS_TASK_TOOL_NAME, SUGGEST_TASK_TOOL_NAME } from '@superone/shared/suggested-task'
import type { Session } from '../session/types'
import { denyMainThreadOnlyIfSubagent } from './main-thread-session-guard'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export const SUGGESTED_TASK_TITLE_MAX = 60

export const SUGGESTED_TASK_PENDING_NOTE =
  'Shown to the user as a card; they launch or dismiss it. Continue your current task. '
  + 'If the suggestion becomes moot, withdraw it with session_dismiss_task({ taskId }).'

export interface SessionSuggestTaskArgs {
  title: string
  tldr: string
  prompt: string
  cwd?: string
}

export interface SessionDismissTaskArgs {
  taskId: string
  reason?: string
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
  return toolResult({ taskId: randomUUID(), status: 'pending', note: SUGGESTED_TASK_PENDING_NOTE })
}

export async function sessionDismissTaskHandler(args: SessionDismissTaskArgs, deps: BuiltInSuperoneToolDeps) {
  const denied = await denyMainThreadOnlyIfSubagent(deps.sessionId, DISMISS_TASK_TOOL_NAME)
  if (denied) return toolResult(denied, true)
  const taskId = text(args.taskId)
  if (!taskId) return toolResult('[Error] taskId is required.', true)
  const session = deps.sessionHost?.getSession(deps.sessionId) as Session | null | undefined
  if (!session) return toolResult('[Error] This session is not available.', true)
  const { dismissSuggestedTask, SuggestedTaskError } = await import('../session/suggested-task')
  try {
    dismissSuggestedTask(session, taskId, 'agent', args.reason)
  } catch (error) {
    if (error instanceof SuggestedTaskError) return toolResult(`[Error] ${error.message}`, true)
    throw error
  }
  return toolResult({ taskId, status: 'dismissed' })
}
