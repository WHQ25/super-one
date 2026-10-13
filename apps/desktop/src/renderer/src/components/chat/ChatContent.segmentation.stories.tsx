import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { compactProcessHistory, segmentationHistory, streamingAsyncAnswerHistory } from '@superone/chat-view/fixtures/transcript-segmentation'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { ChatContent } from './ChatContent'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'

mockTranscriptIpc()

// The rail ticks user messages and compaction points; this question gives it a user tick above both compactions.
const question: ChatMessage = { id: 'segmented-question', role: 'user', status: 'complete', providerId: 'claude', createdAt: '',
  content: [{ type: 'text', text: 'Finish the migration and keep going through compaction.' }] }


function SegmentationPreview({ codex = false, narrow = false, process = false, streaming = false }: { codex?: boolean; narrow?: boolean; process?: boolean; streaming?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const previous = useChatStore.getState()
    const app = useAppStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = 'segmentation'
    project._sessions = { segmentation: { ...createDefaultPerSessionState(), status: streaming ? 'streaming' : 'idle', sessionProvider: codex || process || streaming ? 'codex' : 'claude', messages: streaming ? streamingAsyncAnswerHistory(0) : process ? compactProcessHistory() : codex ? segmentationHistory(codex) : [question, ...segmentationHistory(codex)] } }
    useChatStore.setState({ activeProject: '__segmentation__', projectSessions: { ...previous.projectSessions, __segmentation__: project } })
    useAppStore.setState({ detailChatMode: !process })
    setReady(true)
    return () => { useChatStore.setState(previous); useAppStore.setState(app) }
  }, [codex, process, streaming])
  useEffect(() => {
    if (!ready || !streaming) return
    useChatStore.setState(state => {
      const project = state.projectSessions.__segmentation__!
      return { projectSessions: { ...state.projectSessions, __segmentation__: { ...project,
        _sessions: { ...project._sessions, segmentation: { ...project._sessions.segmentation!, messages: streamingAsyncAnswerHistory(stage) } } } } }
    })
  }, [ready, streaming, stage])
  return <TooltipProvider><div style={{ width: narrow ? 360 : 760, height: 620 }} className="flex flex-col bg-background">
    {streaming && <button onClick={() => setStage(stage + 1)} disabled={stage >= 2}>Continue stream</button>}
    {ready && <ChatContent scrollViewportRef={viewport} />}
  </div></TooltipProvider>
}

const meta = { title: 'Chat/Transcript segmentation', component: SegmentationPreview, parameters: { layout: 'padded' } } satisfies Meta<typeof SegmentationPreview>
export default meta
type Story = StoryObj<typeof meta>
export const MultipleCompactions: Story = {}
export const AsyncAnswer: Story = { args: { codex: true } }
export const NarrowCompactions: Story = { args: { narrow: true } }
export const NarrowAsyncAnswer: Story = { args: { codex: true, narrow: true } }
export const ProcessAcrossCompaction: Story = { args: { process: true, narrow: true } }
export const StreamingAsyncAnswer: Story = { args: { streaming: true }, globals: { theme: 'dark', locale: 'zh' } }
export const NarrowStreamingAsyncAnswer: Story = { args: { streaming: true, narrow: true }, globals: { theme: 'dark', locale: 'zh' } }
