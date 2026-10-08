import { projectProgressiveMessage } from '../remote/progressive-session'
import type { Session } from '../session/types'
import { remoteRestoreMessages, stripEventForRemote, stripMessagesForRemote } from '../remote-content'
import { whenHighlighterReady } from '../remote-highlighter'
import { loadRealtimeTimeline } from '../session/realtime-timeline-repo'
import { mcpAppContextSources } from '@superone/shared/mcp-apps-state'
import type { ChatMessage } from '@superone/shared/agent-types'
import { localSessionEnvironmentId } from '../environment/session-identity'
import type { SessionSnapshot } from '@superone/relay-client'

export async function buildRemoteSessionSnapshot(session: Session | undefined | null, projectPath: string, sessionId: string, progressive = false, history: readonly ChatMessage[] = []): Promise<SessionSnapshot & Required<Pick<SessionSnapshot, 'inProgressMessages' | 'pendingInteractions' | 'status'>>> {
  await whenHighlighterReady()
  const snapshot = session?.snapshot
  const inProgressMessages = stripMessagesForRemote(remoteRestoreMessages(snapshot?.messages ?? []).map(message => progressive ? projectProgressiveMessage(message) : message), projectPath)
  const queued = session?.getQueuedMessagesEvent()
  // Replayed by the phone on restore, so a queue built before it subscribed shows up.
  const pendingInteractions = [...(session?.getPendingInteractions() ?? []), ...(queued ? [queued] : [])]
    .map((event) => stripEventForRemote(event, projectPath))
  const status = session?.isStreaming() ? 'streaming' : 'idle'
  const sandboxInfo = snapshot?.harnessId === 'acp'
    ? await import('../acp/grok-sandbox').then((m) => m.currentGrokSandbox()).catch(() => undefined)
    : session?.getCurrentSandboxInfo()
  const realtimeTimeline = loadRealtimeTimeline(sessionId)
  return {
    sourceEnvironmentId: localSessionEnvironmentId(),
    mcpAppContexts: mcpAppContextSources(snapshot?.messages ?? history),
    inProgressMessages,
    pendingInteractions,
    status,
    permissionMode: session?.getCurrentPermissionMode(),
    ultracode: session?.getUiSettings().ultracode ?? false,
    isWorktree: snapshot?.isWorktree ?? false,
    worktreePath: snapshot?.worktreePath ?? null,
    gitBranch: snapshot?.gitBranch ?? null,
    ...(sandboxInfo ? { sandboxInfo } : {}),
    ...(realtimeTimeline ? {
      realtimeSegments: realtimeTimeline.segments,
      activeRealtimeSessionId: realtimeTimeline.activeRealtimeSessionId,
    } : {}),
    contextTokens: snapshot?.contextTokens ?? 0,
    totalCostUsd: snapshot?.totalCostUsd ?? 0,
    goal: session?.getSessionGoal() ?? null,
  }
}
