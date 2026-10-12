import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useChatScroll } from '@/hooks/useChatScroll'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { ActivityPanel } from '../activity/ActivityPanel'
import { ChatContent } from './ChatContent'
import { FileChip } from './FileChip'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'

mockTranscriptIpc()
mockIpc('app', 'getGitDiffFile', async () => ({ path: 'preview.txt', diff: '' }))
mockIpc('app', 'readProjectFile', async () => ({ path: 'preview.txt', content: 'File preview is ready.', language: 'plaintext' }))

const PROJECT = '/transcript-performance'
const SESSION = 'claude-performance'

function turn(activities: number, streaming: boolean): ChatMessage {
  const content: ContentBlock[] = []
  for (let index = 0; index < activities; index++) {
    if (index % 2 === 0) content.push({ type: 'thinking', thinking: `Inspecting activity ${index}.` })
    content.push(
      { type: 'tool_use', toolUseId: `command-${index}`, toolName: 'Bash', input: JSON.stringify({ command: `echo activity-${index}` }), status: 'complete' },
      { type: 'tool_result', toolUseId: `command-${index}`, summary: `output-activity-${index}` },
    )
    if (index % 3 === 0) content.push({ type: 'text', text: `Progress ${index}: ${'A short update about the current investigation. '.repeat(3)}` })
  }
  content.push({ type: 'text', text: 'Latest reply in the long-running turn.' })
  return { id: 'claude-long-turn', role: 'assistant', providerId: 'claude', status: streaming ? 'streaming' : 'complete', createdAt: '2026-10-12T06:12:00.000Z', content }
}

function TurnPerformance({ activities = 612, streaming = true, detail = false, width = 1000 }: {
  activities?: number; streaming?: boolean; detail?: boolean; width?: number
}) {
  const [ready, setReady] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const scroll = useChatScroll({ scrollViewportRef: viewportRef })
  useEffect(() => {
    const previousChat = useChatStore.getState()
    const previousApp = useAppStore.getState()
    const previousPanel = useActivityPanelStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = SESSION
    project._sessions = { [SESSION]: {
      ...createDefaultPerSessionState(),
      sessionProvider: 'claude',
      status: streaming ? 'streaming' : 'idle',
      messages: [
        { id: 'request', role: 'user', providerId: 'local', status: 'complete', createdAt: '2026-10-12T06:12:00.000Z', content: [{ type: 'text', text: 'Inspect this long-running task.' }] },
        turn(activities, streaming),
      ],
    } }
    useChatStore.setState({ activeProject: PROJECT, projectSessions: { ...previousChat.projectSessions, [PROJECT]: project } })
    useAppStore.setState({ currentFolder: PROJECT, detailChatMode: detail, harnessCatalog: null })
    useActivityPanelStore.setState({ showPanel: false, side: 'right', panelWidth: 400, maximized: false, maximizedGroupId: null })
    setReady(true)
    return () => {
      useChatStore.setState(previousChat)
      useAppStore.setState(previousApp)
      useActivityPanelStore.setState(previousPanel)
    }
  }, [activities, streaming, detail])
  const append = () => useChatStore.setState(state => {
    const project = state.projectSessions[PROJECT]
    const session = project._sessions[SESSION]
    const last = session.messages.at(-1)!
    const tail = last.content.at(-1)
    const content = tail?.type === 'text'
      ? [...last.content.slice(0, -1), { ...tail, text: `${tail.text}\n\nNewest streamed update.` }]
      : [...last.content, { type: 'text' as const, text: 'Newest streamed update.' }]
    return { projectSessions: { ...state.projectSessions, [PROJECT]: { ...project, _sessions: { ...project._sessions, [SESSION]: {
      ...session, status: 'streaming', messages: [...session.messages.slice(0, -1), { ...last, content, status: 'streaming' }],
    } } } } }
  })
  return <TooltipProvider>
    <div style={{ width }} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span data-perf-file-chip><FileChip name="preview.txt" title="preview.txt" filePath={`${PROJECT}/preview.txt`} /></span>
        <Button data-perf-close-panel onClick={() => useActivityPanelStore.getState().setShowPanel(false)}>Close panel</Button>
        <Button data-perf-append-chunk onClick={append}>Append streaming chunk</Button>
      </div>
      <div data-perf-shell className="relative flex h-[560px] overflow-hidden rounded-xl border border-border bg-card">
        <div data-perf-chat className="@container flex min-w-0 flex-1 flex-col">
          {ready && <ChatContent scrollViewportRef={viewportRef} {...scroll} foreground={false} />}
        </div>
        {ready && <ActivityPanel getMaxWidth={() => width - 200} />}
      </div>
    </div>
  </TooltipProvider>
}

const meta = { title: 'Chat/ContentBlock Turn Performance', component: TurnPerformance, parameters: { layout: 'padded' } } satisfies Meta<typeof TurnPerformance>
export default meta
type Story = StoryObj<typeof meta>
export const Streaming: Story = {}
export const CompletedDetails: Story = { args: { streaming: false, detail: true } }
export const CompletedCompact: Story = { args: { streaming: false } }
export const ShortTurn: Story = { args: { activities: 8 } }
export const Narrow: Story = { args: { width: 640 } }
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' } }
