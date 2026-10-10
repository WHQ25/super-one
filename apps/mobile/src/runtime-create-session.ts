import type { ProjectRef } from '@superone/shared/environment/refs'
import type { CreateSessionOptions } from './runtime-types'

/** Creation settings chosen on the landing page travel together in one request. */
export function createSessionPayload(project: ProjectRef, sessionId: string, opts: CreateSessionOptions): Record<string, unknown> {
  return {
    projectId: project.projectId, sessionId,
    ...(opts.provider ? { harnessId: opts.provider } : {}),
    ...(opts.acpAgentId ? { acpAgentId: opts.acpAgentId } : {}),
    ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.gitBranch ? { gitBranch: opts.gitBranch } : {}),
    ...(opts.worktreePath ? { cwd: opts.worktreePath } : {}),
    ...(opts.worktreeBranch ? { worktreeBranch: opts.worktreeBranch } : {}),
    ...(opts.worktreeMode ? { worktreeMode: opts.worktreeMode } : {}),
    ...(opts.worktreeBranchName ? { worktreeBranchName: opts.worktreeBranchName } : {}),
    ...(opts.worktreeCarryLocalChanges !== undefined ? { worktreeCarryLocalChanges: opts.worktreeCarryLocalChanges } : {}),
    ...(opts.additionalDirectories?.length ? { additionalDirectories: opts.additionalDirectories } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.agentPreset ? { agentPreset: opts.agentPreset } : {}),
    ...(opts.apiProviderId !== undefined ? { apiProviderId: opts.apiProviderId } : {}),
    ...(opts.sandboxMode ? { sandboxMode: opts.sandboxMode } : {}),
    ...(opts.draftId ? { draftId: opts.draftId, draftLeaseId: opts.draftLeaseId } : {}),
  }
}
