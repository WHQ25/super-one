import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'
import type { DeferredToolDetail } from './use-deferred-tool-detail'

/** Older hosts prefixed command output with a green `$ command` line. */
export function stripLegacyCommandEcho(command: string, output: string): string {
  if (!command) return output
  const legacyEcho = `\x1b[32m$\x1b[0m ${command}`
  return output.startsWith(`${legacyEcho}\n`) ? output.slice(legacyEcho.length + 1) : output === legacyEcho ? '' : output
}

/**
 * A summarized Codex command with its loaded detail. Older hosts return
 * input/result only; newer ones also include the command's item. The shell's
 * live status wins over the fetched one.
 */
export function mergeCodexCommandDetail(item: CodexCommandExecutionItem, detail: DeferredToolDetail): CodexCommandExecutionItem {
  let command = item.command
  try { const input = JSON.parse(detail.input ?? '{}'); if (typeof input.command === 'string') command = input.command } catch { /* retain shell */ }
  const base = detail.item?.type === 'command_execution'
    ? { ...detail.item, aggregatedOutput: detail.result ?? detail.item.aggregatedOutput, status: item.status, exitCode: item.exitCode ?? detail.item.exitCode }
    : { ...item, command, aggregatedOutput: detail.result ?? item.aggregatedOutput }
  return { ...base, aggregatedOutput: stripLegacyCommandEcho(base.command, base.aggregatedOutput) }
}
