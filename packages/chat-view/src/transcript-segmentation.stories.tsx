import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChatView } from './ChatView'
import { segmentationHistory } from './fixtures/transcript-segmentation'

function SegmentationPreview({ codex = false }: { codex?: boolean }) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { __applyHost?: (value: unknown) => void }
    host.__applyHost?.({ type: 'hydrate', messages: segmentationHistory(codex), sessionStatus: 'idle' })
  }, [codex])
  return <div className="mx-auto max-w-[430px]"><ChatView /></div>
}
const meta = { title: 'Chat/Mobile transcript segmentation', component: SegmentationPreview,
  parameters: { layout: 'fullscreen' } } satisfies Meta<typeof SegmentationPreview>
export default meta
type Story = StoryObj<typeof meta>
export const MultipleCompactions: Story = {}
export const AsyncAnswer: Story = { args: { codex: true } }
