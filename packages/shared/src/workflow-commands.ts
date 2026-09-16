import type { SlashCommandInfo } from './agent-types'

/**
 * Grok `available_commands` mark registered workflows with
 * `_meta.workflowSource`: builtin | project | user.
 *
 * Project `.grok/workflows` ads are cwd-scoped. The agent-global ACP cache is
 * keyed only by agent id, so those entries must not be stored or re-seeded
 * onto a session in a different repo.
 */
export function isProjectScopedWorkflowCommand(
  command: Pick<SlashCommandInfo, 'workflowSource'>,
): boolean {
  return command.workflowSource === 'project'
}

export function withoutProjectScopedWorkflows<T extends Pick<SlashCommandInfo, 'workflowSource'>>(
  commands: T[],
): T[] {
  return commands.filter((command) => !isProjectScopedWorkflowCommand(command))
}
