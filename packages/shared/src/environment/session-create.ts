/** Native desktop creation choices, carried with `session.create` rather than follow-up picker writes. */
export interface SessionCreateSelections {
  sessionId?: string
  acpAgentId?: string
  gitBranch?: string
  worktreeBranch?: string
  worktreeMode?: 'branch' | 'attach' | 'detach'
  worktreeBranchName?: string
  worktreeCarryLocalChanges?: boolean
  draftId?: string
  draftLeaseId?: string
}
