/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus, ChatMessage, RealtimeTimelineResult } from '@superone/shared/agent-types'
import { resetCodexRealtimeHydrationForTests, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { mergeCodexThreadMessages } from './codex-realtime-messages'
import { CodexRealtimeTranscript } from './CodexRealtimeTranscript'

const originalLoad = window.agent.loadRealtimeTimeline
const originalGet = window.agent.getRealtimeTimeline

function stubTimeline(timeline: RealtimeTimelineResult) {
  Object.assign(window.agent, {
    loadRealtimeTimeline: vi.fn(async () => timeline),
    getRealtimeTimeline: vi.fn(async () => timeline),
  })
}

const voiceWork: ChatMessage = {
  id: 'voice-work', role: 'assistant', status: 'complete', providerId: 'codex',
  createdAt: '2026-09-17T00:00:02Z',
  content: [{ type: 'text', text: 'Voice task completed' }],
  metadata: {
    codex: {
      threadId: 'thread', turnId: 'voice-turn', usage: null, durationMs: 4_000,
      items: [{ id: 'cmd', type: 'command_execution', command: 'git diff', aggregatedOutput: '', status: 'completed' }],
      finalResponse: 'Voice task completed',
    },
    codexTimeline: { provenance: 'realtime-delegated', turnId: 'voice-turn', position: 20 },
  },
}

const spokenTimeline: RealtimeTimelineResult = {
  segments: [
    { id: 'spoken-user', realtimeSessionId: 'rt', role: 'user', text: 'Review the voice commit', position: 10, startedAtMs: Date.parse('2026-09-17T00:00:00Z') },
    { id: 'spoken-answer', realtimeSessionId: 'rt', role: 'assistant', text: 'I have reviewed it', position: 15, startedAtMs: Date.parse('2026-09-17T00:00:01Z') },
  ],
  threadMessages: [voiceWork], activeRealtimeSessionId: 'rt', hasTimeline: true,
}

afterEach(() => {
  cleanup()
  useCodexRealtimeViewStore.setState({ sessions: {} })
  resetCodexRealtimeHydrationForTests()
  vi.restoreAllMocks()
  Object.assign(window.agent, { loadRealtimeTimeline: originalLoad, getRealtimeTimeline: originalGet })
})

describe('voice timeline isolation', () => {
  it('renders spoken turns plus one status row per delegated range, and nothing typed', async () => {
    stubTimeline(spokenTimeline)
    const typed: ChatMessage = {
      id: 'typed-after', role: 'user', status: 'complete', providerId: 'codex',
      content: [{ type: 'text', text: 'Now fix the issue' }], createdAt: '2026-09-17T00:01:00Z',
    }
    const reply: ChatMessage = {
      id: 'typed-reply', role: 'assistant', status: 'streaming', providerId: 'codex',
      content: [{ type: 'text', text: 'Fixing the issue' }], createdAt: '2026-09-17T00:01:01Z',
      _lastAppliedSeq: 50_000,
    }
    const view = (messages: ChatMessage[], sessionStatus: AgentStatus, needsDecision = false) => (
      <CodexRealtimeTranscript
        sessionId="isolation-test" scrollViewportRef={createRef<HTMLDivElement>()}
        liquidGlass={false} threadMessages={mergeCodexThreadMessages(messages, spokenTimeline)}
        sessionStatus={sessionStatus} needsDecision={needsDecision}
      />
    )
    const { container, rerender } = render(view([], 'idle'))
    await act(async () => {})
    const ids = () => Array.from(container.querySelectorAll('[data-message-id]'), (element) => element.getAttribute('data-message-id'))
    expect(ids()).toEqual(['codex-realtime-spoken-user', 'codex-realtime-spoken-answer'])
    const card = screen.getByTestId('realtime-delegation-row')
    expect(card).toHaveAttribute('data-activity-kind', 'command')
    expect(card).toHaveAttribute('data-activity-status', 'completed')
    expect(screen.getByTestId('realtime-delegation-status')).toHaveTextContent('Detail')
    // The row is a status line, not a summary: the work itself stays in the thread.
    expect(screen.queryByText('Voice task completed')).toBeNull()
    expect(container.querySelector('[data-voice-turn-id="spoken-user"]'))
      .toHaveAttribute('data-message-id', 'codex-realtime-spoken-user')

    // A later typed turn belongs to the thread view; the completed card keeps its
    // node and its settled status whatever the session is doing now.
    act(() => useCodexRealtimeViewStore.getState().setRealtimeSession('isolation-test', null))
    for (const [status, needsDecision] of [
      ['streaming', false], ['background', false], ['streaming', true], ['error', false], ['idle', false],
    ] as const) {
      rerender(view([typed, { ...reply, status: status === 'idle' ? 'complete' : status === 'error' ? 'error' : 'streaming' }], status, needsDecision))
      expect(ids()).toEqual(['codex-realtime-spoken-user', 'codex-realtime-spoken-answer'])
      expect(screen.queryByText('Now fix the issue')).toBeNull()
      expect(screen.getByTestId('realtime-delegation-row')).toBe(card)
      expect(card).toHaveAttribute('data-activity-status', 'completed')
    }
  })

  it('times a running range from its first row and jumps to the thread on click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.parse('2026-09-17T00:00:10Z'))
    const running: ChatMessage = {
      ...voiceWork,
      status: 'streaming',
      metadata: { ...voiceWork.metadata, codex: { ...voiceWork.metadata!.codex!, durationMs: undefined } },
    }
    const timeline: RealtimeTimelineResult = { ...spokenTimeline, threadMessages: [running] }
    stubTimeline(timeline)
    render(<CodexRealtimeTranscript
      sessionId="running-test" scrollViewportRef={createRef<HTMLDivElement>()}
      liquidGlass={false} threadMessages={mergeCodexThreadMessages([], timeline)}
      sessionStatus="streaming" needsDecision={false}
    />)
    await act(async () => {})
    const card = screen.getByTestId('realtime-delegation-row')
    expect(card).toHaveAttribute('data-activity-status', 'working')
    expect(screen.getByTestId('realtime-delegation-status')).toHaveTextContent('Working for 8s')
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(screen.getByTestId('realtime-delegation-status')).toHaveTextContent('Working for 10s')

    fireEvent.click(screen.getByRole('button', { name: 'Open in Codex thread' }))
    expect(useCodexRealtimeViewStore.getState().sessions['running-test']).toMatchObject({
      view: 'thread',
      pendingJump: { view: 'thread', turnId: 'voice-turn', messageId: 'voice-work' },
    })
    vi.useRealTimers()
  })

  it('scrolls to the delegating spoken turn when the thread view jumps back', async () => {
    stubTimeline(spokenTimeline)
    const scrollViewportRef = createRef<HTMLDivElement>()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<CodexRealtimeTranscript
      sessionId="jump-test" scrollViewportRef={scrollViewportRef}
      liquidGlass={false} threadMessages={mergeCodexThreadMessages([], spokenTimeline)}
      sessionStatus="idle" needsDecision={false}
    />)
    await act(async () => {})
    act(() => useCodexRealtimeViewStore.getState().jumpTo('jump-test', { view: 'realtime', turnId: 'voice-turn' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect((scrollIntoView.mock.contexts[0] as Element).getAttribute('data-voice-turn-id')).toBe('spoken-user')
    expect(useCodexRealtimeViewStore.getState().sessions['jump-test']?.pendingJump).toBeNull()
  })
})

describe('desktop startup echo display', () => {
  it('filters restored startup echoes but preserves repeated live speech', async () => {
    const typed: ChatMessage = {
      id: 'typed', role: 'user', content: [{ type: 'text', text: 'Check the voice settings' }],
      status: 'complete', providerId: 'codex', createdAt: '2026-09-17T00:00:00Z', _lastAppliedSeq: 50_000,
    }
    stubTimeline({
      segments: [
        { id: 'echo', realtimeSessionId: 'rt', role: 'user', text: 'Check the voice settings', position: 2 },
        { id: 'echo-reply', realtimeSessionId: 'rt', role: 'assistant', text: 'Stale startup reply', position: 3 },
      ],
      threadMessages: [], activeRealtimeSessionId: 'rt', hasTimeline: true,
    })
    render(<CodexRealtimeTranscript
      sessionId="echo-test" scrollViewportRef={createRef<HTMLDivElement>()}
      liquidGlass={false} threadMessages={[typed]} sessionStatus="idle" needsDecision={false}
    />)
    await act(async () => {})
    // The echo is Codex replaying the typed row as startup context, not speech —
    // and the typed row itself lives in the thread view, so nothing shows here.
    expect(screen.queryByText('Check the voice settings')).toBeNull()
    expect(screen.queryByText('Stale startup reply')).not.toBeInTheDocument()

    act(() => {
      const store = useCodexRealtimeViewStore.getState()
      store.completeTranscriptItem('echo-test', {
        itemId: 'spoken', realtimeSessionId: 'rt', role: 'user', text: 'Check the voice settings',
        startedAtMs: Date.parse('2026-09-17T00:01:00Z'), localOrder: 50_001,
      })
    })
    expect(screen.getAllByText('Check the voice settings')).toHaveLength(1)
  })
})
