import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { SuggestedTaskInput } from '@superone/shared/suggested-task'

export const SUGGESTED_TASK_TITLE_MAX = 60

/** Shared validation for desktop and node-local MCP executors. No launch happens here. */
export function suggestedTaskToolResult(raw: unknown): { taskId: string; status: 'pending' } {
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Partial<SuggestedTaskInput> : {}
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const invalid = (message: string): never => { throw Object.assign(new Error(message), { code: 'invalid_argument' }) }
  const title = text(args.title)
  if (!title || !text(args.tldr) || !text(args.prompt)) return invalid('title, tldr and prompt are all required.')
  if (title.length > SUGGESTED_TASK_TITLE_MAX) return invalid(`title must be at most ${SUGGESTED_TASK_TITLE_MAX} characters.`)
  const cwd = text(args.cwd)
  if (cwd && (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory())) return invalid(`cwd must be an existing absolute directory: ${cwd}. Omit it for the current project.`)
  return { taskId: randomUUID(), status: 'pending' }
}
