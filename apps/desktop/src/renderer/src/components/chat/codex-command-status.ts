import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'

/**
 * A command's non-zero exit code is an outcome of a successful tool call, not
 * a failure of the tool call itself. Codex reports both cases as `failed`, so
 * only treat a failed item without a process exit code as a tool error.
 */
export function isCodexCommandToolError(item: CodexCommandExecutionItem): boolean {
  return item.status === 'failed' && item.exitCode === undefined
}
