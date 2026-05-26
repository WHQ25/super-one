import type { StateCreator } from 'zustand'
import type { AgentEvent, AgentStatus, ChatMessage } from '@superone/shared/agent-types'
import type { ChatProvider, ChatStore, PerSessionState } from '../types'
import { mergeMessagesByMaxSeq } from '../helpers/event-helpers'
import { inferProviderFromHarnessId } from '../helpers/provider-routing'
import { createDefaultPerSessionState, createDefaultProjectState } from '../defaults'

/**
 * Event-related actions. `handleAgentEvent` is the central agent → store
 * pipeline; `syncLiveSnapshots` rehydrates state from main's live session
 * snapshots on focus.
 *
 * Note: `handleAgentEvent` is intentionally NOT extracted into this slice
 * yet — it's a ~400-line reducer with deep dependencies on
 * applyEventToSession plus a dozen private module helpers
 * (_hydrateSessionState, addRemoteSession, removeRemoteSession,
 * markMessageEventApplied, _ensureSessionHydrated, ...). Pulling it out
 * cleanly requires first extracting the helpers themselves. Tracked
 * separately; the action remains in index.ts for now and `createEventSlice`
 * delegates back to `get().handleAgentEvent` for replays.
 */
export interface EventSlice {
  syncLiveSnapshots: () => Promise<void>
}

export const createEventSlice: StateCreator<ChatStore, [], [], EventSlice> = (set, get) => ({
  syncLiveSnapshots: async () => {
    const getSnap = window.agent.getLiveSnapshots
    if (!getSnap) return
    let entries
    try {
      entries = await getSnap()
    } catch (err) {
      console.warn('[chat] getLiveSnapshots failed:', err)
      return
    }
    if (!entries || entries.length === 0) return

    const activeByProject = new Map<string, string>()
    for (const entry of entries) {
      if (entry.isActive) activeByProject.set(entry.projectPath, entry.sid)
    }

    set((s) => {
      const nextProjects = { ...s.projectSessions }
      for (const entry of entries) {
        const prevProject = nextProjects[entry.projectPath] ?? createDefaultProjectState()
        const prevSession = prevProject._sessions[entry.sid] ?? createDefaultPerSessionState()
        const mergedMessages = mergeMessagesByMaxSeq(entry.snapshot.messages as ChatMessage[], prevSession.messages)
        const provider: ChatProvider = inferProviderFromHarnessId(entry.snapshot.harnessId) ?? 'claude'
        const inferredStatus: AgentStatus = entry.isStreaming ? 'streaming' : prevSession.status === 'error' ? 'error' : 'idle'
        const mergedSession: PerSessionState = {
          ...prevSession,
          cwd: entry.snapshot.cwd,
          messages: mergedMessages,
          totalCostUsd: Math.max(prevSession.totalCostUsd, entry.snapshot.totalCostUsd),
          contextTokens: Math.max(prevSession.contextTokens, entry.snapshot.contextTokens),
          status: inferredStatus,
          awaitingAssistantReply: entry.isStreaming && !entry.snapshot.currentMessageId
            ? prevSession.awaitingAssistantReply
            : false,
          sessionProvider: provider,
          preferredProvider: provider,
          permissionMode: entry.permissionMode,
          lastAssistantMessageId: entry.snapshot.currentMessageId ?? prevSession.lastAssistantMessageId,
          _worktreePath: entry.snapshot.worktreePath ?? prevSession._worktreePath,
          _worktreeBaseBranch: entry.snapshot.gitBranch ?? prevSession._worktreeBaseBranch,
          _worktreeRemoved: entry.snapshot.worktreeMissing,
          apiProviderId: entry.snapshot.apiProviderId ?? prevSession.apiProviderId ?? null,
          _historyHydrated: true,
        }
        const nextSessions = { ...prevProject._sessions, [entry.sid]: mergedSession }
        const nextActiveSid = activeByProject.get(entry.projectPath) ?? prevProject._activeSessionId ?? entry.sid
        nextProjects[entry.projectPath] = {
          ...prevProject,
          _sessions: nextSessions,
          _activeSessionId: nextActiveSid,
          sandboxInfo: entry.sandboxInfo,
        }
      }
      return { projectSessions: nextProjects }
    })

    for (const entry of entries) {
      for (const ev of entry.replayEvents) {
        try { get().handleAgentEvent(ev as AgentEvent) } catch (err) { console.warn('[chat] replay event error:', err) }
      }
      for (const ev of entry.pendingInteractions) {
        try { get().handleAgentEvent(ev as AgentEvent) } catch (err) { console.warn('[chat] pending interaction error:', err) }
      }
    }
  },
})
