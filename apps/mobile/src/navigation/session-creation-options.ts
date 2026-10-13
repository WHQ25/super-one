import type { HarnessId, SandboxMode } from '@superone/shared/agent-types'
import { harnessSupportsSandbox } from '@superone/shared/harness/harness-sandbox'
import { harnessSupportsAdditionalDirs } from '../provider-state'
import type { CreateSessionOptions } from '../runtime-types'
import { buildWorktreeCreateOptions, type NewSessionWorktreeSelection } from '../worktree-state'

/** Text and voice create the same backing session from the landing selections. */
export function sessionCreationOptions(input: {
  provider: HarnessId; acpAgentId: string | null; permissionMode: string
  model: string; effort: string
  /** Codex Fast picked on the landing; `null` is an explicit off, omission keeps the default. */
  serviceTier?: string | null
  worktree: NewSessionWorktreeSelection; branch?: string | null
  directories: string[]; sandboxMode: SandboxMode | null
  modeId: string | null; apiProviderId: string | null
}): CreateSessionOptions {
  const dirs = [...new Set(input.directories)]
  return {
    provider: input.provider,
    ...(input.provider === 'acp' && input.acpAgentId ? { acpAgentId: input.acpAgentId } : {}),
    permissionMode: input.permissionMode,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.provider === 'codex' && input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
    ...buildWorktreeCreateOptions(input.worktree, input.branch),
    ...(harnessSupportsAdditionalDirs(input.provider) && dirs.length ? { additionalDirectories: dirs } : {}),
    ...(input.sandboxMode && harnessSupportsSandbox(input.provider) ? { sandboxMode: input.sandboxMode } : {}),
    ...(input.modeId ? input.provider === 'dsh' ? { agentPreset: input.modeId } : { mode: input.modeId } : {}),
    ...(input.apiProviderId !== null ? { apiProviderId: input.apiProviderId } : {}),
  }
}
