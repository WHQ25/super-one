import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChatView } from './ChatView'
import { compactProcessHistory, segmentationHistory, streamingAsyncAnswerHistory } from './fixtures/transcript-segmentation'

function SegmentationPreview({ codex = false, process = false, streaming = false }: { codex?: boolean; process?: boolean; streaming?: boolean }) {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const host = globalThis as typeof globalThis & { __applyHost?: (value: unknown) => void }
    host.__applyHost?.({ type: stage ? 'applyReductionPatch' : 'hydrate', messages: streaming ? streamingAsyncAnswerHistory(stage) : process ? compactProcessHistory() : segmentationHistory(codex), sessionStatus: streaming ? 'streaming' : 'idle' })
  }, [codex, process, streaming, stage])
  return <div className="mx-auto max-w-[430px]">
    {streaming && <button onClick={() => setStage(stage + 1)} disabled={stage >= 2}>Continue stream</button>}
    <ChatView />
  </div>
}
const meta = { title: 'Chat/Mobile transcript segmentation', component: SegmentationPreview,
  parameters: { layout: 'fullscreen' } } satisfies Meta<typeof SegmentationPreview>
export default meta
type Story = StoryObj<typeof meta>
export const MultipleCompactions: Story = {}
export const AsyncAnswer: Story = { args: { codex: true } }
export const ProcessAcrossCompaction: Story = { args: { process: true } }
export const StreamingAsyncAnswer: Story = { args: { streaming: true }, globals: { theme: 'dark', locale: 'zh' } }
