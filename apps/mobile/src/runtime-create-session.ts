import type { RemoteCommand } from '@superone/shared/agent-types'
import type { CreateSessionOptions } from './runtime-types'
import { randomId } from './ids'

/** Creation settings chosen on the landing page travel together in one request. */
export function createSessionCommand(projectPath: string, sessionId: string, opts: CreateSessionOptions): RemoteCommand {
  return {
    type: 'create_session', requestId: randomId(), sessionId, projectPath,
    ...(opts.provider ? { provider: opts.provider as Extract<RemoteCommand, { type: 'create_session' }>['provider'] } : {}),
    ...(opts.acpAgentId ? { acpAgentId: opts.acpAgentId } : {}),
    ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.gitBranch ? { gitBranch: opts.gitBranch } : {}),
    ...(opts.worktreePath ? { worktreePath: opts.worktreePath } : {}),
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
