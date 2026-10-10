import type { SessionCreateSelections } from '@superone/shared/environment/session-create'

const invalid = (message: string) => Object.assign(new Error(message), { code: 'invalid_argument' })
const STRINGS = ['sessionId', 'acpAgentId', 'gitBranch', 'worktreeBranch', 'worktreeBranchName', 'draftId', 'draftLeaseId'] as const

export function parseSessionCreateSelections(source: Record<string, unknown>): SessionCreateSelections {
  const result: SessionCreateSelections = {}
  for (const key of STRINGS) {
    if (!Object.hasOwn(source, key)) continue
    const value = source[key]
    if (typeof value !== 'string' || !value.trim()) throw invalid(`${key} must be a nonempty string`)
    result[key] = value
  }
  if (result.sessionId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(result.sessionId)) throw invalid('invalid sessionId')
  if (Object.hasOwn(source, 'worktreeMode')) {
    if (source.worktreeMode !== 'branch' && source.worktreeMode !== 'attach' && source.worktreeMode !== 'detach') throw invalid('worktreeMode must be branch|attach|detach')
    result.worktreeMode = source.worktreeMode
  }
  if (Object.hasOwn(source, 'worktreeCarryLocalChanges')) {
    if (typeof source.worktreeCarryLocalChanges !== 'boolean') throw invalid('worktreeCarryLocalChanges must be boolean')
    result.worktreeCarryLocalChanges = source.worktreeCarryLocalChanges
  }
  if ((result.worktreeMode || result.worktreeBranchName || result.worktreeCarryLocalChanges !== undefined) && !result.worktreeBranch) throw invalid('worktreeBranch is required for worktree choices')
  if (Boolean(result.draftId) !== Boolean(result.draftLeaseId)) throw invalid('draftId and draftLeaseId are required together')
  return result
}
