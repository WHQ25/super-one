import type { Session } from '../session/types'
import { remoteRestoreMessages, stripEventForRemote, stripMessagesForRemote } from '../remote-content'
import { loadRealtimeTimeline } from '../session/realtime-timeline-repo'

export async function buildRemoteSessionSnapshot(session: Session | undefined | null, projectPath: string, sessionId: string) {
  const snapshot = session?.snapshot
  const inProgressMessages = stripMessagesForRemote(remoteRestoreMessages(snapshot?.messages ?? []), projectPath)
  const pendingInteractions = session?.getPendingInteractions().map((event) => stripEventForRemote(event, projectPath)) ?? []
  const status = session?.isStreaming() ? 'streaming' : 'idle'
  const sandboxInfo = snapshot?.harnessId === 'acp'
    ? await import('../acp/grok-sandbox').then((m) => m.currentGrokSandbox()).catch(() => undefined)
    : session?.getCurrentSandboxInfo()
  const realtimeTimeline = loadRealtimeTimeline(sessionId)
  return {
    inProgressMessages,
    pendingInteractions,
    status,
    permissionMode: session?.getCurrentPermissionMode(),
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
  }
}
