import type { CodexCommandAction, CodexCommandExecutionItem } from '@superone/shared/agent-types'
import { capAggregatedOutput } from '@superone/shared/codex-command-output'
import { resolveCodexCommandActions } from '@superone/shared/codex-command-actions'

const string = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined
const number = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Both hosts map the same App Server item, including its execution directory. */
export function mapCodexCommandItem(id: string, rec: Record<string, unknown>, previous?: CodexCommandExecutionItem): CodexCommandExecutionItem {
  const actions = Array.isArray(rec.commandActions) ? rec.commandActions.flatMap((entry): CodexCommandAction[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const action = entry as Record<string, unknown>
    return [{ type: string(action.type) ?? 'unknown', command: string(action.command),
      name: string(action.name), path: string(action.path), query: string(action.query) }]
  }) : previous?.commandActions
  const status = rec.status ?? previous?.status
  const exitCode = number(rec.exitCode) ?? number(rec.exit_code)
  const item: CodexCommandExecutionItem = {
    id, type: 'command_execution', command: string(rec.command) ?? previous?.command ?? '',
    cwd: string(rec.cwd) ?? previous?.cwd,
    aggregatedOutput: capAggregatedOutput(string(rec.aggregatedOutput) ?? string(rec.aggregated_output) ?? previous?.aggregatedOutput ?? ''),
    ...(exitCode !== undefined ? { exitCode } : {}),
    status: status === 'in_progress' || status === 'inProgress' ? 'in_progress' : status === 'failed' || status === 'declined' ? 'failed' : 'completed',
    ...(actions ? { commandActions: actions } : {}),
  }
  const resolved = resolveCodexCommandActions(item)
  return resolved.length ? { ...item, commandActions: resolved } : item
}
