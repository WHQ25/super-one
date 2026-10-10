import { voiceCapability } from '../session/realtime-voice-host'
import type { ConnectionDelivery } from '@superone/runtime/stream'
import type { Session } from '../session/types'
import { remoteRestoreMessages, stripEventForRemote } from '../remote-content'
import { whenHighlighterReady } from '../remote-highlighter'
import { loadRealtimeTimeline } from '../session/realtime-timeline-repo'
import { mcpAppContextSources } from '@superone/shared/mcp-apps-state'
import type { ChatMessage } from '@superone/shared/agent-types'
import { localSessionEnvironmentId } from '../environment/session-identity'
import type { SessionSnapshot } from '@superone/relay-client'
import { mergeCodexThreadMessages } from '@superone/shared/realtime-thread-messages'

/** A session's restore snapshot as `delivery`'s connection receives it. */
export async function buildRemoteSessionSnapshot(session: Session | undefined | null, projectPath: string, sessionId: string, delivery: ConnectionDelivery, history: readonly ChatMessage[] = []): Promise<SessionSnapshot & Required<Pick<SessionSnapshot, 'inProgressMessages' | 'pendingInteractions' | 'status'>>> {
  await whenHighlighterReady()
  const snapshot = session?.snapshot
  const inProgressMessages = delivery.messages(remoteRestoreMessages(snapshot?.messages ?? []), sessionId, projectPath)
  const queued = session?.getQueuedMessagesEvent()
  // Replayed by the phone on restore, so a queue built before it subscribed shows up.
  const pendingInteractions = [...(session?.getPendingInteractions() ?? []), ...(queued ? [queued] : [])]
    .map((event) => stripEventForRemote(event, projectPath))
  const status = session?.isStreaming() ? 'streaming' : 'idle'
  const sandboxInfo = snapshot?.harnessId === 'acp'
    ? await import('../acp/grok-sandbox').then((m) => m.currentGrokSandbox()).catch(() => undefined)
    : session?.getCurrentSandboxInfo()
  const realtimeTimeline = loadRealtimeTimeline(sessionId)
  const realtimeThreadMessages = realtimeTimeline ? mergeCodexThreadMessages(
    (snapshot?.messages ?? history).filter(message => message.metadata?.codexTimeline?.provenance === 'realtime-delegated'),
    realtimeTimeline, { keepDelegationPrompts: true },
  ) : []
  return {
    realtimeVoice: voiceCapability(session),
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
      realtimeHasTimeline: realtimeTimeline.hasTimeline,
      realtimeThreadMessages: stripMessagesForRemote(realtimeThreadMessages
        .map(message => progressive ? projectProgressiveMessage(message) : message), projectPath),
      activeRealtimeSessionId: realtimeTimeline.activeRealtimeSessionId,
    } : {}),
    contextTokens: snapshot?.contextTokens ?? 0,
    totalCostUsd: snapshot?.totalCostUsd ?? 0,
    goal: session?.getSessionGoal() ?? null,
  }
}
