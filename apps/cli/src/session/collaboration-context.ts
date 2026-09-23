import type { SessionAgentLaunchConfig, SessionAgentProfile } from '@superone/shared/agent-types'
import { normalizeSessionHarnessId } from '@superone/shared/environment'
import type { SessionProviderStore } from '@superone/runtime/session'
import type {
  CollaborationGrantRow,
  CollaborationSecretCrypto,
  CollaborationStore,
} from '@superone/runtime/collaboration'
import type { NodeDatabase } from '../db/database'
import type { ProviderStore } from '../provider/provider-store'
import type { WorkspaceGitService } from '../workspace/git-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { EventLog } from './event-log'
import type { HarnessManager } from './harness-manager'
import type { SessionRuntime } from './session-runtime'

export interface CollaborationDeps {
  db: NodeDatabase
  events: EventLog
  environmentId: string
  sessions: SessionRuntime
  harnesses: HarnessManager
  providers: ProviderStore
  projects: ProjectRegistry
  workspaceGit: WorkspaceGitService
  secrets: CollaborationSecretCrypto
  /** Session-layer provider profiles (feeds multi-profile listProfiles). */
  sessionProviders?: SessionProviderStore
  experimentalClaudeOpenAiChatEnabled?: () => boolean
}

/** What every node collaboration operation works against. */
export interface CollaborationContext {
  deps: CollaborationDeps
  store: CollaborationStore
  listProfiles(): SessionAgentProfile[]
}

/** Node launches may pin an existing checkout that the desktop never sends. */
export type NodeLaunchConfig = SessionAgentLaunchConfig & { worktreePath?: string }

/**
 * Accept a bare harness id (`claude`) as well as a provider row id
 * (`claude-base`). The bare form used to be listed as its own profile; it no
 * longer is (desktop never listed it, and it duplicated every agent in the
 * @-mention popup), but grants written before this — and any tool call that
 * still passes it — must keep resolving.
 */
export function resolveProfile(
  profiles: Map<string, SessionAgentProfile>,
  agentId: string,
): SessionAgentProfile | undefined {
  const direct = profiles.get(agentId)
  if (direct) return direct
  const wire = normalizeSessionHarnessId(agentId)
  return wire ? profiles.get(`${wire}-base`) : undefined
}

export function initiatorTitleOf(ctx: CollaborationContext, grant: CollaborationGrantRow): string {
  return ctx.deps.sessions.get(grant.parent_session_id)?.title?.trim() || grant.parent_session_id.slice(0, 8)
}
