import { useEffect, useRef } from 'react'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useRealtimeCallStore } from '@/stores/realtime-call'

/** Choose a view once per entry, then leave explicit navigation in the user's hands. */
export function useCodexConversationActivation({ sessionId, projectPath, enabled, foreground }: {
  sessionId: string | null
  projectPath: string | null
  enabled: boolean
  foreground: boolean
}): void {
  const realtime = useCodexRealtimeViewStore(state => sessionId
    ? state.sessions[sessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW
    : EMPTY_CODEX_REALTIME_SESSION_VIEW)
  const callEngaged = useRealtimeCallStore(state => state.sessionId === sessionId && state.state !== 'idle')
  const activation = useRef<{ key: string | null; applied: boolean }>({ key: null, applied: false })
  const key = enabled && foreground && sessionId && projectPath ? `${projectPath}::${sessionId}` : null

  useEffect(() => {
    if (activation.current.key !== key) activation.current = { key, applied: false }
    if (!key || !sessionId || activation.current.applied) return
    // History can arrive after the pane opens. Wait for it before choosing a
    // resting view; an active call can select its view immediately.
    const voiceEngaged = callEngaged || realtime.starting || realtime.realtimeSessionId !== null
    if (!realtime.hasTimeline && !voiceEngaged) return
    activation.current.applied = true
    // A Details/back-link jump explicitly chose a destination before mounting.
    if (realtime.pendingJump) return
    // A stored call opens on the voice view, including after the call has ended.
    // The header toggle can still show the backing thread; this runs once per entry.
    useCodexRealtimeViewStore.getState().setView(sessionId, 'realtime')
  }, [callEngaged, key, realtime.hasTimeline, realtime.pendingJump, realtime.realtimeSessionId, realtime.starting, sessionId])
}
