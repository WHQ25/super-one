export interface SlashCommandInfo {
  name: string
  description: string
  argumentHint: string
  isSkill: boolean
  /** Stable native skill ID when the harness sends skill attachments. */
  skillId?: string
  /**
   * Claude SDK `terminal_slash_commands`: the command's UX is bound to a
   * local terminal. SuperOne (desktop + remote) hides these from `/` menus.
   */
  terminalBound?: boolean
  /**
   * Grok advertises registered workflows as available_commands with
   * `_meta.workflowSource` (builtin | project | user). Used by `/workflow` name
   * autocomplete in the host. `project` is cwd-scoped and must not be stored on
   * the agent-global ACP cache — see `withoutProjectScopedWorkflows`.
   */
  isWorkflow?: boolean
  workflowSource?: string
  /** Absolute or project-relative path to the `.rhai` source when known. */
  workflowPath?: string
  /** Host-expanded prompt template (Cursor `.cursor/commands`). */
  promptBody?: string
}
