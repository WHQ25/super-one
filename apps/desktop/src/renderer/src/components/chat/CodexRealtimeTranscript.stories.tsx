import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import type { AgentStatus, ChatMessage, CodexThreadItem, RealtimeTimelineResult } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { CodexRealtimeTranscript } from './CodexRealtimeTranscript'

type Scenario = 'restored' | 'repeated' | 'empty' | 'loading' | 'error' | 'delegation' | 'plan'
type WorkStatus = 'working' | 'completed' | 'failed' | 'needs-decision'

const projectPath = '/storybook/voice'
const typed: ChatMessage = {
  id: 'typed', role: 'user', status: 'complete', providerId: 'codex',
  content: [{ type: 'text', text: 'Please check the voice settings. 请检查语音设置。' }],
  createdAt: '2026-09-17T00:00:00Z', _lastAppliedSeq: 50_000,
}

const LONG_SUMMARY = 'Reviewed the realtime settings sync, the ICE reconnect grace period and the transcript ordering; '
  + 'two follow-ups remain in the composer and the sidebar. 已检查实时设置同步、ICE 重连宽限期和转录排序，还有两个后续项。'

function delegatedWork(status: WorkStatus, options: { plan?: boolean; long?: boolean } = {}): ChatMessage {
  const text = options.long ? LONG_SUMMARY : 'Voice settings reviewed. 语音配置已检查完成。'
  return {
    id: 'voice-work', role: 'assistant', providerId: 'codex', createdAt: new Date(Date.now() - 12_000).toISOString(),
    status: status === 'working' ? 'streaming' : status === 'failed' ? 'error' : 'complete',
    content: status === 'working' ? [] : [{ type: 'text', text }],
    metadata: {
      codex: {
        threadId: 'thread', turnId: 'voice-turn', usage: null,
        ...(status === 'working' ? {} : { durationMs: 66_000, finalResponse: text }),
        items: [
          { type: 'command_execution', id: 'cmd', command: 'git diff --stat', aggregatedOutput: '', status: 'completed' },
          ...(options.plan ? [{ type: 'plan', id: 'plan', text: '1. Move the indicator\n2. Split the composer\n3. Add stories' } as const] : []),
          ...(status === 'working' ? [] : [{ type: 'agent_message', id: 'voice-result', text } as const]),
        ] as CodexThreadItem[],
      },
      codexTimeline: { provenance: 'realtime-delegated', position: 4, turnId: 'voice-turn' },
    },
  }
}

function Preview({ scenario, width = 760 }: { scenario: Scenario; width?: number }) {
  const [ready, setReady] = useState(false)
  const [workStatus, setWorkStatus] = useState<WorkStatus>(scenario === 'delegation' ? 'working' : 'completed')
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const sessionId = `storybook-voice-${scenario}`
  const withWork = scenario === 'delegation' || scenario === 'plan'
  const hasSpeech = scenario === 'restored' || scenario === 'repeated' || withWork
  const sessionStatus: AgentStatus = workStatus === 'working' ? 'streaming' : workStatus === 'failed' ? 'error' : 'idle'
  const threadMessages: ChatMessage[] = withWork
    ? [delegatedWork(workStatus, { plan: scenario === 'plan', long: width < 480 })]
    : hasSpeech ? [typed] : []
  useEffect(() => {
    const timeline: RealtimeTimelineResult = {
      segments: hasSpeech ? [
        {
          id: 'voice-user', realtimeSessionId: 'rt', role: 'user', position: 2,
          text: 'Please check the voice settings. 请检查语音设置。',
          ...(scenario === 'repeated' || withWork ? { startedAtMs: Date.parse('2026-09-17T00:01:00Z') } : {}),
        },
        { id: 'voice-answer', realtimeSessionId: 'rt', role: 'assistant', position: 3, text: 'I will check the configuration. 我会检查配置。' },
        ...(withWork ? [{
          id: 'voice-followup', realtimeSessionId: 'rt', role: 'user' as const, position: 6,
          text: 'Tell me when it is done. 完成后告诉我。', startedAtMs: Date.parse('2026-09-17T00:02:00Z'),
        }] : []),
      ] : [],
      threadMessages: [], activeRealtimeSessionId: null, hasTimeline: hasSpeech,
    }
    mockIpc('agent', 'loadRealtimeTimeline', async () => null)
    mockIpc('agent', 'getRealtimeTimeline', async () => {
      if (scenario === 'error') throw new Error('Fixture unavailable')
      return timeline
    })
    useCodexRealtimeViewStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...EMPTY_CODEX_REALTIME_SESSION_VIEW, ...timeline, starting: scenario === 'loading' },
      },
    }))
    // The plan footer answers through the active session, so seed one in plan mode.
    const previous = useChatStore.getState()
    if (scenario === 'plan') {
      const project = createDefaultProjectState()
      const session = createDefaultPerSessionState()
      Object.assign(session, { selectedCodexCollaborationMode: 'plan', sessionProvider: 'codex' })
      useChatStore.setState({
        activeProject: projectPath,
        projectSessions: { ...previous.projectSessions, [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } } },
        approveCodexPlan: async () => { setWorkStatus('completed') },
        rejectCodexPlan: async () => { setWorkStatus('failed') },
      })
    }
    setReady(true)
    return () => {
      if (scenario === 'plan') useChatStore.setState(previous)
      useCodexRealtimeViewStore.setState((state) => {
        const sessions = { ...state.sessions }
        delete sessions[sessionId]
        return { sessions }
      })
    }
  }, [hasSpeech, scenario, sessionId, withWork])
  return (
    <div className="@container flex h-[480px] max-w-full flex-col rounded-xl border bg-card" style={{ width }}>
      {scenario === 'delegation' && <label className="flex items-center gap-2 border-b p-2 text-sm">
        Delegated work / 委派任务状态
        <select className="rounded border bg-card p-1" value={workStatus} onChange={(event) => setWorkStatus(event.target.value as WorkStatus)}>
          <option value="working">Working</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="needs-decision">Needs decision</option>
        </select>
      </label>}
      {ready && <CodexRealtimeTranscript
        sessionId={sessionId} scrollViewportRef={scrollViewportRef}
        liquidGlass={false} threadMessages={threadMessages}
        sessionStatus={sessionStatus} needsDecision={workStatus === 'needs-decision'}
      />}
    </div>
  )
}

const meta: Meta<typeof CodexRealtimeTranscript> = {
  title: 'Chat/Codex Realtime Transcript',
  component: CodexRealtimeTranscript,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof CodexRealtimeTranscript>

export const RestoredStartupEcho: Story = { render: () => <Preview scenario="restored" /> }
export const RepeatedLiveSpeech: Story = { render: () => <Preview scenario="repeated" /> }
export const NarrowDarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh', harness: 'codex' },
  render: () => <Preview scenario="repeated" width={320} />,
}
export const Empty: Story = { render: () => <Preview scenario="empty" /> }
export const Connecting: Story = { render: () => <Preview scenario="loading" /> }
export const FailedHistory: Story = { render: () => <Preview scenario="error" /> }
/** Delegated Codex work is a status line: live timer while running, outcome once settled; click opens the thread. */
export const DelegatedWork: Story = { render: () => <Preview scenario="delegation" /> }
export const DelegatedWorkNarrowDark: Story = {
  globals: { theme: 'dark', locale: 'zh', harness: 'codex' },
  render: () => <Preview scenario="delegation" width={320} />,
}
/** A plan the delegated turn ended on is answered under the status line, without leaving the voice view. */
export const PlanAwaitingApproval: Story = { render: () => <Preview scenario="plan" /> }
