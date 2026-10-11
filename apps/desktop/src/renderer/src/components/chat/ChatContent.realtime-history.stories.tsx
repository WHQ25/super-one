import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, RealtimeTimelineResult } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'
import { ChatContent } from './ChatContent'

const PROJECT = '__realtime_history__'
const SESSION = 'voice-history'
mockTranscriptIpc()
mockIpc('agent', 'setSessionForeground', async () => undefined)
mockIpc('agent', 'loadRealtimeTimeline', async () => null)
mockIpc('app', 'codexListModels', async () => [])
mockIpc('app', 'codexGetGoal', async () => null)

function Preview({ active = false, completed = false, narrow = false }: {
  active?: boolean; completed?: boolean; narrow?: boolean
}) {
  const [ready, setReady] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = useChatStore.getState()
    const previousCatalog = useAppStore.getState().harnessCatalog
    const previousRealtime = useCodexRealtimeViewStore.getState().sessions
    const previousCall = useRealtimeCallStore.getState()
    const message: ChatMessage = {
      id: 'live-work', role: 'assistant', status: completed ? 'complete' : 'streaming', providerId: 'codex',
      createdAt: new Date(Date.now() - 12_000).toISOString(),
      content: completed ? [{ type: 'text', text: 'Checked the voice session history. 已检查语音会话历史。' }] : [],
      metadata: {
        codex: { threadId: 'thread-1', turnId: 'turn-1', usage: null,
          ...(completed ? { durationMs: 12_000 } : {}),
          items: [{ id: 'cmd', type: 'command_execution', command: 'git diff --stat',
            aggregatedOutput: '', status: completed ? 'completed' : 'in_progress' }],
        },
        codexTimeline: { provenance: 'realtime-delegated', turnId: 'turn-1', localOrder: 200 },
      },
    }
    const timeline: RealtimeTimelineResult = {
      hasTimeline: true, activeRealtimeSessionId: active ? 'rt-1' : null,
      segments: [
        { id: 'spoken-user', realtimeSessionId: 'rt-1', role: 'user', text: 'Check the history. 检查一下历史。',
          position: 3, localOrder: 100, startedAtMs: Date.now() - 15_000 },
        { id: 'spoken-reply', realtimeSessionId: 'rt-1', role: 'assistant', text: 'I am checking it. 我正在检查。',
          position: 4, localOrder: 150, startedAtMs: Date.now() - 14_000 },
      ],
      // A provider turn may open before the first transcript item. The richer
      // local copy keeps the handoff order and the running timer after refresh.
      threadMessages: [{ ...message, id: 'codex-timeline-turn-1', metadata: {
        ...message.metadata, codexTimeline: { provenance: 'realtime-delegated', turnId: 'turn-1', position: 2 },
      } }],
    }
    const session = createDefaultPerSessionState()
    Object.assign(session, { sessionProvider: 'codex', preferredProvider: 'codex', cwd: PROJECT,
      messages: [message], status: completed ? 'idle' : 'streaming', lastAssistantMessageId: message.id })
    useChatStore.setState({ activeProject: PROJECT, projectSessions: {
      ...previous.projectSessions, [PROJECT]: { ...createDefaultProjectState(), _activeSessionId: SESSION,
        _sessions: { [SESSION]: session, away: createDefaultPerSessionState() } },
    } })
    useAppStore.setState({ harnessCatalog: null })
    useCodexRealtimeViewStore.getState().setTimeline(SESSION, timeline)
    useRealtimeCallStore.setState({ sessionId: active ? SESSION : null, state: active ? 'active' : 'idle' })
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: previousCatalog })
      useCodexRealtimeViewStore.setState({ sessions: previousRealtime })
      useRealtimeCallStore.setState(previousCall)
    }
  }, [active, completed])

  function selectSession(sessionId: string) {
    useChatStore.setState(state => ({ projectSessions: {
      ...state.projectSessions, [PROJECT]: { ...state.projectSessions[PROJECT], _activeSessionId: sessionId },
    } }))
  }
  function finishWork() {
    useChatStore.setState(state => {
      const project = state.projectSessions[PROJECT]
      const session = project._sessions[SESSION]
      return { projectSessions: { ...state.projectSessions, [PROJECT]: { ...project, _sessions: {
        ...project._sessions, [SESSION]: { ...session, status: 'idle', messages: session.messages.map(message => ({
          ...message, status: 'complete', content: [{ type: 'text', text: 'History checked. 历史已检查完成。' }],
        })) },
      } } } }
    })
  }
  return <TooltipProvider>
    <div className="flex max-w-full flex-col gap-3" style={{ width: narrow ? 320 : 760 }}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => {
          useCodexRealtimeViewStore.getState().setRealtimeSession(SESSION, null)
          useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
        }}>End voice</Button>
        <Button size="sm" onClick={() => selectSession('away')}>Other session</Button>
        <Button size="sm" onClick={() => selectSession(SESSION)}>Return to session</Button>
        <Button size="sm" onClick={() => useCodexRealtimeViewStore.getState().setView(SESSION, 'realtime')}>Voice history</Button>
        <Button size="sm" onClick={finishWork}>Complete work</Button>
      </div>
      <div className="@container flex h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
        {ready && <ChatContent scrollViewportRef={viewportRef} />}
      </div>
    </div>
  </TooltipProvider>
}

const meta = { title: 'Chat/Voice Session History', component: Preview,
  globals: { harness: 'codex' }, parameters: { layout: 'padded' } } satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

export const EndedWhileWorking: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvasElement.querySelector('[data-message-id="codex-timeline-turn-1"]')).not.toBeNull())
    expect(canvas.queryByText('Check the history. 检查一下历史。')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Voice history' }))
    await waitFor(() => expect(canvasElement.querySelector('[data-activity-status="working"]')).not.toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Other session' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Return to session' }))
    await waitFor(() => expect(canvasElement.querySelector('[data-message-id="codex-timeline-turn-1"]')).not.toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Voice history' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Complete work' }))
    await waitFor(() => expect(canvasElement.querySelector('[data-activity-status="completed"]')).not.toBeNull())
  },
}
export const EndedCompleted: Story = { args: { completed: true } }
export const RunningAfterEnd: Story = {}
export const ActiveThenEnd: Story = { args: { active: true } }
export const NarrowDarkChinese: Story = { args: { narrow: true }, globals: { theme: 'dark', locale: 'zh' }, play: EndedWhileWorking.play }
