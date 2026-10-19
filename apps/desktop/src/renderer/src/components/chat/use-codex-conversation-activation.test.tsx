/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useCodexConversationActivation } from './use-codex-conversation-activation'

describe('useCodexConversationActivation', () => {
  beforeEach(() => {
    useCodexRealtimeViewStore.setState({ sessions: {} })
  })

  it('opens a remote call still in progress on the voice view', () => {
    useCodexRealtimeViewStore.setState({
      sessions: {
        voice: { ...EMPTY_CODEX_REALTIME_SESSION_VIEW, hasTimeline: true, realtimeSessionId: 'rt-1', view: 'thread', loadStatus: 'loaded' },
      },
    })
    renderHook(() => useCodexConversationActivation({
      sessionId: 'voice',
      projectPath: 'remote:env-1:/work/app',
      enabled: true,
      foreground: true,
    }))
    expect(useCodexRealtimeViewStore.getState().sessions.voice?.view).toBe('realtime')
  })

  it('leaves a pending jump on the view it already chose', () => {
    const pendingJump = { view: 'thread' as const, messageId: 'm1' }
    useCodexRealtimeViewStore.setState({
      sessions: {
        voice: { ...EMPTY_CODEX_REALTIME_SESSION_VIEW, hasTimeline: true, view: 'thread', pendingJump },
      },
    })
    renderHook(() => useCodexConversationActivation({
      sessionId: 'voice',
      projectPath: 'remote:env-1:/work/app',
      enabled: true,
      foreground: true,
    }))
    const session = useCodexRealtimeViewStore.getState().sessions.voice
    expect(session?.view).toBe('thread')
    expect(session?.pendingJump).toEqual(pendingJump)
  })
})
