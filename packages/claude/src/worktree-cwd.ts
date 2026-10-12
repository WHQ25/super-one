/**
 * The working directory a Claude `EnterWorktree` / `ExitWorktree` call left the
 * session in, read from the structured `tool_use_result`. The CLI moves its own
 * cwd (and the transcript's project directory) on these calls, and on resume it
 * restores the worktree from the transcript regardless of the cwd a host passes,
 * so the host's record has to follow the tool, not the other way round.
 */
export interface WorktreeCwdChange {
  cwd: string
  /** Undefined when the result does not name a branch (Exit returns to the launch directory). */
  gitBranch?: string | null
}

export function worktreeCwdChange(toolName: string | undefined, toolUseResult: unknown): WorktreeCwdChange | null {
  if (!toolUseResult || typeof toolUseResult !== 'object') return null
  const result = toolUseResult as Record<string, unknown>
  if (toolName === 'EnterWorktree') {
    const cwd = nonEmpty(result.worktreePath)
    if (!cwd) return null
    return { cwd, gitBranch: nonEmpty(result.worktreeBranch) ?? null }
  }
  if (toolName === 'ExitWorktree') {
    const cwd = nonEmpty(result.restoredCwd) ?? nonEmpty(result.originalCwd)
    return cwd ? { cwd } : null
  }
  return null
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
