import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { segmentationHistory } from '@superone/chat-view/fixtures/transcript-segmentation'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { ChatContent } from './ChatContent'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'

mockTranscriptIpc()


function SegmentationPreview({ codex = false, narrow = false }: { codex?: boolean; narrow?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const app = useAppStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = 'segmentation'
    project._sessions = { segmentation: { ...createDefaultPerSessionState(), sessionProvider: codex ? 'codex' : 'claude', messages: segmentationHistory(codex) } }
    useChatStore.setState({ activeProject: '__segmentation__', projectSessions: { ...previous.projectSessions, __segmentation__: project } })
    useAppStore.setState({ detailChatMode: true })
    setReady(true)
    return () => { useChatStore.setState(previous); useAppStore.setState(app) }
  }, [codex])
  return <TooltipProvider><div style={{ width: narrow ? 360 : 760, height: 620 }} className="flex flex-col bg-background">
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
