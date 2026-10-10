import type { ChatMessage, RealtimeTimelineResult, SandboxInfo } from '@superone/shared/agent-types'
import type { SessionRestoreFacts } from '@superone/shared/environment'
import { mcpAppContextSources } from '@superone/shared/mcp-apps-state'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from './types'
import { existsSync } from 'node:fs'

export interface DesktopRestorePorts {
  /** Complete asynchronous preparation before reading state and its cursor. */
  prepare?(session: Session | null): Promise<SandboxInfo | undefined>
  realtime?(sessionId: string): RealtimeTimelineResult | null
}

/** Raw host facts; the connection shapes message bodies only at the delivery boundary. */
export function sessionRestoreFacts(input: {
  session: Session | null | undefined
  environmentId: string
  history: readonly ChatMessage[]
  row?: DesktopSessionRow
  sandboxInfo?: SandboxInfo
  realtime?: RealtimeTimelineResult | null
}) {
  const { session, row, realtime } = input
  const snapshot = session?.snapshot
  const sandboxInfo = input.sandboxInfo ?? session?.getCurrentSandboxInfo()
  const restore: SessionRestoreFacts = {
    sourceEnvironmentId: input.environmentId,
    mcpAppContexts: mcpAppContextSources(snapshot?.messages ?? input.history),
    isWorktree: snapshot?.isWorktree ?? row?.isWorktree ?? !!row?.worktreePath,
    worktreePath: snapshot?.worktreePath ?? row?.worktreePath ?? null,
    gitBranch: snapshot?.gitBranch ?? row?.gitBranch ?? null,
    worktreeMissing: snapshot?.worktreeMissing ?? (!!row?.worktreePath && !existsSync(row.worktreePath)),
    ...(sandboxInfo ? { sandboxInfo } : {}),
  }
  return {
    restore,
    status: session?.isStreaming() ? 'streaming' as const : 'idle' as const,
    permissionMode: session?.getCurrentPermissionMode(),
    ultracode: session?.getUiSettings().ultracode ?? false,
    contextTokens: snapshot?.contextTokens ?? row?.contextTokens ?? 0,
    totalCostUsd: snapshot?.totalCostUsd ?? row?.totalCostUsd ?? 0,
    sessionGoal: session?.getSessionGoal() ?? null,
    realtimeSegments: realtime?.segments ?? [],
    realtimeSessionId: realtime?.activeRealtimeSessionId ?? null,
  }
}
